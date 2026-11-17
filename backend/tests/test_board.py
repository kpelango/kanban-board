import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.schemas import INITIAL_BOARD_DATA
from tests.conftest import first_board_id, login


def test_dev_users_are_seeded_with_a_sample_board() -> None:
    assert db.is_admin("user")
    assert not db.is_admin("e2e-test-user")
    for username in ("user", "e2e-test-user"):
        user_id = db.get_user_id(username)
        boards = db.list_boards(user_id)
        assert len(boards) == 1
        board = db.get_board(user_id, boards[0].id)
        assert [c.id for c in board.columns] == [
            "col-backlog",
            "col-discovery",
            "col-progress",
            "col-review",
            "col-done",
        ]
        assert board.cards["card-1"].priority == "high"


def test_board_api_requires_authentication(anon: TestClient) -> None:
    assert anon.get("/api/boards").status_code == 401
    assert anon.post("/api/boards", json={"name": "X"}).status_code == 401
    assert anon.get("/api/boards/1").status_code == 401
    assert anon.put("/api/boards/1", json={"columns": [], "cards": {}}).status_code == 401
    assert anon.patch("/api/boards/1", json={"name": "X"}).status_code == 401
    assert anon.delete("/api/boards/1").status_code == 401


def test_list_boards_returns_summaries(client: TestClient) -> None:
    boards = client.get("/api/boards").json()
    assert len(boards) == 1
    assert boards[0]["name"] == "My First Board"
    assert boards[0]["cardCount"] == 8
    assert boards[0]["updatedAt"]


def test_create_board_from_templates(client: TestClient) -> None:
    sample = client.post("/api/boards", json={"name": "Launch plan"})
    assert sample.status_code == 201
    assert sample.json()["name"] == "Launch plan"
    assert sample.json()["cardCount"] == 8

    blank = client.post("/api/boards", json={"name": "  Blank  ", "template": "blank"})
    assert blank.status_code == 201
    assert blank.json()["name"] == "Blank"
    blank_board = client.get(f"/api/boards/{blank.json()['id']}").json()
    assert blank_board["cards"] == {}
    assert [c["cardIds"] for c in blank_board["columns"]] == [[]] * 5

    assert len(client.get("/api/boards").json()) == 3

    assert client.post("/api/boards", json={"name": ""}).status_code == 422
    assert client.post("/api/boards", json={"name": "x", "template": "nope"}).status_code == 422


def test_create_board_from_data(client: TestClient) -> None:
    source_id = first_board_id(client)
    source = client.get(f"/api/boards/{source_id}").json()
    source["columns"][0]["title"] = "Imported Backlog"
    source["cards"]["card-1"]["labels"] = ["imported"]

    res = client.post("/api/boards", json={"name": "Imported", "data": source})
    assert res.status_code == 201
    assert res.json()["cardCount"] == 8
    copy = client.get(f"/api/boards/{res.json()['id']}").json()
    assert copy == source

    # The copy is independent of the original
    copy["columns"][0]["title"] = "Changed copy"
    client.put(f"/api/boards/{res.json()['id']}", json=copy)
    assert client.get(f"/api/boards/{source_id}").json()["columns"][0]["title"] == "Backlog"


def test_create_board_rejects_invalid_data(client: TestClient) -> None:
    bad = {"columns": [{"id": "col-x", "title": "X", "cardIds": []}], "cards": {}}
    res = client.post("/api/boards", json={"name": "Broken", "data": bad})
    assert res.status_code == 422
    assert len(client.get("/api/boards").json()) == 1


