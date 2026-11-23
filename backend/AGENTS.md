# Backend Architecture and Codebase Guide

## Overview

Python 3.12 FastAPI app managed with `uv` (`requires-python` is pinned to 3.12 so Docker and Vercel match). Serves the REST API under `/api/*`. In Docker it also serves the static Next.js export from `static/` at `/`; on Vercel it runs as the `backend` service (entrypoint `app.main:app`, see `vercel.json`) and the frontend is a separate static service.

## Tech Stack

FastAPI, Uvicorn, Pydantic v2, `python-dotenv`, `itsdangerous` (signed session cookie), `httpx` (OpenRouter), `psycopg` 3 and `psycopg_pool` (Postgres), stdlib `hashlib` (PBKDF2 passwords), `pytest` with FastAPI `TestClient`.

## Modules (`app/`)

- `main.py`: app entrypoint; loads `.env`; at startup fails fast without `SESSION_SECRET_KEY` and seeds dev accounts when `SEED_DEV_USERS=1`; mounts routers and, if present, static files. `GET /api/health`.
- `schemas.py`: all Pydantic models (limits: card title 200, details 5000, column title 40, 500 cards per board). `BoardData` (5 fixed columns, card integrity, card `priority`/`dueDate`/`labels`/`checklist`, column `wipLimit`), auth/board/conversation request and response models, board templates (`sample`, `blank`).
- `db.py`: lazily created connection pool on `DATABASE_URL` (`prepare_threshold=None` for the transaction pooler, dict rows), `get_connection()` context manager (commits, rolls back on error), dev seeding, password hashing, guests, the AI quota, and data access. It never creates tables (schema: `supabase/migrations/`). Functions take a `user_id` and return `None`/`False` when the row is missing or owned by someone else. See `docs/DATABASE.md`.
- `auth.py`: session cookies signed with the required `SESSION_SECRET_KEY`; `Secure` when `VERCEL` is set; guest sessions last 24 hours. Tokens carry a fingerprint of the password hash, so a password change or admin reset signs out other sessions (`PUT /api/auth/password` re-issues the caller's cookie). `get_current_user` dependency (cookie -> existing user with `is_admin`, else 401); `POST /api/auth/login|register|guest|logout`, `GET /api/auth/me`, `PUT /api/auth/password`, `DELETE /api/auth/account`.
- Guests (`is_guest`): `POST /api/auth/guest` creates `guest-xxxxxx` with the sample board. `require_registered` blocks guests from changing the password or deleting the account; password sign-in rejects them; registration refuses the `guest-` prefix; the admin list hides them.
- `cron.py`: `GET /api/cron/cleanup-guests`, requires `Authorization: Bearer $CRON_SECRET` (401 otherwise, also when the secret is unset), deletes guests older than 24 hours and AI usage rows that no longer count. Called daily by the `vercel.json` schedule.
- `manage.py`: `python -m app.manage create-admin <username>` prompts for a password and creates or promotes an admin (hosted databases have no seeded accounts). `scripts/create-admin.sh` runs it against a hosted database.
- `admin.py`: `require_admin` dependency (403 otherwise, checked before the target user lookup); `GET /api/admin/users`, `PUT /api/admin/users/{id}/password`, `PATCH /api/admin/users/{id}` (admin flag), `DELETE /api/admin/users/{id}`. Admins cannot demote or delete themselves.
- `board.py`: `GET/POST /api/boards` (POST takes a `template` or, for duplicate/import, validated `data`), `GET/PUT/PATCH/DELETE /api/boards/{id}` (cannot delete the last board).
- `ai.py`: OpenRouter client (`openai/gpt-oss-120b`, pinned to Cerebras with no fallback, reasoning effort `medium` excluded from the reply, `max_tokens` 16000 because reasoning tokens count toward it; `finish_reason: "length"` or empty content returns a 502 with a readable message), `POST /api/ai/test` (admins only, not counted), conversations: `GET/POST /api/boards/{id}/conversations`, `GET/PATCH/DELETE /api/conversations/{id}`, `POST /api/conversations/{id}/messages`. A message sends the system prompt (full board JSON), the last 20 messages, and the new message; a returned `updated_board` is validated and saved to the conversation's board. The first message titles a new conversation. Before calling OpenRouter, `db.try_consume_ai_quota` enforces the rolling 24-hour limits (per account: `AI_DAILY_LIMIT_GUEST` 10, `AI_DAILY_LIMIT` 30; site-wide: `AI_DAILY_LIMIT_TOTAL` 500) and returns 429 naming the limit reached.

## Tests (`tests/`)

`conftest.py` points `DATABASE_URL` at `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@127.0.0.1:54322/kanban_test`, refusing any database not ending in `_test`), recreates it from the migrations once per run, and truncates and reseeds before every test. Fixtures: `client` (signed in as `user`), `anon`, `guest`, plus a `backdate` helper for 24-hour rules. OpenRouter is faked by monkeypatching `httpx.post`. `@pytest.mark.live_ai` tests call the real API and are skipped by default.

## Environment

| Variable | Needed | Purpose |
|---|---|---|
| `DATABASE_URL` | always | Postgres via the transaction pooler |
| `SESSION_SECRET_KEY` | always | Signs session cookies; startup fails without it |
| `OPENROUTER_API_KEY` | for AI | OpenRouter key |
| `SEED_DEV_USERS` | local only | `1` seeds `user` and `e2e-test-user` |
| `CRON_SECRET` | hosted | Bearer token for the guest cleanup |
| `AI_DAILY_LIMIT`, `AI_DAILY_LIMIT_GUEST`, `AI_DAILY_LIMIT_TOTAL` | optional | Assistant messages per rolling 24 hours: per registered account (30), per guest (10), all accounts together (500). Startup fails if one is not a whole number |
| `DB_POOL_MAX` | optional | Pool size (10) |
| `VERCEL` | set by Vercel | Makes cookies `Secure` |

## Commands

Needs the local Supabase running (`npx supabase start`).

- `uv run pytest` (or, without local `uv`, the `docker run ... ghcr.io/astral-sh/uv` command in the root `AGENTS.md`)
- `docker exec -e TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/kanban_test pm-app uv run pytest` (inside the running container)
- Live AI: `uv run pytest -m live_ai` with `OPENROUTER_API_KEY` set
