# Database Schema and Persistence Design

## Overview

The application uses a local SQLite database stored at `/app/data/pm.db` inside the Docker container (mounted to `./data/pm.db` on the host, configurable via the `DATABASE_PATH` environment variable for testing).

If the database file or tables do not exist when the backend starts, the database module automatically creates the schema and seeds the default MVP user (`"user"`) and their initial 5-column Kanban board.

## Relational Schema (SQLite)

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP )
);

CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    board_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

### Design Rationale

1. **Multi-User Support (`users`)**:
   - Even though the MVP authenticates a single hardcoded user (`"user"` / `"password"`), storing users in a dedicated `users` table with a `UNIQUE` username allows adding more accounts later without schema changes.
2. **One Kanban Board per User (`boards`)**:
   - The `user_id INTEGER NOT NULL UNIQUE` constraint enforces the MVP rule of 1 Kanban board per user while isolating each user's board data via foreign key reference.
3. **JSON Document Storage (`board_json`)**:
   - The entire Kanban board state (`columns` order/titles and `cards` dictionary) is stored as a serialized JSON string in `boards.board_json`.
   - Every board read (`GET /api/board`) and write (`PUT /api/board`) validates the JSON against Pydantic schemas before persisting or returning it.

## `board_json` Structure

The JSON stored in `boards.board_json` matches the frontend `BoardData` type:

```json
{
  "columns": [
    {
      "id": "col-backlog",
      "title": "Backlog",
      "cardIds": ["card-1", "card-2"]
    },
    {
      "id": "col-discovery",
      "title": "Discovery",
      "cardIds": ["card-3"]
    },
    {
      "id": "col-progress",
      "title": "In Progress",
      "cardIds": ["card-4", "card-5"]
    },
    {
      "id": "col-review",
      "title": "Review",
      "cardIds": ["card-6"]
    },
    {
      "id": "col-done",
      "title": "Done",
      "cardIds": ["card-7", "card-8"]
    }
  ],
  "cards": {
    "card-1": {
      "id": "card-1",
      "title": "Align roadmap themes",
      "details": "Draft quarterly themes with impact statements and metrics."
    }
  }
}
```

### Validation Rules (Enforced by Backend Pydantic Schema)

- `columns` must contain the 5 fixed columns (`col-backlog`, `col-discovery`, `col-progress`, `col-review`, `col-done`) with non-empty `title` strings.
- Every ID listed in any column's `cardIds` must exist as a key in `cards` with a matching `card.id`.
- No card ID may appear in more than one column at the same time.

## Initialization & Seeding Strategy

On FastAPI startup (or first database access):
1. Ensure parent directory of `DATABASE_PATH` exists.
2. Execute `CREATE TABLE IF NOT EXISTS` for `users` and `boards`.
3. Insert default user `"user"` if not present.
4. Insert default `boards` row for `"user"` populated with the seed `initialData` JSON if no board exists for that user.

## Future Extension (Part 11: Persistent Chat History)

In Part 11, conversation history will move from browser memory into SQLite by adding a `chat_messages` table:

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ( CURRENT_TIMESTAMP ),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