def test_get_and_put_board_persists_mutations(client: TestClient) -> None:
    board_id = first_board_id(client)
    board = client.get(f"/api/boards/{board_id}").json()

    board["columns"][0]["title"] = "Prioritized Backlog"
    board["columns"][0]["cardIds"] = ["card-1"]
    board["columns"][2]["wipLimit"] = 3
    board["columns"][3]["cardIds"].append("card-99")
    board["columns"][4]["cardIds"].append("card-2")
    board["cards"]["card-1"]["title"] = "Updated roadmap themes"
    board["cards"]["card-99"] = {
        "id": "card-99",
        "title": "New backend card",
        "details": "Created in unit test",
        "priority": "medium",
        "dueDate": "2026-12-01",
        "labels": ["api", "backend"],
        "checklist": [
            {"id": "item-1", "text": "Write endpoint", "done": True},
            {"id": "item-2", "text": "Add tests"},
        ],
    }

    put_res = client.put(f"/api/boards/{board_id}", json=board)
    assert put_res.status_code == 200

    persisted = client.get(f"/api/boards/{board_id}").json()
    assert persisted["columns"][0]["title"] == "Prioritized Backlog"
    assert persisted["columns"][2]["wipLimit"] == 3
    assert persisted["cards"]["card-1"]["title"] == "Updated roadmap themes"
    assert persisted["cards"]["card-99"]["dueDate"] == "2026-12-01"
    assert persisted["cards"]["card-99"]["labels"] == ["api", "backend"]
    assert persisted["cards"]["card-99"]["checklist"] == [
        {"id": "item-1", "text": "Write endpoint", "done": True},
        {"id": "item-2", "text": "Add tests", "done": False},
    ]
    assert "card-99" in persisted["columns"][3]["cardIds"]
    assert "card-2" in persisted["columns"][4]["cardIds"]
    assert client.get("/api/boards").json()[0]["cardCount"] == 9


def test_cards_without_new_fields_get_defaults(client: TestClient) -> None:
    board_id = first_board_id(client)
    board = client.get(f"/api/boards/{board_id}").json()
    board["cards"]["card-7"] = {"id": "card-7", "title": "Old style", "details": "x"}
    res = client.put(f"/api/boards/{board_id}", json=board)
    assert res.status_code == 200
    card = res.json()["cards"]["card-7"]
    assert card["priority"] == "none"
    assert card["dueDate"] is None
    assert card["labels"] == []
    assert card["checklist"] == []


def test_put_board_rejects_invalid_schema(client: TestClient) -> None:
    board_id = first_board_id(client)

    bad_columns = client.put(
        f"/api/boards/{board_id}",
        json={"columns": [{"id": "col-wrong", "title": "Wrong", "cardIds": []}], "cards": {}},
    )
    assert bad_columns.status_code == 422

    board = client.get(f"/api/boards/{board_id}").json()
    missing_card = json.loads(json.dumps(board))
    missing_card["columns"][0]["cardIds"].append("card-nonexistent")
    assert client.put(f"/api/boards/{board_id}", json=missing_card).status_code == 422

    duplicate = json.loads(json.dumps(board))
    duplicate["columns"][1]["cardIds"].append("card-1")
    assert client.put(f"/api/boards/{board_id}", json=duplicate).status_code == 422

    for field, value in (
        ("priority", "urgent"),
        ("dueDate", "2026-13-45"),
        ("labels", ["x" * 31]),
        ("checklist", [{"id": "item-1", "text": ""}]),
        ("checklist", [{"id": "item-1", "text": "a"}, {"id": "item-1", "text": "b"}]),
        ("checklist", [{"id": f"item-{i}", "text": "x"} for i in range(51)]),
    ):
        bad_card = json.loads(json.dumps(board))
        bad_card["cards"]["card-1"][field] = value
        assert client.put(f"/api/boards/{board_id}", json=bad_card).status_code == 422, field

    bad_wip = json.loads(json.dumps(board))
    bad_wip["columns"][0]["wipLimit"] = 0
    assert client.put(f"/api/boards/{board_id}", json=bad_wip).status_code == 422


def test_archived_cards_persist_and_are_excluded_from_counts(client: TestClient) -> None:
    board_id = first_board_id(client)
    board = client.get(f"/api/boards/{board_id}").json()
    assert board["archived"] == {}

    board["columns"][4]["cardIds"].remove("card-7")
    board["archived"] = {"card-7": "col-done"}
    res = client.put(f"/api/boards/{board_id}", json=board)
    assert res.status_code == 200

    persisted = client.get(f"/api/boards/{board_id}").json()
    assert persisted["archived"] == {"card-7": "col-done"}
    assert "card-7" in persisted["cards"]
    assert client.get("/api/boards").json()[0]["cardCount"] == 7


def test_archived_map_is_validated(client: TestClient) -> None:
    board_id = first_board_id(client)
    board = client.get(f"/api/boards/{board_id}").json()

    for archived in (
        {"card-missing": "col-done"},  # not in cards
        {"card-1": "col-done"},  # still in a column
        {"card-7": "col-nowhere"},  # unknown column
    ):
        bad = json.loads(json.dumps(board))
        bad["columns"][4]["cardIds"].remove("card-7")
        bad["archived"] = archived
        assert client.put(f"/api/boards/{board_id}", json=bad).status_code == 422, archived


