import json

import pytest
from fastapi.testclient import TestClient
from itsdangerous import URLSafeTimedSerializer

from app import auth, db
from app.main import app
from app.schemas import MAX_CARDS
from tests.conftest import first_board_id, login, user_id


def forged_cookie(secret: str, username: str = "user", pw: str = "") -> str:
    return URLSafeTimedSerializer(secret, salt="pm-auth-session").dumps(
        {"username": username, "pw": pw}
    )


def test_cookie_signed_with_old_default_secret_is_rejected(anon: TestClient) -> None:
    password_hash = db.get_user("user").password_hash  # type: ignore[union-attr]
    anon.cookies.set(
        "pm_session",
        forged_cookie("pm-mvp-local-secret-key", pw=auth.password_fingerprint(password_hash)),
    )
    assert anon.get("/api/auth/me").status_code == 401


def test_session_secret_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SESSION_SECRET_KEY")
    with pytest.raises(RuntimeError, match="SESSION_SECRET_KEY"):
        auth.get_serializer()
    with pytest.raises(RuntimeError, match="SESSION_SECRET_KEY"):
        with TestClient(app):  # startup fails fast
            pass


def test_session_secret_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SESSION_SECRET_KEY", "from-the-environment")
    password_hash = db.get_user("user").password_hash  # type: ignore[union-attr]
    other = TestClient(app)
    other.cookies.set(
        "pm_session",
        forged_cookie("from-the-environment", pw=auth.password_fingerprint(password_hash)),
    )
    assert other.get("/api/auth/me").status_code == 200


def test_cookie_is_secure_only_on_vercel(monkeypatch: pytest.MonkeyPatch) -> None:
    def cookie_headers() -> list[str]:
        client = TestClient(app)
        signed_in = client.post("/api/auth/login", json={"username": "user", "password": "password"})
        signed_out = client.post("/api/auth/logout")
        return [res.headers["set-cookie"].lower() for res in (signed_in, signed_out)]

    monkeypatch.delenv("VERCEL", raising=False)
    assert not any("secure" in header for header in cookie_headers())

    monkeypatch.setenv("VERCEL", "1")
    for header in cookie_headers():
        assert "secure" in header and "httponly" in header and "samesite=lax" in header


def test_changing_password_signs_out_other_sessions(anon: TestClient) -> None:
    anon.post("/api/auth/register", json={"username": "frank", "password": "first-pass"})
    laptop = TestClient(app)
    login(laptop, "frank", "first-pass")

    res = anon.put(
        "/api/auth/password", json={"currentPassword": "first-pass", "newPassword": "second-pass"}
    )
    assert res.status_code == 200
    assert anon.get("/api/auth/me").status_code == 200  # this session was re-issued
    assert laptop.get("/api/auth/me").status_code == 401


def test_admin_password_reset_signs_out_the_user(client: TestClient) -> None:
    victim = TestClient(app)
    victim.post("/api/auth/register", json={"username": "gina", "password": "gina-pass"})
    assert victim.get("/api/boards").status_code == 200

    target = user_id("gina")
    client.put(f"/api/admin/users/{target}/password", json={"newPassword": "admin-set-pass"})
    assert victim.get("/api/boards").status_code == 401


def test_cookie_without_password_fingerprint_is_rejected(anon: TestClient) -> None:
    login(anon)
    secret = auth.get_serializer().secret_key
    legacy = URLSafeTimedSerializer(secret, salt="pm-auth-session").dumps({"username": "user"})
    stale = TestClient(app)
    stale.cookies.set("pm_session", legacy)
    assert stale.get("/api/auth/me").status_code == 401


def test_board_size_limits(client: TestClient) -> None:
    board_id = first_board_id(client)
    board = client.get(f"/api/boards/{board_id}").json()

    def put_with(mutate) -> int:
        candidate = json.loads(json.dumps(board))
        mutate(candidate)
        return client.put(f"/api/boards/{board_id}", json=candidate).status_code

    assert put_with(lambda b: b["cards"]["card-1"].update(title="x" * 200)) == 200
    assert put_with(lambda b: b["cards"]["card-1"].update(title="x" * 201)) == 422
    assert put_with(lambda b: b["cards"]["card-1"].update(details="x" * 5001)) == 422
    assert put_with(lambda b: b["columns"][0].update(title="x" * 41)) == 422

    def too_many_cards(b: dict) -> None:
        for i in range(MAX_CARDS + 1 - len(b["cards"])):
            card_id = f"bulk-{i}"
            b["cards"][card_id] = {"id": card_id, "title": "Bulk", "details": ""}
            b["columns"][0]["cardIds"].append(card_id)

    assert put_with(too_many_cards) == 422
