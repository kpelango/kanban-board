# Database Schema and Persistence Design

## Overview

Postgres on Supabase. The schema lives only in `supabase/migrations/*.sql`; `backend/app/db.py` never creates or alters tables.

| Where | Database | Schema applied by |
|---|---|---|
| Local | `npx supabase start` (Docker), database `postgres` | `npx supabase db reset` (wipes local data) |
| Backend tests | `kanban_test` on the local Supabase (`TEST_DATABASE_URL`) | `tests/conftest.py`, recreated every run |
| Preview deployments | Supabase project `kanban-studio-preview` | `npx supabase db push --db-url <preview url>` |
| Production | Supabase project `kanban-studio-prod` | `npx supabase db push --db-url <prod url>` |

The app connects with `DATABASE_URL` through Supabase's transaction pooler (port 6543 hosted, 54329 locally), using a `psycopg_pool` pool with `prepare_threshold=None` because the pooler cannot keep prepared statements. Pool size is `DB_POOL_MAX` (default 10).

Accounts: `user` (admin) and `e2e-test-user`, both with password `password` and one sample board, are seeded at startup only when `SEED_DEV_USERS=1` (local `.env` and tests). Hosted databases have no seeded accounts; create an admin with `./scripts/create-admin.sh <prod|preview> <username>` (which runs `python -m app.manage create-admin`).

## Schema

Summary of `supabase/migrations/20261117000000_init.sql`:

```sql
CREATE TABLE users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text NOT NULL,
    password_hash text NOT NULL,          -- pbkdf2_sha256$<iterations>$<salt hex>$<hash hex>
    is_admin boolean NOT NULL DEFAULT false,
    is_guest boolean NOT NULL DEFAULT false,  -- demo guest, expires after 24 hours
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_users_username_lower ON users (lower(username));
CREATE INDEX idx_users_guest_created ON users (created_at) WHERE is_guest;

CREATE TABLE boards (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name text NOT NULL,
    board_json jsonb NOT NULL,            -- BoardData document, see below
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    board_id bigint NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
    title text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id bigint NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user', 'assistant')),
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per assistant request, for the rolling 24-hour limit
CREATE TABLE ai_usage (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

Plus foreign-key and lookup indexes. Row level security is enabled on every table with no policies, and `anon`/`authenticated` have no grants, so Supabase's public Data API cannot read anything; only the backend (connecting as `postgres`) can. Timestamps are returned to the frontend as ISO 8601 with an offset.

Ownership flows user -> boards -> conversations -> messages. Every query filters by the signed-in user's id (directly or through a join), so another user's ids return 404. Deleting a user or board cascades to everything below it. `ai_usage` hangs off the user directly, so deleting chats or boards does not reset the daily limit. A user must keep at least one board.

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
- `priority` is `none|low|medium|high` (default `none`); `dueDate` is a real `YYYY-MM-DD` date or null; `labels` has at most 10 entries of 1-30 characters; `checklist` has at most 50 items (`text` 1-200 characters, ids unique within the card). `archived` maps archived card ids to the column they are restored to; archived cards stay in `cards` but must not be in any column. Board card counts exclude archived cards. Missing optional fields get defaults, so older documents and imported boards stay valid.

## Demo guests and the AI limit

- `POST /api/auth/guest` inserts a `guest-xxxxxx` user with `is_guest = true`, an unusable random password, and the sample board.
- Guest sessions last 24 hours. `GET /api/cron/cleanup-guests` (daily, Vercel schedule) then deletes guests whose `created_at` is more than 24 hours old, so a guest's data is gone within about 48 hours; their boards, chats, and usage rows cascade. The same run deletes `ai_usage` rows older than 24 hours, which no longer count toward any limit.
- Each assistant message takes a transaction-scoped advisory lock, counts the `ai_usage` rows from the last 24 hours (the user's and everyone's), and inserts one if both are under their limits: per account `AI_DAILY_LIMIT_GUEST` (default 10) or `AI_DAILY_LIMIT` (default 30), and site-wide `AI_DAILY_LIMIT_TOTAL` (default 500), so creating many accounts cannot run up the OpenRouter bill. Otherwise the request gets a 429 naming the limit reached. Usage is not refunded if the AI call fails. Startup fails if a limit is not a whole number.

## Changing the schema

Add a new file with `npx supabase migration new <name>`, apply it locally with `npx supabase db reset`, run the backend tests (they load every migration), then `npx supabase db push --db-url "$(cat .secrets/preview-database-url)"` before merging and the same with the prod URL after. Never edit a migration that has already been pushed.
