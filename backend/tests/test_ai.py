import json
import os
from pathlib import Path
import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import OPENROUTER_API_URL, OPENROUTER_MODEL, ask_openrouter, run_kanban_chat
from app.db import get_board_for_user
from app.main import app


@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_file = tmp_path / "test_pm.db"
    monkeypatch.setenv("DATABASE_PATH", str(db_file))
    return db_file


def test_ai_endpoint_requires_authentication() -> None:
    client = TestClient(app)
    res = client.post("/api/ai/test", json={"prompt": "What is 2+2?"})
    assert res.status_code == 401


def test_chat_endpoint_requires_authentication() -> None:
    client = TestClient(app)
    res = client.post("/api/chat", json={"message": "Hello", "history": []})
    assert res.status_code == 401


def test_ai_missing_api_key_raises_500(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "user", "password": "password"})
    res = client.post("/api/ai/test", json={"prompt": "What is 2+2?"})
    assert res.status_code == 500
    assert "OPENROUTER_API_KEY" in res.json()["detail"]


def test_ai_calls_openrouter_with_expected_model_and_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
    captured: dict = {}

    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> httpx.Response:
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "4"}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", fake_post)

    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "user", "password": "password"})
    res = client.post(
        "/api/ai/test",
        json={"prompt": "What is 2+2? Reply with just the number."},
    )

    assert res.status_code == 200
    assert res.json() == {"reply": "4", "model": OPENROUTER_MODEL}
    assert captured["url"] == OPENROUTER_API_URL
    assert captured["headers"]["Authorization"] == "Bearer test-openrouter-key"
    assert captured["json"]["model"] == "openai/gpt-oss-120b"
    assert captured["json"]["messages"] == [
        {"role": "user", "content": "What is 2+2? Reply with just the number."}
    ]


def test_chat_without_board_update_includes_board_and_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
    captured: dict = {}

    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> httpx.Response:
        captured["json"] = json
        ai_payload = {
            "assistant_message": "You have 2 cards in Backlog.",
            "updated_board": None,
        }
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json_lib_dumps(ai_payload)}}]},
            request=httpx.Request("POST", url),
        )

    json_lib_dumps = json.dumps
    monkeypatch.setattr(httpx, "post", fake_post)

    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "user", "password": "password"})
    res = client.post(
        "/api/chat",
        json={
            "message": "How many cards are in Backlog?",
            "history": [
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello! How can I help?"},
            ],
        },
    )

    assert res.status_code == 200
    assert res.json() == {
        "reply": "You have 2 cards in Backlog.",
        "board": None,
    }
    sent_messages = captured["json"]["messages"]
    assert sent_messages[0]["role"] == "system"
    assert "Align roadmap themes" in sent_messages[0]["content"]
    assert sent_messages[1] == {"role": "user", "content": "Hi"}
    assert sent_messages[2] == {
        "role": "assistant",
        "content": "Hello! How can I help?",
    }
    assert sent_messages[3] == {
        "role": "user",
        "content": "How many cards are in Backlog?",
    }
    assert captured["json"]["response_format"] == {"type": "json_object"}


def test_chat_with_board_update_persists_new_board(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")

    initial_board = get_board_for_user("user").model_dump()
    updated_board = json.loads(json.dumps(initial_board))
    updated_board["cards"]["card-99"] = {
        "id": "card-99",
        "title": "AI Created Card",
        "details": "Added by AI assistant",
    }
    updated_board["columns"][0]["cardIds"].append("card-99")

    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> httpx.Response:
        ai_payload = {
            "assistant_message": "I added 'AI Created Card' to your Backlog.",
            "updated_board": updated_board,
        }
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json_lib_dumps(ai_payload)}}]},
            request=httpx.Request("POST", url),
        )

    json_lib_dumps = json.dumps
    monkeypatch.setattr(httpx, "post", fake_post)

    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "user", "password": "password"})
    res = client.post(
        "/api/chat",
        json={"message": "Add a card called AI Created Card to Backlog", "history": []},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["reply"] == "I added 'AI Created Card' to your Backlog."
    assert body["board"] is not None
    assert "card-99" in body["board"]["cards"]

    persisted_board = get_board_for_user("user")
    assert "card-99" in persisted_board.cards
    assert "card-99" in persisted_board.columns[0].cardIds


def test_chat_history_persists_in_sqlite_and_can_be_cleared(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
    captured_calls: list[dict] = []

    def fake_post(url: str, *, headers: dict, json: dict, timeout: float) -> httpx.Response:
        captured_calls.append(json)
        turn = len(captured_calls)
        ai_payload = {
            "assistant_message": f"Assistant reply {turn}",
            "updated_board": None,
        }
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json_lib_dumps(ai_payload)}}]},
            request=httpx.Request("POST", url),
        )

    json_lib_dumps = json.dumps
    monkeypatch.setattr(httpx, "post", fake_post)

    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "user", "password": "password"})

    # Initially empty
    hist_res = client.get("/api/chat/history")
    assert hist_res.status_code == 200
    assert hist_res.json() == {"messages": []}

    # Turn 1
    res1 = client.post("/api/chat", json={"message": "First question", "history": []})
    assert res1.status_code == 200

    hist_after_1 = client.get("/api/chat/history").json()["messages"]
    assert hist_after_1 == [
        {"role": "user", "content": "First question"},
        {"role": "assistant", "content": "Assistant reply 1"},
    ]

    # Turn 2 (even if client sends empty history, DB history is loaded automatically)
    res2 = client.post("/api/chat", json={"message": "Second question", "history": []})
    assert res2.status_code == 200
    second_call_messages = captured_calls[1]["messages"]
    assert second_call_messages[1] == {"role": "user", "content": "First question"}
    assert second_call_messages[2] == {
        "role": "assistant",
        "content": "Assistant reply 1",
    }
    assert second_call_messages[3] == {"role": "user", "content": "Second question"}

    # Clear history
    del_res = client.delete("/api/chat/history")
    assert del_res.status_code == 200
    assert client.get("/api/chat/history").json() == {"messages": []}


@pytest.mark.live_ai
def test_live_openrouter_two_plus_two() -> None:
    if not os.getenv("OPENROUTER_API_KEY"):
        pytest.skip("OPENROUTER_API_KEY not set in environment")
    reply = ask_openrouter("What is 2+2? Reply with only the digits.")
    assert "4" in reply


@pytest.mark.live_ai
def test_live_openrouter_structured_kanban_update() -> None:
    if not os.getenv("OPENROUTER_API_KEY"):
        pytest.skip("OPENROUTER_API_KEY not set in environment")
    board = get_board_for_user("user")
    result = run_kanban_chat(
        board=board,
        message="Add a new card titled 'Launch beta' with details 'Invite 20 pilot users' to the Backlog column.",
        history=[],
    )
    assert result.assistant_message
    assert result.updated_board is not None
    backlog_cards = [
        result.updated_board.cards[cid].title
        for cid in result.updated_board.columns[0].cardIds
    ]
    assert "Launch beta" in backlog_cards
