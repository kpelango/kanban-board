# Database Schema and Persistence Design

## Overview

SQLite database at `/app/data/pm.db` in the container (mounted from `./data/pm.db`; override with `DATABASE_PATH`). `backend/app/db.py` creates the schema on first use, migrates Phase 1 databases in place, and seeds the `user` and `e2e-test-user` accounts (password `password`), each with one sample board.

## Schema

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,           -- pbkdf2_sha256$<iterations>$<salt hex>$<hash hex>
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP )
);

CREATE UNIQUE INDEX idx_users_username_nocase ON users (username COLLATE NOCASE);

CREATE TABLE boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    board_json TEXT NOT NULL,              -- BoardData document, see below
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
    updated_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP )
);

CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
    updated_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP )
);

CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP )
);
```

Ownership flows user -> boards -> conversations -> messages. Every query filters by the signed-in user's id (directly or through a join), so another user's ids return 404. Deleting a user or board cascades to everything below it. A user must keep at least one board.

## `board_json` (BoardData)

```json
{
  "columns": [
    { "id": "col-backlog", "title": "Backlog", "cardIds": ["card-1"], "wipLimit": null },
    { "id": "col-discovery", "title": "Discovery", "cardIds": [] },
    { "id": "col-progress", "title": "In Progress", "cardIds": [], "wipLimit": 3 },
    { "id": "col-review", "title": "Review", "cardIds": [] },
    { "id": "col-done", "title": "Done", "cardIds": [] }
  ],
  "cards": {
    "card-1": {
      "id": "card-1",
      "title": "Align roadmap themes",
      "details": "Draft quarterly themes with impact statements and metrics.",
      "priority": "high",
      "dueDate": "2026-12-01",
      "labels": ["strategy"],
      "checklist": [{ "id": "item-1", "text": "Draft themes", "done": true }]
    }
  },
  "archived": { "card-9": "col-done" }
}
```

Validation (Pydantic, `backend/app/schemas.py`):
- Exactly the 5 fixed column ids, in order; titles non-empty; `wipLimit` is null or 1-99.
- Every `cardIds` entry exists in `cards` with a matching `id`; no card in two columns.
- `priority` is `none|low|medium|high` (default `none`); `dueDate` is a real `YYYY-MM-DD` date or null; `labels` has at most 10 entries of 1-30 characters; `checklist` has at most 50 items (`text` 1-200 characters, ids unique within the card). `archived` maps archived card ids to the column they are restored to; archived cards stay in `cards` but must not be in any column. Board card counts exclude archived cards. Missing optional fields get defaults, so Phase 1 documents stay valid.

## Files next to the database

`session_secret`: random key used to sign session cookies when `SESSION_SECRET_KEY` is not set. Deleting it signs everyone out.

## Phase 1 migration

On startup, a database with the old schema (`boards.user_id UNIQUE`, no `name`; `chat_messages.user_id`) is upgraded in place: boards are copied into the new table named "My Board", and each user's old chat messages move into a "Previous chat" conversation on their first board. `users.is_admin` is added if missing; when no admin exists, the `user` account becomes admin. Legacy unsalted SHA-256 password hashes are accepted once and replaced with PBKDF2 on the next successful sign-in.
