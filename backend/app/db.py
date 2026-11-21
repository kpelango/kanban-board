import hashlib
import hmac
import os
import secrets
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, NamedTuple

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from app.schemas import (
    GUEST_PREFIX,
    BoardData,
    BoardSummary,
    ChatMessage,
    ConversationSummary,
    UserSummary,
    board_template,
)

PBKDF2_ITERATIONS = 100_000
DEFAULT_CONVERSATION_TITLE = "New conversation"
SEED_USERS = ("user", "e2e-test-user")

Row = dict[str, Any]


# Passwords


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    _, iterations, salt, expected = stored.split("$")
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)
    )
    return hmac.compare_digest(digest.hex(), expected)


_DUMMY_HASH = hash_password(secrets.token_hex(16))


# Connection pool. The schema comes from supabase/migrations; this module never creates it.

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def get_pool() -> ConnectionPool:
    """Creates the pool on first use (tests and serverless functions never run startup hooks)."""
    global _pool
    with _pool_lock:
        if _pool is None:
            url = os.getenv("DATABASE_URL")
            if not url:
                raise RuntimeError("DATABASE_URL is not set")
            _pool = ConnectionPool(
                url,
                min_size=1,
                max_size=int(os.getenv("DB_POOL_MAX", "10")),
                # The Supabase transaction pooler cannot keep prepared statements
                kwargs={"row_factory": dict_row, "prepare_threshold": None},
                check=ConnectionPool.check_connection,
                open=True,
            )
        return _pool


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None


@contextmanager
def get_connection() -> Iterator[psycopg.Connection[Row]]:
    """Borrows a pooled connection; commits on success, rolls back on error, returns it."""
    with get_pool().connection() as conn:
        yield conn


def _create_user(
    conn: psycopg.Connection[Row],
    username: str,
    password_hash: str,
    is_admin: bool = False,
    is_guest: bool = False,
) -> int:
    row = conn.execute(
        """
        INSERT INTO users (username, password_hash, is_admin, is_guest)
        VALUES (%s, %s, %s, %s) RETURNING id
        """,
        (username, password_hash, is_admin, is_guest),
    ).fetchone()
    assert row is not None
    _create_board(conn, row["id"], "My First Board", "sample")
    return int(row["id"])


def _create_board(
    conn: psycopg.Connection[Row],
    user_id: int,
    name: str,
    template: str,
    board: BoardData | None = None,
) -> int:
    data = (board or board_template(template)).model_dump(mode="json")
    row = conn.execute(
        "INSERT INTO boards (user_id, name, board_json) VALUES (%s, %s, %s) RETURNING id",
        (user_id, name, Jsonb(data)),
    ).fetchone()
    assert row is not None
    return int(row["id"])


def seed_dev_users() -> None:
    """Creates `user` (admin) and `e2e-test-user`, password `password`. Local dev and tests only."""
    if os.getenv("SEED_DEV_USERS") != "1":
        return
    for username in SEED_USERS:
        create_user(username, "password", is_admin=username == "user")


# Users


def create_user(username: str, password: str, is_admin: bool = False) -> int | None:
    """Creates a user, or returns None if the name is taken ignoring case ("User" vs "user").

    Uniqueness is enforced by the database index, so concurrent sign-ups cannot both win.
    The whole transaction (user and starter board) rolls back on a duplicate.
    """
    password_hash = hash_password(password)  # hashed before borrowing a connection
    try:
        with get_connection() as conn:
            return _create_user(conn, username, password_hash, is_admin)
    except psycopg.errors.UniqueViolation:
        return None


def authenticate(username: str, password: str) -> str | None:
    """Returns the stored username (its original spelling) when the credentials match."""
    with get_connection() as conn:
        row = conn.execute(
            # Guests have no usable password and can never sign in again
            """
            SELECT username, password_hash FROM users
            WHERE lower(username) = lower(%s) AND NOT is_guest
            """,
            (username,),
        ).fetchone()
    if row is None:
        check_password(password, _DUMMY_HASH)  # same work as a real check, so timing does not reveal names
        return None
    if not check_password(password, row["password_hash"]):
        return None
    return str(row["username"])


GUEST_NAME_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"  # no look-alikes (l/1, o/0)
GUEST_LIFETIME_HOURS = 24


def create_guest() -> str:
    """Creates a demo account with the sample board and returns its username."""
    password_hash = hash_password(secrets.token_urlsafe(32))  # random, never shown to anyone
    for _ in range(5):
        username = GUEST_PREFIX + "".join(secrets.choice(GUEST_NAME_ALPHABET) for _ in range(6))
        try:
            with get_connection() as conn:
                _create_user(conn, username, password_hash, is_guest=True)
            return username
        except psycopg.errors.UniqueViolation:
            continue
    raise RuntimeError("Could not pick a free guest name")


