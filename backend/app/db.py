import hashlib
import json
import os
import sqlite3
from pathlib import Path

from app.schemas import BoardData, ChatMessage, INITIAL_BOARD_DATA

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "pm.db"


def get_db_path() -> Path:
    custom_path = os.getenv("DATABASE_PATH")
    if custom_path:
        return Path(custom_path)
    return DEFAULT_DB_PATH


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    target_path = db_path or get_db_path()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def ensure_user_with_default_board(
    conn: sqlite3.Connection,
    username: str,
    password: str = "password",
) -> int:
    row = conn.execute(
        "SELECT id FROM users WHERE username = ?", (username,)
    ).fetchone()
    if row is None:
        cursor = conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, hash_password(password)),
        )
        user_id = int(cursor.lastrowid)
    else:
        user_id = int(row["id"])

    board_row = conn.execute(
        "SELECT id FROM boards WHERE user_id = ?", (user_id,)
    ).fetchone()
    if board_row is None:
        initial_json = json.dumps(INITIAL_BOARD_DATA)
        conn.execute(
            "INSERT INTO boards (user_id, board_json) VALUES (?, ?)",
            (user_id, initial_json),
        )
    return user_id


def init_db(db_path: Path | None = None) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP )
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS boards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                board_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );
            """
        )
        ensure_user_with_default_board(conn, "user", "password")
        ensure_user_with_default_board(conn, "e2e-test-user", "password")
        conn.commit()


def verify_user_credentials(
    username: str, password: str, db_path: Path | None = None
) -> bool:
    init_db(db_path)
    with get_connection(db_path) as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
        if row is None:
            return False
        return str(row["password_hash"]) == hash_password(password)


def get_board_for_user(username: str, db_path: Path | None = None) -> BoardData:
    init_db(db_path)
    with get_connection(db_path) as conn:
        user_id = ensure_user_with_default_board(conn, username)
        conn.commit()
        row = conn.execute(
            "SELECT board_json FROM boards WHERE user_id = ?", (user_id,)
        ).fetchone()
        raw_data = json.loads(str(row["board_json"]))
        return BoardData.model_validate(raw_data)


def save_board_for_user(
    username: str, board: BoardData, db_path: Path | None = None
) -> BoardData:
    init_db(db_path)
    board_json = json.dumps(board.model_dump())
    with get_connection(db_path) as conn:
        user_id = ensure_user_with_default_board(conn, username)
        conn.execute(
            """
            UPDATE boards
            SET board_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
            """,
            (board_json, user_id),
        )
        conn.commit()
    return board


def get_chat_history_for_user(
    username: str, db_path: Path | None = None
) -> list[ChatMessage]:
    init_db(db_path)
    with get_connection(db_path) as conn:
        user_id = ensure_user_with_default_board(conn, username)
        conn.commit()
        rows = conn.execute(
            "SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY id ASC",
            (user_id,),
        ).fetchall()
        return [
            ChatMessage(role=str(row["role"]), content=str(row["content"]))
            for row in rows
        ]


def append_chat_messages_for_user(
    username: str,
    messages: list[ChatMessage],
    db_path: Path | None = None,
) -> None:
    if not messages:
        return
    init_db(db_path)
    with get_connection(db_path) as conn:
        user_id = ensure_user_with_default_board(conn, username)
        conn.executemany(
            "INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)",
            [(user_id, msg.role, msg.content) for msg in messages],
        )
        conn.commit()


def clear_chat_history_for_user(
    username: str, db_path: Path | None = None
) -> None:
    init_db(db_path)
    with get_connection(db_path) as conn:
        user_id = ensure_user_with_default_board(conn, username)
        conn.execute("DELETE FROM chat_messages WHERE user_id = ?", (user_id,))
        conn.commit()
