from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_file = tmp_path / "test_pm.db"
    monkeypatch.setenv("DATABASE_PATH", str(db_file))
    return db_file


def login(client: TestClient, username: str = "user", password: str = "password") -> None:
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text


@pytest.fixture
def client() -> TestClient:
    """A client signed in as the seeded 'user' account."""
    test_client = TestClient(app)
    login(test_client)
    return test_client


@pytest.fixture
def anon() -> TestClient:
    return TestClient(app)


def first_board_id(client: TestClient) -> int:
    return client.get("/api/boards").json()[0]["id"]