def delete_expired_guests(hours: int = GUEST_LIFETIME_HOURS) -> int:
    """Deletes guests older than `hours` (their boards, chats, and AI usage cascade) and AI
    usage rows that no longer count toward any limit. Returns the number of guests deleted."""
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM users WHERE is_guest AND created_at < now() - make_interval(hours => %s)",
            (hours,),
        )
        conn.execute(f"DELETE FROM ai_usage WHERE created_at < now() - {AI_WINDOW}")
        return cursor.rowcount


AI_WINDOW = "interval '24 hours'"
_AI_QUOTA_LOCK = 7_310_001  # any constant; names the advisory lock below


def try_consume_ai_quota(user_id: int, limit: int, site_limit: int) -> str | None:
    """Records one AI request unless it would pass the user's or the site-wide limit for the
    last 24 hours. Returns None when recorded, else "user" or "site" for the limit reached.

    One transaction-scoped lock makes check-and-record atomic, so parallel requests cannot
    slip past either limit. Usage is not refunded if the AI call later fails.
    """
    with get_connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_AI_QUOTA_LOCK,))
        row = conn.execute(
            f"""
            SELECT COUNT(*) FILTER (WHERE user_id = %s) AS mine, COUNT(*) AS total
            FROM ai_usage WHERE created_at > now() - {AI_WINDOW}
            """,
            (user_id,),
        ).fetchone()
        assert row is not None
        if row["mine"] >= limit:
            return "user"
        if row["total"] >= site_limit:
            return "site"
        conn.execute("INSERT INTO ai_usage (user_id) VALUES (%s)", (user_id,))
        return None


class UserRecord(NamedTuple):
    id: int
    is_admin: bool
    is_guest: bool
    password_hash: str


def get_user(username: str) -> UserRecord | None:
    """Looks up a user by exact username."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, is_admin, is_guest, password_hash FROM users WHERE username = %s",
            (username,),
        ).fetchone()
    if row is None:
        return None
    return UserRecord(row["id"], row["is_admin"], row["is_guest"], row["password_hash"])


_USER_SUMMARY_SQL = """
    SELECT u.id, u.username, u.is_admin, u.created_at, COUNT(b.id) AS board_count
    FROM users u LEFT JOIN boards b ON b.user_id = u.id
"""


def _user_summary(row: Row) -> UserSummary:
    return UserSummary(
        id=row["id"],
        username=row["username"],
        isAdmin=row["is_admin"],
        createdAt=row["created_at"],
        boardCount=row["board_count"],
    )


def list_users() -> list[UserSummary]:
    with get_connection() as conn:
        rows = conn.execute(
            # Guests are hidden from admins; they expire on their own
            f"{_USER_SUMMARY_SQL} WHERE NOT u.is_guest GROUP BY u.id ORDER BY lower(u.username)"
        ).fetchall()
        return [_user_summary(row) for row in rows]


def get_user_summary(user_id: int) -> UserSummary | None:
    with get_connection() as conn:
        row = conn.execute(f"{_USER_SUMMARY_SQL} WHERE u.id = %s GROUP BY u.id", (user_id,)).fetchone()
        return _user_summary(row) if row else None


def user_exists(user_id: int) -> bool:
    with get_connection() as conn:
        return conn.execute("SELECT 1 FROM users WHERE id = %s", (user_id,)).fetchone() is not None


def set_admin(user_id: int, admin: bool) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE users SET is_admin = %s WHERE id = %s", (admin, user_id))


def set_password(user_id: int, password: str) -> None:
    password_hash = hash_password(password)
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id)
        )


def delete_user(user_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM users WHERE id = %s", (user_id,))


# Boards


# Card count is summed in SQL so listing boards never loads whole board documents
_SUMMARY_SQL = """
    SELECT id, name, updated_at,
        (SELECT COALESCE(SUM(jsonb_array_length(col -> 'cardIds')), 0)::int
         FROM jsonb_array_elements(board_json -> 'columns') AS col) AS card_count
    FROM boards
"""


def _summary(row: Row) -> BoardSummary:
    return BoardSummary(
        id=row["id"], name=row["name"], cardCount=row["card_count"], updatedAt=row["updated_at"]
    )


def _owned_summary(
    conn: psycopg.Connection[Row], user_id: int, board_id: int
) -> BoardSummary | None:
    row = conn.execute(
        f"{_SUMMARY_SQL} WHERE id = %s AND user_id = %s", (board_id, user_id)
    ).fetchone()
    return _summary(row) if row else None


def list_boards(user_id: int) -> list[BoardSummary]:
    with get_connection() as conn:
        rows = conn.execute(f"{_SUMMARY_SQL} WHERE user_id = %s ORDER BY id", (user_id,)).fetchall()
        return [_summary(row) for row in rows]


def create_board(
    user_id: int, name: str, template: str, board: BoardData | None = None
) -> BoardSummary:
    with get_connection() as conn:
        board_id = _create_board(conn, user_id, name, template, board)
        summary = _owned_summary(conn, user_id, board_id)
        assert summary is not None
        return summary


def _owned_board(conn: psycopg.Connection[Row], user_id: int, board_id: int) -> Row | None:
    return conn.execute(
        "SELECT * FROM boards WHERE id = %s AND user_id = %s", (board_id, user_id)
    ).fetchone()


def get_board(user_id: int, board_id: int) -> BoardData | None:
    with get_connection() as conn:
        row = _owned_board(conn, user_id, board_id)
        return BoardData.model_validate(row["board_json"]) if row else None


def save_board(user_id: int, board_id: int, board: BoardData) -> BoardData | None:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE boards SET board_json = %s, updated_at = now()
            WHERE id = %s AND user_id = %s
            """,
            (Jsonb(board.model_dump(mode="json")), board_id, user_id),
        )
        return board if cursor.rowcount else None


