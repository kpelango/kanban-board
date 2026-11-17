import os
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

# Tests always use their own database, set before the app loads `.env`
# (load_dotenv never overrides variables that are already set).
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/kanban_test"
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SESSION_SECRET_KEY"] = "test-session-secret"
os.environ["SEED_DEV_USERS"] = "1"

from app import db  # noqa: E402
from app.main import app  # noqa: E402

TEST_DB_NAME = psycopg.conninfo.conninfo_to_dict(TEST_DATABASE_URL)["dbname"]
# Every test truncates all tables, so never run against anything but a throwaway database
assert TEST_DB_NAME.endswith("_test"), f"Refusing to run tests against {TEST_DB_NAME!r}"

TABLES = "users, boards, conversations, chat_messages, ai_usage"


def _migrations_dir() -> Path:
    here = Path(__file__).resolve()
    for candidate in (here.parents[2] / "supabase" / "migrations", here.parents[1] / "supabase" / "migrations"):
        if candidate.is_dir():
            return candidate
    raise RuntimeError("supabase/migrations not found")


@pytest.fixture(scope="session", autouse=True)
def test_database() -> Iterator[None]:
    """Recreates the test database from the migrations once per test run."""
    admin_url = psycopg.conninfo.make_conninfo(TEST_DATABASE_URL, dbname="postgres")
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
        for migration in sorted(_migrations_dir().glob("*.sql")):
            conn.execute(migration.read_text())
    yield
    db.close_pool()


@pytest.fixture(autouse=True)
def clean_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test starts with only the seeded dev accounts."""
    monkeypatch.setenv("SEED_DEV_USERS", "1")
    for name in ("CRON_SECRET", "AI_DAILY_LIMIT", "AI_DAILY_LIMIT_GUEST", "VERCEL"):
        monkeypatch.delenv(name, raising=False)  # tests opt in to these explicitly
    with db.get_connection() as conn:
        conn.execute(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE")
    db.seed_dev_users()


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


@pytest.fixture
def guest() -> TestClient:
    """A client signed in as a brand-new demo guest."""
    test_client = TestClient(app)
    assert test_client.post("/api/auth/guest").status_code == 201
    return test_client


def backdate(table: str, column: str, where: str, params: tuple, hours: float) -> None:
    """Moves timestamps into the past, e.g. to make a guest look a day old."""
    with db.get_connection() as conn:
        conn.execute(
            f"UPDATE {table} SET {column} = {column} - make_interval(secs => %s) WHERE {where}",
            (hours * 3600, *params),
        )


def first_board_id(client: TestClient) -> int:
    return client.get("/api/boards").json()[0]["id"]
