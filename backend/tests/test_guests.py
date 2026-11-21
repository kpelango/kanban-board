from fastapi.testclient import TestClient

from app import db
from app.main import app
from tests.conftest import backdate, first_board_id, login, user_id

GUEST_CREATED = "users", "created_at", "username = %s"


def guest_name(client: TestClient) -> str:
    return client.get("/api/auth/me").json()["username"]


def test_try_demo_creates_a_flagged_guest_with_the_sample_board(guest: TestClient) -> None:
    me = guest.get("/api/auth/me").json()
    assert me["isGuest"] is True and me["isAdmin"] is False
    assert me["username"].startswith("guest-") and len(me["username"]) == len("guest-") + 6

    boards = guest.get("/api/boards").json()
    assert [b["name"] for b in boards] == ["My First Board"]
    assert boards[0]["cardCount"] == 8
    board = guest.get(f"/api/boards/{boards[0]['id']}").json()
    board["columns"][0]["title"] = "Renamed by guest"
    assert guest.put(f"/api/boards/{boards[0]['id']}", json=board).status_code == 200


def test_guest_cookie_lasts_one_day() -> None:
    res = TestClient(app).post("/api/auth/guest")
    assert res.json()["isGuest"] is True
    assert "max-age=86400" in res.headers["set-cookie"].lower()


def test_each_demo_gets_its_own_account() -> None:
    first, second = TestClient(app), TestClient(app)
    first.post("/api/auth/guest")
    second.post("/api/auth/guest")
    assert guest_name(first) != guest_name(second)
    assert first_board_id(first) != first_board_id(second)


def test_guests_cannot_sign_in_with_a_password(guest: TestClient, anon: TestClient) -> None:
    res = anon.post("/api/auth/login", json={"username": guest_name(guest), "password": "anything"})
    assert res.status_code == 401


def test_guests_cannot_change_password_delete_account_or_administer(guest: TestClient) -> None:
    res = guest.put("/api/auth/password", json={"currentPassword": "x", "newPassword": "new-password"})
    assert res.status_code == 403
    assert "Demo accounts" in res.json()["detail"]
    assert guest.request("DELETE", "/api/auth/account", json={"password": "x"}).status_code == 403
    assert guest.get("/api/admin/users").status_code == 403
    assert guest.delete(f"/api/admin/users/{user_id('e2e-test-user')}").status_code == 403


def test_guests_are_hidden_from_the_admin_user_list(client: TestClient, guest: TestClient) -> None:
    names = [u["username"] for u in client.get("/api/admin/users").json()]
    assert guest_name(guest) not in names
    assert "user" in names


def test_guest_names_are_reserved_at_registration(anon: TestClient) -> None:
    for name in ("guest-abc123", "Guest-Me"):
        res = anon.post("/api/auth/register", json={"username": name, "password": "password1"})
        assert res.status_code == 422
        assert "reserved" in res.json()["detail"][0]["msg"]
    assert anon.post("/api/auth/register", json={"username": "guesthouse", "password": "password1"}).status_code == 201


# Daily cleanup


def cleanup(client: TestClient, token: str | None):
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    return client.get("/api/cron/cleanup-guests", headers=headers)


def test_cleanup_requires_the_cron_secret(anon: TestClient, monkeypatch) -> None:
    assert cleanup(anon, "anything").status_code == 401  # no secret configured: fails closed
    assert cleanup(anon, "").status_code == 401
    monkeypatch.setenv("CRON_SECRET", "cron-secret")
    assert cleanup(anon, None).status_code == 401
    assert cleanup(anon, "wrong").status_code == 401
    assert cleanup(anon, "cron-secret").status_code == 200


def test_cleanup_deletes_only_guests_older_than_a_day(anon: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("CRON_SECRET", "cron-secret")
    old, fresh = TestClient(app), TestClient(app)
    old.post("/api/auth/guest")
    fresh.post("/api/auth/guest")
    old_board = first_board_id(old)
    convo = old.post(f"/api/boards/{old_board}/conversations", json={}).json()["id"]
    backdate(*GUEST_CREATED, (guest_name(old),), hours=25)
    backdate("users", "created_at", "username = 'e2e-test-user'", (), hours=48)  # registered: kept

    res = cleanup(anon, "cron-secret")
    assert res.json() == {"deleted": 1}
    assert db.get_user(guest_name(fresh)) is not None
    assert db.get_user("e2e-test-user") is not None
    assert old.get("/api/auth/me").status_code == 401
    with db.get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM boards WHERE id = %s", (old_board,)).fetchone()["n"] == 0
        assert conn.execute("SELECT COUNT(*) AS n FROM conversations WHERE id = %s", (convo,)).fetchone()["n"] == 0
    login(TestClient(app), "e2e-test-user")


def test_cleanup_drops_ai_usage_older_than_a_day(anon: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("CRON_SECRET", "cron-secret")
    uid = user_id("user")
    for _ in range(2):
        assert db.try_consume_ai_quota(uid, 10, 10) is None
    backdate("ai_usage", "created_at", "id = (SELECT min(id) FROM ai_usage)", (), hours=25)
    assert cleanup(anon, "cron-secret").status_code == 200
    with db.get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM ai_usage").fetchone()["n"] == 1

