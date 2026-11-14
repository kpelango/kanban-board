import os
from pathlib import Path
import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import OPENROUTER_API_URL, OPENROUTER_MODEL, ask_openrouter
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


@pytest.mark.live_ai
def test_live_openrouter_two_plus_two() -> None:
    if not os.getenv("OPENROUTER_API_KEY"):
        pytest.skip("OPENROUTER_API_KEY not set in environment")
    reply = ask_openrouter("What is 2+2? Reply with only the digits.")
    assert "4" in reply