def rename_board(user_id: int, board_id: int, name: str) -> BoardSummary | None:
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE boards SET name = %s, updated_at = now()
            WHERE id = %s AND user_id = %s
            """,
            (name, board_id, user_id),
        )
        return _owned_summary(conn, user_id, board_id)


def owns_board(user_id: int, board_id: int) -> bool:
    with get_connection() as conn:
        return conn.execute(
            "SELECT 1 FROM boards WHERE id = %s AND user_id = %s", (board_id, user_id)
        ).fetchone() is not None


def count_boards(user_id: int) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM boards WHERE user_id = %s", (user_id,)
        ).fetchone()
    assert row is not None
    return int(row["n"])


def delete_board(user_id: int, board_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM boards WHERE id = %s AND user_id = %s", (board_id, user_id)
        )
        return cursor.rowcount > 0


# Conversations


def _conversation_summary(row: Row) -> ConversationSummary:
    return ConversationSummary(
        id=row["id"], boardId=row["board_id"], title=row["title"], updatedAt=row["updated_at"]
    )


def _owned_conversation(
    conn: psycopg.Connection[Row], user_id: int, conversation_id: int
) -> Row | None:
    return conn.execute(
        """
        SELECT c.* FROM conversations c JOIN boards b ON b.id = c.board_id
        WHERE c.id = %s AND b.user_id = %s
        """,
        (conversation_id, user_id),
    ).fetchone()


def list_conversations(user_id: int, board_id: int) -> list[ConversationSummary] | None:
    with get_connection() as conn:
        if _owned_board(conn, user_id, board_id) is None:
            return None
        rows = conn.execute(
            "SELECT * FROM conversations WHERE board_id = %s ORDER BY updated_at DESC, id DESC",
            (board_id,),
        ).fetchall()
        return [_conversation_summary(row) for row in rows]


def create_conversation(
    user_id: int, board_id: int, title: str | None
) -> ConversationSummary | None:
    with get_connection() as conn:
        if _owned_board(conn, user_id, board_id) is None:
            return None
        row = conn.execute(
            "INSERT INTO conversations (board_id, title) VALUES (%s, %s) RETURNING *",
            (board_id, title or DEFAULT_CONVERSATION_TITLE),
        ).fetchone()
        return _conversation_summary(row)


def get_conversation(user_id: int, conversation_id: int) -> ConversationSummary | None:
    with get_connection() as conn:
        row = _owned_conversation(conn, user_id, conversation_id)
        return _conversation_summary(row) if row else None


def get_messages(conversation_id: int, limit: int | None = None) -> list[ChatMessage]:
    """Messages oldest first; with a limit, only the most recent ones (LIMIT NULL = all)."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT role, content FROM chat_messages WHERE conversation_id = %s
            ORDER BY id DESC LIMIT %s
            """,
            (conversation_id, limit),
        ).fetchall()
        return [ChatMessage(role=row["role"], content=row["content"]) for row in reversed(rows)]


def append_messages(
    conversation_id: int, messages: list[ChatMessage], title: str | None = None
) -> ConversationSummary:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO chat_messages (conversation_id, role, content) VALUES (%s, %s, %s)",
                [(conversation_id, msg.role, msg.content) for msg in messages],
            )
        row = conn.execute(
            """
            UPDATE conversations SET title = COALESCE(%s::text, title), updated_at = now()
            WHERE id = %s RETURNING *
            """,
            (title, conversation_id),
        ).fetchone()
        return _conversation_summary(row)


def rename_conversation(
    user_id: int, conversation_id: int, title: str
) -> ConversationSummary | None:
    with get_connection() as conn:
        if _owned_conversation(conn, user_id, conversation_id) is None:
            return None
        conn.execute(
            "UPDATE conversations SET title = %s, updated_at = now() WHERE id = %s",
            (title, conversation_id),
        )
        return _conversation_summary(_owned_conversation(conn, user_id, conversation_id))


def delete_conversation(user_id: int, conversation_id: int) -> bool:
    with get_connection() as conn:
        if _owned_conversation(conn, user_id, conversation_id) is None:
            return False
        conn.execute("DELETE FROM conversations WHERE id = %s", (conversation_id,))
        return True
