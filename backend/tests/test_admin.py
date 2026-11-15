from fastapi.testclient import TestClient

from app import db
from app.main import app
from tests.conftest import login


def user_id(username: str) -> int:
    found = db.get_user_id(username)
    assert found is not None
    return found


def registered(username: str, password: str = "password1") -> TestClient:
    client = TestClient(app)
    assert client.post(
        "/api/auth/register", json={"username": username, "password": password}
    ).status_code == 201
    return client


def test_seeded_user_is_the_only_admin(client: TestClient) -> None:
    assert client.get("/api/auth/me").json() == {"username": "user", "isAdmin": True}
    users = {u["username"]: u for u in client.get("/api/admin/users").json()}
    assert users["user"]["isAdmin"] is True
    assert users["e2e-test-user"]["isAdmin"] is False
    assert users["user"]["boardCount"] == 1
    assert users["user"]["createdAt"]


def test_admin_api_requires_admin(anon: TestClient) -> None:
    assert anon.get("/api/admin/users").status_code == 401

    regular = registered("bob")
    target = user_id("user")
    assert regular.get("/api/admin/users").status_code == 403
    assert regular.put(
        f"/api/admin/users/{target}/password", json={"newPassword": "hijacked1"}
    ).status_code == 403
    assert regular.patch(f"/api/admin/users/{target}", json={"isAdmin": False}).status_code == 403
    assert regular.delete(f"/api/admin/users/{target}").status_code == 403
    # Unknown ids look the same as known ones to non-admins
    assert regular.delete("/api/admin/users/9999").status_code == 403


def test_admin_resets_a_password(client: TestClient) -> None:
    registered("carol", "original-pass")
    target = user_id("carol")
    assert client.put(
        f"/api/admin/users/{target}/password", json={"newPassword": "short"}
    ).status_code == 422
    assert client.put(
        f"/api/admin/users/{target}/password", json={"newPassword": "reset-pass"}
    ).status_code == 200
    fresh = TestClient(app)
    assert fresh.post(
        "/api/auth/login", json={"username": "carol", "password": "original-pass"}
    ).status_code == 401
    login(fresh, "carol", "reset-pass")


def test_admin_grants_and_removes_admin(client: TestClient) -> None:
    dave = registered("dave")
    target = user_id("dave")
    granted = client.patch(f"/api/admin/users/{target}", json={"isAdmin": True})
    assert granted.status_code == 200
    assert granted.json()["isAdmin"] is True
    assert dave.get("/api/auth/me").json()["isAdmin"] is True
    assert dave.get("/api/admin/users").status_code == 200

    removed = client.patch(f"/api/admin/users/{target}", json={"isAdmin": False})
    assert removed.json()["isAdmin"] is False
    assert dave.get("/api/admin/users").status_code == 403


def test_admin_cannot_demote_or_delete_self(client: TestClient) -> None:
    me = user_id("user")
    demote = client.patch(f"/api/admin/users/{me}", json={"isAdmin": False})
    assert demote.status_code == 400
    assert demote.json() == {"detail": "You cannot remove admin rights from your own account here"}
    assert client.delete(f"/api/admin/users/{me}").status_code == 400
    assert db.is_admin("user")


def test_admin_deletes_a_user_and_their_data(client: TestClient) -> None:
    erin = registered("erin")
    target = user_id("erin")
    assert client.delete(f"/api/admin/users/{target}").status_code == 204
    assert db.get_user_id("erin") is None
    assert erin.get("/api/boards").status_code == 401
    assert client.delete(f"/api/admin/users/{target}").status_code == 404
    assert client.put(
        f"/api/admin/users/{target}/password", json={"newPassword": "whatever1"}
    ).status_code == 404
