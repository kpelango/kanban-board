import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import NamedTuple

from app.schemas import (
    BoardData,
    BoardSummary,
    ChatMessage,
    ConversationSummary,
    UserSummary,
    board_template,
)

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "pm.db"
PBKDF2_ITERATIONS = 100_000
DEFAULT_CONVERSATION_TITLE = "New conversation"
SEED_USERS = ("user", "e2e-test-user")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users (username COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    board_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
    updated_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_boards_user ON boards (user_id);
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
    updated_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
    FOREIGN KEY (board_id) REFERENCES boards (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversations_board ON conversations (board_id);
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages (conversation_id);
"""

_initialized_paths: set[Path] = set()


def get_db_path() -> Path:
    custom_path = os.getenv("DATABASE_PATH")
    return Path(custom_path) if custom_path else DEFAULT_DB_PATH


# Passwords


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    if "$" not in stored:
        # Legacy unsalted SHA-256 hash from Phase 1
        legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(legacy, stored)
    _, iterations, salt, expected = stored.split("$")
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)
    )
    return hmac.compare_digest(digest.hex(), expected)


# Connection, schema, migration


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def _migrate_phase1(conn: sqlite3.Connection) -> None:
    """Upgrade the Phase 1 schema (one board per user, chat per user) in place."""
    user_cols = _table_columns(conn, "users")
    if user_cols and "is_admin" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")

    board_cols = _table_columns(conn, "boards")
    if board_cols and "name" not in board_cols:
        conn.executescript(
            """
            CREATE TABLE boards_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                board_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
                updated_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );
            INSERT INTO boards_new (id, user_id, name, board_json, updated_at)
                SELECT id, user_id, 'My Board', board_json, updated_at FROM boards;
            DROP TABLE boards;
            ALTER TABLE boards_new RENAME TO boards;
            """
        )

    message_cols = _table_columns(conn, "chat_messages")
    if message_cols and "conversation_id" not in message_cols:
        conn.execute("ALTER TABLE chat_messages RENAME TO chat_messages_legacy")
        conn.executescript(SCHEMA)
        user_ids = [
            row["user_id"]
            for row in conn.execute(
                "SELECT DISTINCT user_id FROM chat_messages_legacy"
            )
        ]
        for user_id in user_ids:
            board = conn.execute(
                "SELECT id FROM boards WHERE user_id = ? ORDER BY id LIMIT 1",
                (user_id,),
            ).fetchone()
            if board is None:
                continue
            conversation_id = conn.execute(
                "INSERT INTO conversations (board_id, title) VALUES (?, 'Previous chat')",
                (board["id"],),
            ).lastrowid
            conn.execute(
                """
                INSERT INTO chat_messages (conversation_id, role, content, created_at)
                SELECT ?, role, content, created_at FROM chat_messages_legacy
                WHERE user_id = ? ORDER BY id
                """,
                (conversation_id, user_id),
            )
        conn.execute("DROP TABLE chat_messages_legacy")


def _create_user(conn: sqlite3.Connection, username: str, password: str) -> int:
    user_id = int(
        conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, hash_password(password)),
        ).lastrowid
    )
    _create_board(conn, user_id, "My First Board", "sample")
    return user_id


def _create_board(
    conn: sqlite3.Connection,
    user_id: int,
    name: str,
    template: str,
    board: BoardData | None = None,
) -> int:
    data = (board or board_template(template)).model_dump(mode="json")
    return int(
        conn.execute(
            "INSERT INTO boards (user_id, name, board_json) VALUES (?, ?, ?)",
            (user_id, name, json.dumps(data)),
        ).lastrowid
    )


def init_db(db_path: Path | None = None) -> None:
    path = db_path or get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        _migrate_phase1(conn)
        conn.executescript(SCHEMA)
        for username in SEED_USERS:
            exists = conn.execute(
                "SELECT 1 FROM users WHERE username = ?", (username,)
            ).fetchone()
            if not exists:
                _create_user(conn, username, "password")
        # The seeded account administers a fresh install until someone else is made admin
        conn.execute(
            """
            UPDATE users SET is_admin = 1 WHERE username = 'user'
            AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)
            """
        )
        # Users from Phase 1 always have a board; guarantee it for anyone else too
        for row in conn.execute(
            "SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM boards)"
        ).fetchall():
            _create_board(conn, row["id"], "My First Board", "sample")
        conn.commit()
    finally:
        conn.close()
    _initialized_paths.add(path)


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """Opens a connection, commits on success, rolls back on error, and always closes it."""
    path = get_db_path()
    if path not in _initialized_paths or not path.exists():
        init_db(path)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


# Users


def create_user(username: str, password: str) -> int | None:
    """Creates a user, or returns None if the name is taken ignoring case ("User" vs "user").

    Uniqueness is enforced by the database index, so concurrent sign-ups cannot both win.
    """
    try:
        with get_connection() as conn:
            return _create_user(conn, username, password)
    except sqlite3.IntegrityError:
        return None


def authenticate(username: str, password: str) -> str | None:
    """Returns the stored username (its original spelling) when the credentials match."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE",
            (username,),
        ).fetchone()
        if row is None or not check_password(password, row["password_hash"]):
            return None
        if "$" not in row["password_hash"]:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(password), row["id"]),
            )
        return str(row["username"])


