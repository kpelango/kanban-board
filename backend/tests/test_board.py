from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.db import get_board_for_user, init_db, save_board_for_user
from app.main import app


@pytest.fixture(autouse=True)
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_file = tmp_path / "test_pm.db"
    monkeypatch.setenv("DATABASE_PATH", str(db_file))
    return db_file


def test_db_auto_creation_and_default_seeding(isolated_db: Path) -> None:
    assert not isolated_db.exists()
    init_db()
    assert isolated_db.exists()

    board = get_board_for_user("user")
    assert len(board.columns) == 5
    assert [c.id for c in board.columns] == [
        "col-backlog",
        "col-discovery",
        "col-progress",
        "col-review",
        "col-done",
    ]
    assert "card-1" in board.cards


def test_board_api_requires_authentication() -> None:
    client = TestClient(app)
    get_res = client.get("/api/board")
    assert get_res.status_code == 401

    put_res = client.put("/api/board", json={"columns": [], "cards": {}})
    assert put_res.status_code == 401


def test_get_and_put_board_persists_mutations() -> None:
    client = TestClient(app)
    login_res = client.post(
        "/api/auth/login", json={"username": "user", "password": "password"}
    )
    assert login_res.status_code == 200

    initial_res = client.get("/api/board")
    assert initial_res.status_code == 200
    board = initial_res.json()
    assert len(board["columns"]) == 5

    # Rename first column, edit card-1, add card-99 to col-review, move card-2 to col-done
    board["columns"][0]["title"] = "Prioritized Backlog"
    board["columns"][0]["cardIds"] = ["card-1"]
    board["columns"][3]["cardIds"].append("card-99")
    board["columns"][4]["cardIds"].append("card-2")

    board["cards"]["card-1"]["title"] = "Updated roadmap themes"
    board["cards"]["card-99"] = {
        "id": "card-99",
        "title": "New backend card",
        "details": "Created in unit test",
    }

    put_res = client.put("/api/board", json=board)
    assert put_res.status_code == 200
    assert put_res.json()["columns"][0]["title"] == "Prioritized Backlog"

    after_res = client.get("/api/board")
    assert after_res.status_code == 200
    persisted = after_res.json()
    assert persisted["columns"][0]["title"] == "Prioritized Backlog"
    assert persisted["cards"]["card-1"]["title"] == "Updated roadmap themes"
    assert "card-99" in persisted["columns"][3]["cardIds"]
    assert "card-2" in persisted["columns"][4]["cardIds"]


def test_put_board_rejects_invalid_schema() -> None:
    client = TestClient(app)
    client.post("/api/auth/login", json={"username": "user", "password": "password"})

    # Invalid column IDs
    bad_columns_res = client.put(
        "/api/board",
        json={
            "columns": [{"id": "col-wrong", "title": "Wrong", "cardIds": []}],
            "cards": {},
        },
    )
    assert bad_columns_res.status_code == 422

    # Missing referenced card in cards dictionary
    board = client.get("/api/board").json()
    board["columns"][0]["cardIds"].append("card-nonexistent")
    missing_card_res = client.put("/api/board", json=board)
    assert missing_card_res.status_code == 422


def test_multi_user_board_isolation() -> None:
    user_a_board = get_board_for_user("alice")
    user_b_board = get_board_for_user("bob")

    user_a_board.columns[0].title = "Alice Backlog"
    save_board_for_user("alice", user_a_board)

    reloaded_a = get_board_for_user("alice")
    reloaded_b = get_board_for_user("bob")

    assert reloaded_a.columns[0].title == "Alice Backlog"
    assert reloaded_b.columns[0].title == "Backlog"
    assert user_b_board.columns[0].title == "Backlog"
