# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Project requirements, color scheme, and coding standards live in `AGENTS.md` (root). Per-area guides with file-by-file detail: `backend/AGENTS.md`, `frontend/AGENTS.md`, `scripts/AGENTS.md`. The execution plan and progress checklist is `docs/PLAN.md`; the database schema and `board_json` format are in `docs/DATABASE.md` (the schema itself is `supabase/migrations/*.sql`). Keep these docs updated when changing the areas they describe.

## Commands

Database: `npx supabase start` (local Postgres in Docker; direct port 54322, transaction pooler 54329 with user `postgres.pooler-dev`, Studio http://127.0.0.1:54323). `.env` (from `.env.example`) needs `DATABASE_URL`, `SESSION_SECRET_KEY`, `SEED_DEV_USERS=1`.

Full app (Docker container `pm-app` on http://localhost:8000, `.env` passed in, local `DATABASE_URL` rewritten to `host.docker.internal`, nothing stored on disk):
- `./scripts/start-mac.sh` / `./scripts/stop-mac.sh` (also `-linux.sh` and `-windows.bat` variants). Start rebuilds the image every time, so rerun it after any frontend or backend change.

Backend (`backend/`, Python 3.12, `uv`):
- `uv run pytest` - all tests, on database `kanban_test` (`TEST_DATABASE_URL`, default the local direct port; recreated from the migrations each run). Live OpenRouter tests are excluded by default via `-m 'not live_ai'`
- `uv run pytest tests/test_board.py::test_name` - single test. No local `uv`? From the repo root: `docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/backend:/w" -v "$PWD/supabase:/supabase" -w /w -e UV_PROJECT_ENVIRONMENT=/tmp/venv -e TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/kanban_test ghcr.io/astral-sh/uv:python3.12-bookworm-slim uv run pytest`
- `uv run pytest -m live_ai` - live OpenRouter call (needs `OPENROUTER_API_KEY`)
- `docker exec -e TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/kanban_test pm-app uv run pytest` - run tests inside the container
- `uv run python -m app.manage create-admin <name>` - create or promote an admin (hosted databases have no seeded accounts)
- `uv run uvicorn app.main:app --reload --port 8000` - local server (serves `backend/static/` at `/` only if it exists)

Frontend (`frontend/`):
- `npm run lint`, `npm run build` (static export to `out/`)
- `npm run test:unit` - Vitest; single file: `npx vitest run src/lib/kanban.test.ts`, single test: add `-t "name"`
- `npm run test:e2e` - Playwright against a running server at `BASE_URL` (default `http://127.0.0.1:8000`, i.e. the container). Single test: `npx playwright test -g "name"`. `tests/a11y.spec.ts` runs axe-core accessibility scans; new screens and dialogs should be added to it.

## Architecture

- **One container, one origin.** The Dockerfile builds the Next.js app as a static export (`output: "export"`, no SSR, no Next API routes), then copies `frontend/out` into the backend image as `static/`, which FastAPI mounts at `/`. The frontend calls relative `/api/*` URLs, so `npm run dev` alone has no backend; end-to-end work runs against the container, which must be rebuilt (`start-mac.sh`) to pick up changes.
- **Sessions.** Signed cookie (`itsdangerous`) holding the username and a password-hash fingerprint; the secret comes from `SESSION_SECRET_KEY`, which is required (startup fails without it). The cookie is `Secure` when `VERCEL` is set. Guest sessions last 24 hours. Changing or resetting a password invalidates other sessions.
- **Ownership chain.** users -> boards -> conversations -> chat_messages, all cascading. `get_current_user` (`backend/app/auth.py`) resolves the cookie to an existing user; every `db.py` function filters by that id and returns `None` for rows the user does not own, which routes turn into 404.
- **Board documents.** Each board is one JSON `BoardData` document. The frontend `Workspace` holds it, applies edits optimistically, and queues full-board `PUT /api/boards/{id}` saves in order. `backend/app/schemas.py` validates every write: exactly the 5 fixed column ids, card integrity, card `priority`/`dueDate`/`labels`/`checklist`, column `wipLimit`, and the `archived` map (card id -> column to restore to). Board handlers must spread `...prev` so fields like `archived` survive edits. The TypeScript types in `frontend/src/lib/kanban.ts` must stay in sync with these models.
- **AI chat.** `POST /api/conversations/{id}/messages` (`backend/app/ai.py`) sends the conversation's board JSON in a system prompt plus the last 20 messages to OpenRouter (`openai/gpt-oss-120b`, raw `httpx`, `response_format: json_object`) and parses `{assistant_message, updated_board | null}`. A non-null board is validated and replaces the stored board; the frontend swaps it in.
- **Admins.** `users.is_admin`; the seeded `user` is admin on a fresh install. `backend/app/admin.py` holds the admin API and the account menu shows "Manage users" only when `/api/auth/me` returns `isAdmin`.
- **Database.** Postgres via `psycopg` 3 and a `psycopg_pool` pool (`prepare_threshold=None` for the transaction pooler). The schema lives in `supabase/migrations/`; `db.py` never creates tables. Every new account gets the sample board. `user` (admin) and `e2e-test-user` (password `password`) are seeded only when `SEED_DEV_USERS=1`. Details in `docs/DATABASE.md`.
- **Demo guests and limits.** `POST /api/auth/guest` creates a `guest-xxxxxx` account (`is_guest`); guests cannot sign in with a password, change it, delete the account, or appear in the admin list, and `GET /api/cron/cleanup-guests` (Bearer `CRON_SECRET`) deletes them after 24 hours. Assistant messages are limited per account per rolling 24 hours (`ai_usage` table; `AI_DAILY_LIMIT_GUEST` 10, `AI_DAILY_LIMIT` 30).

## Testing conventions

- Backend tests: `tests/conftest.py` recreates `kanban_test` once per run, truncates all tables and reseeds before each test, and provides `client` (signed in as `user`), `anon`, and `guest` fixtures plus a `backdate` helper for time-based tests; OpenRouter is faked by monkeypatching `httpx.post`.
- Frontend component tests stub `fetch` with `src/test/fetchMock.ts`.
- Playwright runs with `workers: 1` because tests share state. Board and chat E2E tests log in as `e2e-test-user` and first reset that account to a single sample board with no chats, so they never touch the real user's data. Registration and admin E2E tests create throwaway `e2e-...` accounts and delete them (the admin test signs in as `user` but only acts on its throwaway account). `tests/demo.spec.ts` needs no seeded accounts, so it is the one to run against hosted previews (`BASE_URL=<url> VERCEL_BYPASS=<secret>`).