class UserRecord(NamedTuple):
    id: int
    is_admin: bool
    password_hash: str


def get_user(username: str) -> UserRecord | None:
    """Looks up a user by exact username."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, is_admin, password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
        if row is None:
            return None
        return UserRecord(int(row["id"]), bool(row["is_admin"]), str(row["password_hash"]))


def get_user_id(username: str) -> int | None:
    user = get_user(username)
    return user.id if user else None


def is_admin(username: str) -> bool:
    user = get_user(username)
    return bool(user and user.is_admin)


_USER_SUMMARY_SQL = """
    SELECT u.id, u.username, u.is_admin, u.created_at, COUNT(b.id) AS board_count
    FROM users u LEFT JOIN boards b ON b.user_id = u.id
"""


def _user_summary(row: sqlite3.Row) -> UserSummary:
    return UserSummary(
        id=row["id"],
        username=row["username"],
        isAdmin=bool(row["is_admin"]),
        createdAt=row["created_at"],
        boardCount=row["board_count"],
    )


def list_users() -> list[UserSummary]:
    with get_connection() as conn:
        rows = conn.execute(
            f"{_USER_SUMMARY_SQL} GROUP BY u.id ORDER BY u.username COLLATE NOCASE"
        ).fetchall()
        return [_user_summary(row) for row in rows]


def get_user_summary(user_id: int) -> UserSummary | None:
    with get_connection() as conn:
        row = conn.execute(f"{_USER_SUMMARY_SQL} WHERE u.id = ? GROUP BY u.id", (user_id,)).fetchone()
        return _user_summary(row) if row else None


def user_exists(user_id: int) -> bool:
    with get_connection() as conn:
        return conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is not None


def set_admin(user_id: int, admin: bool) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE users SET is_admin = ? WHERE id = ?", (int(admin), user_id))


def set_password(user_id: int, password: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(password), user_id),
        )


def delete_user(user_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))


# Boards


# Card count is summed in SQL (JSON1) so listing boards never parses whole board documents
_SUMMARY_SQL = """
    SELECT id, name, updated_at,
        (SELECT COALESCE(SUM(json_array_length(value, '$.cardIds')), 0)
         FROM json_each(board_json, '$.columns')) AS card_count
    FROM boards
