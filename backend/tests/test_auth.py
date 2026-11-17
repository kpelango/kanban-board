from fastapi.testclient import TestClient

from app import db
from app.main import app
from tests.conftest import login


def test_me_requires_authentication(anon: TestClient) -> None:
    response = anon.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_tampered_session_cookie_is_rejected(anon: TestClient) -> None:
    anon.cookies.set("pm_session", "not-a-valid-token")
    assert anon.get("/api/auth/me").status_code == 401


def test_login_rejects_invalid_credentials(anon: TestClient) -> None:
    response = anon.post(
        "/api/auth/login", json={"username": "user", "password": "wrong-password"}
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password"}

    unknown = anon.post(
        "/api/auth/login", json={"username": "nobody", "password": "password"}
    )
    assert unknown.status_code == 401


def test_login_me_and_logout_flow(anon: TestClient) -> None:
    login_response = anon.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200
    assert login_response.json() == {"username": "user", "isAdmin": True, "isGuest": False}
    assert "pm_session" in login_response.cookies

    assert anon.get("/api/auth/me").json() == {"username": "user", "isAdmin": True, "isGuest": False}
    assert anon.post("/api/auth/logout").json() == {"status": "logged_out"}
    assert anon.get("/api/auth/me").status_code == 401


def test_passwords_are_salted_hashes() -> None:
    first = db.hash_password("password")
    second = db.hash_password("password")
    assert first != second
    assert first.startswith("pbkdf2_sha256$")
    assert db.check_password("password", first)
    assert not db.check_password("wrong", first)


def test_register_creates_user_with_default_board_and_session(anon: TestClient) -> None:
    res = anon.post("/api/auth/register", json={"username": "alice", "password": "s3cret-pass"})
    assert res.status_code == 201
    assert res.json() == {"username": "alice", "isAdmin": False, "isGuest": False}
    assert anon.get("/api/auth/me").json() == {"username": "alice", "isAdmin": False, "isGuest": False}

    boards = anon.get("/api/boards").json()
    assert len(boards) == 1
    assert boards[0]["name"] == "My First Board"

    other = TestClient(app)
    login(other, "alice", "s3cret-pass")


def test_register_rejects_duplicates_and_invalid_input(anon: TestClient) -> None:
    taken = anon.post("/api/auth/register", json={"username": "user", "password": "password1"})
    assert taken.status_code == 409
    assert taken.json() == {"detail": "Username is already taken"}

    short_password = anon.post("/api/auth/register", json={"username": "bob", "password": "short"})
    assert short_password.status_code == 422

    bad_username = anon.post(
        "/api/auth/register", json={"username": "a b!", "password": "password1"}
    )
    assert bad_username.status_code == 422

    too_short = anon.post("/api/auth/register", json={"username": "ab", "password": "password1"})
    assert too_short.status_code == 422


def test_usernames_are_case_insensitive(anon: TestClient) -> None:
    clash = anon.post("/api/auth/register", json={"username": "USER", "password": "password1"})
    assert clash.status_code == 409

    res = anon.post("/api/auth/login", json={"username": "User", "password": "password"})
    assert res.status_code == 200
    assert res.json()["username"] == "user"  # session uses the stored spelling
    assert anon.get("/api/auth/me").json()["username"] == "user"


def test_duplicate_usernames_are_rejected_by_the_database() -> None:
    assert db.create_user("hank", "password1") is not None
    assert db.create_user("hank", "password1") is None
    assert db.create_user("HANK", "password1") is None
    with db.get_connection() as conn:
        assert conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE lower(username) = 'hank'"
        ).fetchone()["n"] == 1
        # A failed sign-up leaves no orphaned board behind
        assert conn.execute(
            "SELECT COUNT(*) AS n FROM boards WHERE user_id NOT IN (SELECT id FROM users)"
        ).fetchone()["n"] == 0


def test_concurrent_registrations_never_error(anon: TestClient) -> None:
    from concurrent.futures import ThreadPoolExecutor

    def register(_: int) -> int:
        return TestClient(app).post(
            "/api/auth/register", json={"username": "racer", "password": "password1"}
        ).status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        codes = sorted(pool.map(register, range(8)))
    assert codes.count(201) == 1
    assert set(codes) <= {201, 409}


def test_change_password(anon: TestClient) -> None:
    anon.post("/api/auth/register", json={"username": "carol", "password": "first-pass"})

    wrong = anon.put(
        "/api/auth/password",
        json={"currentPassword": "nope-nope", "newPassword": "second-pass"},
    )
    assert wrong.status_code == 400
    assert wrong.json() == {"detail": "Current password is incorrect"}

    too_short = anon.put(
        "/api/auth/password", json={"currentPassword": "first-pass", "newPassword": "x"}
    )
    assert too_short.status_code == 422

    ok = anon.put(
        "/api/auth/password",
        json={"currentPassword": "first-pass", "newPassword": "second-pass"},
    )
    assert ok.status_code == 200

    fresh = TestClient(app)
    assert fresh.post(
        "/api/auth/login", json={"username": "carol", "password": "first-pass"}
    ).status_code == 401
    login(fresh, "carol", "second-pass")


def test_change_password_requires_auth(anon: TestClient) -> None:
    res = anon.put(
        "/api/auth/password", json={"currentPassword": "password", "newPassword": "password2"}
    )
    assert res.status_code == 401


def test_delete_account_removes_user_data_and_invalidates_session(anon: TestClient) -> None:
    anon.post("/api/auth/register", json={"username": "dave", "password": "dave-pass"})
    board_id = anon.get("/api/boards").json()[0]["id"]
    anon.post(f"/api/boards/{board_id}/conversations", json={})
    token = anon.cookies.get("pm_session")

    wrong = anon.request("DELETE", "/api/auth/account", json={"password": "wrong-pass"})
    assert wrong.status_code == 400

    res = anon.request("DELETE", "/api/auth/account", json={"password": "dave-pass"})
    assert res.status_code == 200
    assert db.get_user_id("dave") is None

    with db.get_connection() as conn:
        assert conn.execute(
            "SELECT COUNT(*) AS n FROM boards WHERE id = %s", (board_id,)
        ).fetchone()["n"] == 0
        assert conn.execute(
            "SELECT COUNT(*) AS n FROM conversations WHERE board_id = %s", (board_id,)
        ).fetchone()["n"] == 0

    # A session cookie for a deleted user must stop working
    stale = TestClient(app)
    stale.cookies.set("pm_session", token)
    assert stale.get("/api/auth/me").status_code == 401
