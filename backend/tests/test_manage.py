from fastapi.testclient import TestClient

from app import db, manage
from app.main import app
from tests.conftest import is_admin, login, user_id


def test_create_admin_makes_an_admin_who_can_sign_in() -> None:
    assert manage.main(["create-admin", "boss", "--password", "boss-pass"]) == 0
    assert is_admin("boss")
    assert len(db.list_boards(user_id("boss"))) == 1
    client = TestClient(app)
    login(client, "boss", "boss-pass")
    assert client.get("/api/auth/me").json()["isAdmin"] is True


def test_create_admin_promotes_an_existing_account() -> None:
    assert not is_admin("e2e-test-user")
    assert manage.main(["create-admin", "e2e-test-user"]) == 0  # no password prompt needed
    assert is_admin("e2e-test-user")


def test_create_admin_applies_the_signup_rules() -> None:
    assert manage.main(["create-admin", "boss", "--password", "short"]) == 1
    assert db.get_user("boss") is None