def test_rename_board(client: TestClient) -> None:
    board_id = first_board_id(client)
    res = client.patch(f"/api/boards/{board_id}", json={"name": "Roadmap"})
    assert res.status_code == 200
    assert res.json()["name"] == "Roadmap"
    assert client.get("/api/boards").json()[0]["name"] == "Roadmap"
    assert client.patch(f"/api/boards/{board_id}", json={"name": "   "}).status_code == 422


def test_delete_board_keeps_at_least_one(client: TestClient) -> None:
    board_id = first_board_id(client)
    last = client.delete(f"/api/boards/{board_id}")
    assert last.status_code == 400
    assert last.json() == {"detail": "You must keep at least one board"}

    second = client.post("/api/boards", json={"name": "Second"}).json()
    client.post(f"/api/boards/{second['id']}/conversations", json={})
    assert client.delete(f"/api/boards/{second['id']}").status_code == 204
    assert [b["id"] for b in client.get("/api/boards").json()] == [board_id]
    assert client.get(f"/api/boards/{second['id']}").status_code == 404
    assert client.delete(f"/api/boards/{second['id']}").status_code == 404


def test_boards_are_isolated_between_users(client: TestClient) -> None:
    user_board_id = first_board_id(client)

    other = TestClient(app)
    login(other, "e2e-test-user")
    other_board_id = first_board_id(other)
    assert other_board_id != user_board_id

    board = client.get(f"/api/boards/{user_board_id}").json()
    assert other.get(f"/api/boards/{user_board_id}").status_code == 404
    assert other.put(f"/api/boards/{user_board_id}", json=board).status_code == 404
    assert other.patch(f"/api/boards/{user_board_id}", json={"name": "Hacked"}).status_code == 404
    assert other.delete(f"/api/boards/{user_board_id}").status_code == 404

    board["columns"][0]["title"] = "User Backlog"
    client.put(f"/api/boards/{user_board_id}", json=board)
    assert other.get(f"/api/boards/{other_board_id}").json()["columns"][0]["title"] == "Backlog"


def test_seeding_is_off_unless_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    with db.get_connection() as conn:
        conn.execute("TRUNCATE users RESTART IDENTITY CASCADE")
    monkeypatch.delenv("SEED_DEV_USERS")
    db.seed_dev_users()
    assert db.get_user("user") is None

    monkeypatch.setenv("SEED_DEV_USERS", "1")
    db.seed_dev_users()
    db.seed_dev_users()  # running twice is harmless
    assert db.is_admin("user")
    assert len(db.list_boards(db.get_user_id("user"))) == 1


def test_connections_are_returned_to_the_pool(client: TestClient) -> None:
    board_id = first_board_id(client)
    client.put(f"/api/boards/{board_id}", json=client.get(f"/api/boards/{board_id}").json())
    stats = db.get_pool().get_stats()
    assert stats["pool_size"] == stats["pool_available"]


def test_timestamps_are_iso_with_timezone(client: TestClient) -> None:
    board = client.get("/api/boards").json()[0]
    assert datetime.fromisoformat(board["updatedAt"]).tzinfo is not None
    board_id = board["id"]
    convo = client.post(f"/api/boards/{board_id}/conversations", json={}).json()
    assert datetime.fromisoformat(convo["updatedAt"]).tzinfo is not None


def test_failed_writes_roll_back() -> None:
    try:
        with db.get_connection() as conn:
            conn.execute("UPDATE boards SET name = 'Half done'")
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    assert {b.name for b in db.list_boards(db.get_user_id("user"))} == {"My First Board"}


def test_board_summary_counts_cards_in_columns_via_sql(client: TestClient) -> None:
    board_id = first_board_id(client)
    summary = next(b for b in client.get("/api/boards").json() if b["id"] == board_id)
    assert summary["cardCount"] == sum(len(c["cardIds"]) for c in INITIAL_BOARD_DATA["columns"])
    renamed = client.patch(f"/api/boards/{board_id}", json={"name": "Renamed"}).json()
    assert renamed["cardCount"] == summary["cardCount"]
