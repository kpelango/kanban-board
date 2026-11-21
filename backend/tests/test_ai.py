import json
import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app import db
from app.ai import (
    MAX_HISTORY_MESSAGES,
    OPENROUTER_API_URL,
    OPENROUTER_MODEL,
    ask_openrouter,
    parse_structured_ai_output,
    run_kanban_chat,
)
from app.main import app
from app.schemas import board_template
from tests.conftest import backdate, first_board_id, login, user_id


class FakeOpenRouter:
    """Replaces httpx.post, records each payload, and replies with queued AI outputs."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, *replies: dict | str) -> None:
        monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
        monkeypatch.setattr(httpx, "post", self)
        self.replies = list(replies)
        self.calls: list[dict] = []

    def __call__(self, url: str, *, headers: dict, json: dict, timeout: float) -> httpx.Response:
        self.calls.append({"url": url, "headers": headers, "json": json})
        reply = self.replies.pop(0) if self.replies else {"assistant_message": "ok"}
        content = reply if isinstance(reply, str) else json_dumps(reply)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": content}}]},
            request=httpx.Request("POST", url),
        )


json_dumps = json.dumps


def new_conversation(client: TestClient, board_id: int | None = None) -> dict:
    board_id = board_id or first_board_id(client)
    res = client.post(f"/api/boards/{board_id}/conversations", json={})
    assert res.status_code == 201
    return res.json()


def test_ai_endpoints_require_authentication(anon: TestClient) -> None:
    assert anon.post("/api/ai/test", json={"prompt": "Hi"}).status_code == 401
    assert anon.get("/api/boards/1/conversations").status_code == 401
    assert anon.post("/api/boards/1/conversations", json={}).status_code == 401
    assert anon.get("/api/conversations/1").status_code == 401
    assert anon.patch("/api/conversations/1", json={"name": "x"}).status_code == 401
    assert anon.delete("/api/conversations/1").status_code == 401
    assert anon.post("/api/conversations/1/messages", json={"message": "Hi"}).status_code == 401


def test_ai_missing_api_key_raises_500(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    res = client.post("/api/ai/test", json={"prompt": "What is 2+2?"})
    assert res.status_code == 500
    assert "OPENROUTER_API_KEY" in res.json()["detail"]


def test_ai_calls_openrouter_with_expected_model_and_headers(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeOpenRouter(monkeypatch, "4")
    res = client.post("/api/ai/test", json={"prompt": "What is 2+2? Reply with just the number."})

    assert res.status_code == 200
    assert res.json() == {"reply": "4", "model": OPENROUTER_MODEL}
    call = fake.calls[0]
    assert call["url"] == OPENROUTER_API_URL
    assert call["headers"]["Authorization"] == "Bearer test-openrouter-key"
    assert call["json"]["model"] == "openai/gpt-oss-120b"
    assert call["json"]["messages"] == [
        {"role": "user", "content": "What is 2+2? Reply with just the number."}
    ]


def test_openrouter_http_error_returns_502(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")

    def failing_post(url: str, **_: object) -> httpx.Response:
        return httpx.Response(429, json={}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", failing_post)
    res = client.post("/api/ai/test", json={"prompt": "Hi"})
    assert res.status_code == 502
    assert res.json() == {"detail": "OpenRouter returned status 429"}


def test_parse_structured_output_handles_fences_and_rejects_invalid() -> None:
    parsed = parse_structured_ai_output('```json\n{"assistant_message": "Hi"}\n```')
    assert parsed.assistant_message == "Hi"
    assert parsed.updated_board is None

    with pytest.raises(Exception) as exc:
        parse_structured_ai_output("not json")
    assert getattr(exc.value, "status_code", None) == 502


def test_conversation_crud(client: TestClient) -> None:
    board_id = first_board_id(client)
    assert client.get(f"/api/boards/{board_id}/conversations").json() == []

    first = new_conversation(client, board_id)
    assert first["title"] == "New conversation"
    assert first["boardId"] == board_id
    named = client.post(f"/api/boards/{board_id}/conversations", json={"title": "Sprint planning"})
    assert named.json()["title"] == "Sprint planning"

    listed = client.get(f"/api/boards/{board_id}/conversations").json()
    assert {c["id"] for c in listed} == {first["id"], named.json()["id"]}

    detail = client.get(f"/api/conversations/{first['id']}").json()
    assert detail["messages"] == []

    renamed = client.patch(f"/api/conversations/{first['id']}", json={"name": "Retro"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Retro"

    assert client.delete(f"/api/conversations/{first['id']}").status_code == 204
    assert client.get(f"/api/conversations/{first['id']}").status_code == 404
    assert client.delete(f"/api/conversations/{first['id']}").status_code == 404
    assert len(client.get(f"/api/boards/{board_id}/conversations").json()) == 1

    assert client.get("/api/boards/9999/conversations").status_code == 404
    assert client.post("/api/boards/9999/conversations", json={}).status_code == 404


def test_conversations_are_isolated_between_users(client: TestClient) -> None:
    conversation = new_conversation(client)
    board_id = conversation["boardId"]

    other = TestClient(app)
    login(other, "e2e-test-user")
    assert other.get(f"/api/boards/{board_id}/conversations").status_code == 404
    assert other.post(f"/api/boards/{board_id}/conversations", json={}).status_code == 404
    assert other.get(f"/api/conversations/{conversation['id']}").status_code == 404
    assert other.patch(f"/api/conversations/{conversation['id']}", json={"name": "x"}).status_code == 404
    assert other.delete(f"/api/conversations/{conversation['id']}").status_code == 404
    assert other.post(
        f"/api/conversations/{conversation['id']}/messages", json={"message": "Hi"}
    ).status_code == 404


def test_message_without_board_update_sends_board_and_history(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeOpenRouter(
        monkeypatch,
        {"assistant_message": "Hello! How can I help?", "updated_board": None},
        {"assistant_message": "You have 2 cards in Backlog.", "updated_board": None},
    )
    conversation = new_conversation(client)
    url = f"/api/conversations/{conversation['id']}/messages"

    first = client.post(url, json={"message": "Hi"})
    assert first.status_code == 200
    assert first.json()["conversation"]["title"] == "Hi"  # auto-titled from first message

    res = client.post(url, json={"message": "How many cards are in Backlog?"})
    assert res.status_code == 200
    body = res.json()
    assert body["reply"] == "You have 2 cards in Backlog."
    assert body["board"] is None
    assert body["conversation"]["title"] == "Hi"  # not overwritten later

    sent = fake.calls[1]["json"]["messages"]
    assert sent[0]["role"] == "system"
    assert "Align roadmap themes" in sent[0]["content"]
    assert '"priority":"high"' in sent[0]["content"]
    assert "'archived' maps archived card IDs" in sent[0]["content"]
    assert sent[1:] == [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello! How can I help?"},
        {"role": "user", "content": "How many cards are in Backlog?"},
    ]
    assert fake.calls[1]["json"]["response_format"] == {"type": "json_object"}

    detail = client.get(f"/api/conversations/{conversation['id']}").json()
    assert len(detail["messages"]) == 4


def test_message_with_board_update_persists_to_conversation_board(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    first_id = first_board_id(client)
    second = client.post("/api/boards", json={"name": "Second", "template": "blank"}).json()
    updated = client.get(f"/api/boards/{second['id']}").json()
    updated["cards"]["card-1"] = {
        "id": "card-1",
        "title": "AI Created Card",
        "details": "Added by AI assistant",
        "priority": "high",
        "dueDate": "2026-12-24",
        "labels": ["ai"],
    }
    updated["columns"][0]["cardIds"].append("card-1")
    fake = FakeOpenRouter(
        monkeypatch, {"assistant_message": "Added it.", "updated_board": updated}
    )

    conversation = new_conversation(client, second["id"])
    res = client.post(
        f"/api/conversations/{conversation['id']}/messages",
        json={"message": "Add a card called AI Created Card"},
    )
    assert res.status_code == 200
    assert res.json()["board"]["cards"]["card-1"]["title"] == "AI Created Card"
    assert '"cards":{}' in fake.calls[0]["json"]["messages"][0]["content"]

    persisted = client.get(f"/api/boards/{second['id']}").json()
    assert persisted["cards"]["card-1"]["dueDate"] == "2026-12-24"
    assert persisted["columns"][0]["cardIds"] == ["card-1"]
    # Other boards are untouched
    assert client.get(f"/api/boards/{first_id}").json()["cards"]["card-1"]["title"] == "Align roadmap themes"


def test_invalid_ai_board_is_rejected_and_not_saved(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    FakeOpenRouter(
        monkeypatch,
        {"assistant_message": "Done", "updated_board": {"columns": [], "cards": {}}},
    )
    board_id = first_board_id(client)
    before = client.get(f"/api/boards/{board_id}").json()
    conversation = new_conversation(client, board_id)
    res = client.post(f"/api/conversations/{conversation['id']}/messages", json={"message": "Break it"})
    assert res.status_code == 502
    assert client.get(f"/api/boards/{board_id}").json() == before
    assert client.get(f"/api/conversations/{conversation['id']}").json()["messages"] == []


def test_conversations_keep_separate_histories(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeOpenRouter(monkeypatch)
    a = new_conversation(client)
    b = new_conversation(client)
    client.post(f"/api/conversations/{a['id']}/messages", json={"message": "Only in A"})
    client.post(f"/api/conversations/{b['id']}/messages", json={"message": "Only in B"})

    assert fake.calls[1]["json"]["messages"][1:] == [{"role": "user", "content": "Only in B"}]
    a_messages = client.get(f"/api/conversations/{a['id']}").json()["messages"]
    assert [m["content"] for m in a_messages] == ["Only in A", "ok"]

    listed = client.get(f"/api/boards/{a['boardId']}/conversations").json()
    assert listed[0]["id"] == b["id"]  # most recently updated first


def test_history_sent_to_ai_is_capped(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeOpenRouter(monkeypatch)
    conversation = new_conversation(client)
    db.append_messages(
        conversation["id"],
        [
            db.ChatMessage(role="user" if i % 2 == 0 else "assistant", content=f"m{i}")
            for i in range(30)
        ],
    )
    client.post(f"/api/conversations/{conversation['id']}/messages", json={"message": "latest"})
    sent = fake.calls[0]["json"]["messages"]
    assert len(sent) == 1 + MAX_HISTORY_MESSAGES + 1
    assert sent[1]["content"] == "m10"
    assert sent[-1]["content"] == "latest"


def test_send_message_validates_input(client: TestClient) -> None:
    conversation = new_conversation(client)
    url = f"/api/conversations/{conversation['id']}/messages"
    assert client.post(url, json={"message": ""}).status_code == 422
    assert client.post(url, json={"message": "x" * 4001}).status_code == 422


@pytest.mark.live_ai
def test_live_openrouter_two_plus_two() -> None:
    if not os.getenv("OPENROUTER_API_KEY"):
        pytest.skip("OPENROUTER_API_KEY not set in environment")
    assert "4" in ask_openrouter("What is 2+2? Reply with only the digits.")


@pytest.mark.live_ai
def test_live_openrouter_structured_kanban_update() -> None:
    if not os.getenv("OPENROUTER_API_KEY"):
        pytest.skip("OPENROUTER_API_KEY not set in environment")
    result = run_kanban_chat(
        board=board_template("sample"),
        message="Add a new high priority card titled 'Launch beta' with details 'Invite 20 pilot users' and label 'release' to the Backlog column.",
        history=[],
    )
    assert result.updated_board is not None
    backlog = [result.updated_board.cards[cid] for cid in result.updated_board.columns[0].cardIds]
    launch = next(card for card in backlog if card.title == "Launch beta")
    assert launch.priority == "high"
    assert "release" in launch.labels


def test_get_messages_limit_returns_the_most_recent_in_order(client: TestClient) -> None:
    conversation = client.post(f"/api/boards/{first_board_id(client)}/conversations", json={}).json()
    db.append_messages(
        conversation["id"],
        [db.ChatMessage(role="user", content=f"m{i}") for i in range(5)],
    )
    recent = db.get_messages(conversation["id"], limit=2)
    assert [m.content for m in recent] == ["m3", "m4"]
    assert len(db.get_messages(conversation["id"])) == 5


# Daily limits and the admin-only test endpoint


def send(client: TestClient, conversation_id: int, text: str = "Hi") -> int:
    return client.post(f"/api/conversations/{conversation_id}/messages", json={"message": text}).status_code


def test_ai_test_endpoint_is_admin_only(guest: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeOpenRouter(monkeypatch)
    regular = TestClient(app)
    login(regular, "e2e-test-user")
    assert regular.post("/api/ai/test", json={"prompt": "Hi"}).status_code == 403
    assert guest.post("/api/ai/test", json={"prompt": "Hi"}).status_code == 403
    assert fake.calls == []


@pytest.mark.parametrize("who, env, default", [("guest", "AI_DAILY_LIMIT_GUEST", 10), ("registered", "AI_DAILY_LIMIT", 30)])
def test_daily_limit_blocks_the_next_message_without_calling_ai(
    who: str, env: str, default: int, guest: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeOpenRouter(monkeypatch)
    if who == "guest":
        user = guest
    else:
        user = TestClient(app)
        login(user, "e2e-test-user")
    conversation_id = new_conversation(user)["id"]

    for _ in range(default):
        assert send(user, conversation_id) == 200
    res = user.post(f"/api/conversations/{conversation_id}/messages", json={"message": "One more"})
    assert res.status_code == 429
    assert f"all {default} assistant messages" in res.json()["detail"]
    assert len(fake.calls) == default  # OpenRouter was not called for the blocked message

    monkeypatch.setenv(env, str(default + 1))  # the limit is configurable
    assert send(user, conversation_id) == 200


def test_limit_counts_per_user_and_survives_deleting_chats(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    FakeOpenRouter(monkeypatch)
    monkeypatch.setenv("AI_DAILY_LIMIT", "2")
    first = new_conversation(client)["id"]
    assert send(client, first) == 200
    assert client.delete(f"/api/conversations/{first}").status_code == 204
    second = new_conversation(client)["id"]
    assert send(client, second) == 200
    assert send(client, second) == 429  # deleting the first chat did not refund it

    other = TestClient(app)
    login(other, "e2e-test-user")
    assert send(other, new_conversation(other)["id"]) == 200  # someone else's budget


def test_usage_older_than_a_day_does_not_count(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    FakeOpenRouter(monkeypatch)
    monkeypatch.setenv("AI_DAILY_LIMIT", "1")
    conversation_id = new_conversation(client)["id"]
    assert send(client, conversation_id) == 200
    assert send(client, conversation_id) == 429
    backdate("ai_usage", "created_at", "user_id = %s", (user_id("user"),), hours=24.1)
    assert send(client, conversation_id) == 200


def test_parallel_requests_cannot_exceed_the_limits(client: TestClient) -> None:
    from concurrent.futures import ThreadPoolExecutor

    uid = user_id("user")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: db.try_consume_ai_quota(uid, 3, 100), range(8)))
    assert results.count(None) == 3
    other = user_id("e2e-test-user")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: db.try_consume_ai_quota(other, 100, 5), range(8)))
    assert results.count(None) == 2  # 3 + 2 reaches the site-wide 5


def test_site_wide_limit_covers_all_accounts(client: TestClient, guest: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeOpenRouter(monkeypatch)
    monkeypatch.setenv("AI_DAILY_LIMIT_TOTAL", "2")
    assert send(client, new_conversation(client)["id"]) == 200
    guest_chat = new_conversation(guest)["id"]
    assert send(guest, guest_chat) == 200
    res = guest.post(f"/api/conversations/{guest_chat}/messages", json={"message": "One more"})
    assert res.status_code == 429
    assert res.json()["detail"] == "The assistant has reached today's limit for this demo. Try again tomorrow."
    assert len(fake.calls) == 2


@pytest.mark.parametrize("name", ["AI_DAILY_LIMIT", "AI_DAILY_LIMIT_GUEST", "AI_DAILY_LIMIT_TOTAL"])
def test_startup_fails_on_a_mistyped_limit(name: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(name, "30 messages")
    with pytest.raises(RuntimeError, match=name):
        with TestClient(app):
            pass