"""


def _summary(row: sqlite3.Row) -> BoardSummary:
    return BoardSummary(
        id=row["id"], name=row["name"], cardCount=row["card_count"], updatedAt=row["updated_at"]
    )


def _owned_summary(conn: sqlite3.Connection, user_id: int, board_id: int) -> BoardSummary | None:
    row = conn.execute(
        f"{_SUMMARY_SQL} WHERE id = ? AND user_id = ?", (board_id, user_id)
    ).fetchone()
    return _summary(row) if row else None


def list_boards(user_id: int) -> list[BoardSummary]:
    with get_connection() as conn:
        rows = conn.execute(f"{_SUMMARY_SQL} WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()
        return [_summary(row) for row in rows]


def create_board(
    user_id: int, name: str, template: str, board: BoardData | None = None
) -> BoardSummary:
    with get_connection() as conn:
        board_id = _create_board(conn, user_id, name, template, board)
        summary = _owned_summary(conn, user_id, board_id)
        assert summary is not None
        return summary


def _owned_board(conn: sqlite3.Connection, user_id: int, board_id: int) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM boards WHERE id = ? AND user_id = ?", (board_id, user_id)
    ).fetchone()


def get_board(user_id: int, board_id: int) -> BoardData | None:
    with get_connection() as conn:
        row = _owned_board(conn, user_id, board_id)
        return BoardData.model_validate_json(row["board_json"]) if row else None


def save_board(user_id: int, board_id: int, board: BoardData) -> BoardData | None:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE boards SET board_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (board.model_dump_json(), board_id, user_id),
        )
        return board if cursor.rowcount else None


def rename_board(user_id: int, board_id: int, name: str) -> BoardSummary | None:
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE boards SET name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (name, board_id, user_id),
        )
        return _owned_summary(conn, user_id, board_id)


def owns_board(user_id: int, board_id: int) -> bool:
    with get_connection() as conn:
        return conn.execute(
            "SELECT 1 FROM boards WHERE id = ? AND user_id = ?", (board_id, user_id)
        ).fetchone() is not None


def count_boards(user_id: int) -> int:
    with get_connection() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM boards WHERE user_id = ?", (user_id,)
        ).fetchone()[0]


def delete_board(user_id: int, board_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM boards WHERE id = ? AND user_id = ?", (board_id, user_id)
        )
        return cursor.rowcount > 0


# Conversations


def _conversation_summary(row: sqlite3.Row) -> ConversationSummary:
    return ConversationSummary(
        id=row["id"], boardId=row["board_id"], title=row["title"], updatedAt=row["updated_at"]
    )


def _owned_conversation(
    conn: sqlite3.Connection, user_id: int, conversation_id: int
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT c.* FROM conversations c JOIN boards b ON b.id = c.board_id
        WHERE c.id = ? AND b.user_id = ?
        """,
        (conversation_id, user_id),
    ).fetchone()


def list_conversations(user_id: int, board_id: int) -> list[ConversationSummary] | None:
    with get_connection() as conn:
        if _owned_board(conn, user_id, board_id) is None:
            return None
        rows = conn.execute(
            "SELECT * FROM conversations WHERE board_id = ? ORDER BY updated_at DESC, id DESC",
            (board_id,),
        ).fetchall()
        return [_conversation_summary(row) for row in rows]


def create_conversation(
    user_id: int, board_id: int, title: str | None
) -> ConversationSummary | None:
    with get_connection() as conn:
        if _owned_board(conn, user_id, board_id) is None:
            return None
        conversation_id = conn.execute(
            "INSERT INTO conversations (board_id, title) VALUES (?, ?)",
            (board_id, title or DEFAULT_CONVERSATION_TITLE),
        ).lastrowid
        row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        return _conversation_summary(row)


def get_conversation(user_id: int, conversation_id: int) -> ConversationSummary | None:
    with get_connection() as conn:
        row = _owned_conversation(conn, user_id, conversation_id)
        return _conversation_summary(row) if row else None


def get_messages(conversation_id: int, limit: int = -1) -> list[ChatMessage]:
    """Messages oldest first; with a limit, only the most recent ones."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT role, content FROM chat_messages WHERE conversation_id = ?
            ORDER BY id DESC LIMIT ?
            """,
            (conversation_id, limit),
        ).fetchall()
        return [ChatMessage(role=row["role"], content=row["content"]) for row in reversed(rows)]


def append_messages(
    conversation_id: int, messages: list[ChatMessage], title: str | None = None
) -> ConversationSummary:
    with get_connection() as conn:
        conn.executemany(
            "INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)",
            [(conversation_id, msg.role, msg.content) for msg in messages],
        )
        conn.execute(
            """
            UPDATE conversations SET title = COALESCE(?, title), updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (title, conversation_id),
        )
        row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        return _conversation_summary(row)


def rename_conversation(
    user_id: int, conversation_id: int, title: str
) -> ConversationSummary | None:
    with get_connection() as conn:
        if _owned_conversation(conn, user_id, conversation_id) is None:
            return None
        conn.execute(
            "UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (title, conversation_id),
        )
        return _conversation_summary(_owned_conversation(conn, user_id, conversation_id))


def delete_conversation(user_id: int, conversation_id: int) -> bool:
    with get_connection() as conn:
        if _owned_conversation(conn, user_id, conversation_id) is None:
            return False
        conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        return True
