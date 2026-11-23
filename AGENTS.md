# Kanban Studio: Project Guide

This is the single source of project knowledge for agents and people. `CLAUDE.md` only points here. Per-area guides with file-by-file detail: `backend/AGENTS.md`, `frontend/AGENTS.md`, `scripts/AGENTS.md`. Database schema and the `board_json` format: `docs/DATABASE.md`. Execution history and checklists: `docs/PLAN.md`. Keep these docs updated when changing the areas they describe.

## Goal

A project management app built around Kanban boards with an AI assistant that can read and change the board. It started as a local single-user MVP and is now also a public demo that anyone can open from a link: https://kanban-studio-khaki.vercel.app.

## Business requirements and decisions

The original MVP brief:
- A user can sign in and sees a Kanban board for their project.
- The board has fixed columns that can be renamed; cards can be added, edited, and moved with drag and drop.
- An AI chat sidebar can create, edit, and move one or more cards.
- MVP limits: one hard-coded login (`user` / `password`), one board per user, local only in a Docker container, with a database ready for more users.

How it has grown (each phase is a section of `docs/PLAN.md`):
- **Phase 1 (Parts 1-11), MVP**: the brief above, with chat history saved in the database.
- **Phase 2 (Parts 12-24), fuller tool**: registration and accounts, many boards per user, many AI conversations per board, richer cards, archive, admin user management, mobile layout, accessibility, security hardening.
- **Phase 3 (Parts 25-31), public demo**: SQLite replaced by Supabase Postgres, hosted on Vercel, "Try the demo" guest login next to normal registration, and safeguards against abuse.

Standing business decisions:
- Exactly 5 fixed columns (renamable, not addable or removable), shown as numbered stages.
- The hosted app is a demo: data can be thrown away, downtime is tolerable, there are no backups. Strangers must not be able to take over admin or run up the OpenRouter bill.
- Guests need no sign-up, get the sample board, and expire after 24 hours. A guest cannot be converted into a full account.
- Hosted databases have no default accounts. Admins are created by hand (`scripts/create-admin.sh`), and only the project owner types admin passwords.
- AI use is capped per account and site-wide (numbers below), plus a spend limit on the OpenRouter key.
- Out of scope: email password reset, backups, privacy policy, guest-to-account conversion, Supabase Auth, migrating old local SQLite data (boards move with Export/Import JSON).

## Features

- Accounts: sign in, register, change password, delete account; sessions end when the password changes elsewhere. Admins manage users (reset passwords, grant or remove admin, delete).
- Demo: "Try the demo" creates a `guest-xxxxxx` account with the sample board.
- Boards: many per user; create from the sample template or blank, rename, delete (never the last one), duplicate, export and import as JSON.
- Cards: title, details, priority, due date, labels, checklist; drag and drop (mouse, touch, keyboard); archive and restore; undo after delete.
- Columns: rename, WIP limit (the flow rail turns red when over it), archive all cards.
- Toolbar: search (`/` shortcut), priority, label, and due-date filters, stats.
- AI assistant: per-board conversations (new, switch, rename, delete); replies that change the board say so, and the board updates in place.
- Layout: responsive down to phone width (columns scroll with a tab strip; chat goes full screen); axe-checked accessibility (WCAG 2.1 AA).

## Architecture

```
Browser ── same origin ──┬── /*      static Next.js export  (Docker: FastAPI serves it; Vercel: `frontend` service)
                         └── /api/*  FastAPI               (Docker: same process;      Vercel: `backend` service)
                                        │
                                        ├── Postgres (Supabase), via the transaction pooler
                                        └── OpenRouter (openai/gpt-oss-120b)
```

- **One origin.** The frontend is a static export (`output: "export"`, no SSR, no Next API routes) and calls relative `/api/*` URLs. Locally the Dockerfile builds the export and copies `frontend/out` into the backend image as `static/`, which FastAPI mounts at `/`. On Vercel, `vercel.json` defines two services and rewrites `/api/(.*)` to `backend` and everything else to `frontend`. So `npm run dev` alone has no backend; end-to-end work runs against the container, which must be rebuilt (`start-mac.sh`) to pick up changes.
- **Sessions.** Signed cookie (`itsdangerous`) holding the username and a fingerprint of the password hash. `SESSION_SECRET_KEY` is required (startup fails without it). The cookie is `HttpOnly`, `SameSite=lax`, and `Secure` when `VERCEL` is set. Guest sessions last 24 hours. Changing or resetting a password invalidates other sessions. Unknown usernames still cost a password check, so timing does not reveal which names exist.
- **Ownership chain.** users -> boards -> conversations -> chat_messages, all cascading on delete (`ai_usage` also cascades from users). `get_current_user` (`backend/app/auth.py`) resolves the cookie to an existing user; every `db.py` function filters by that id and returns `None` for rows the user does not own, which routes turn into 404.
- **Board documents.** Each board is one JSON `BoardData` document (`jsonb`). The frontend `Workspace` holds it, applies edits optimistically, and queues full-board `PUT /api/boards/{id}` saves in order. `backend/app/schemas.py` validates every write: exactly the 5 fixed column ids, card integrity, card `priority`/`dueDate`/`labels`/`checklist`, column `wipLimit`, the `archived` map (card id -> column to restore to), and size limits (title 200, details 5000, column title 40, 500 cards). Board handlers must spread `...prev` so fields like `archived` survive edits. The TypeScript types in `frontend/src/lib/kanban.ts` must stay in sync with these models.
- **AI chat.** `POST /api/conversations/{id}/messages` (`backend/app/ai.py`) sends a system prompt with the conversation's board JSON plus the last 20 messages to OpenRouter (raw `httpx`, `response_format: json_object`, 45 s timeout) and parses `{assistant_message, updated_board | null}`. A non-null board is validated and replaces the stored board; the frontend swaps it in. No database connection is held during the OpenRouter call. `POST /api/ai/test` is admin-only.
- **AI limits.** Before calling OpenRouter, `db.try_consume_ai_quota` takes a transaction-scoped advisory lock, counts `ai_usage` rows from the last rolling 24 hours, and records one if under the limits: per account `AI_DAILY_LIMIT_GUEST` (10) or `AI_DAILY_LIMIT` (30), site-wide `AI_DAILY_LIMIT_TOTAL` (500). Otherwise 429 with a message naming the limit. Usage lives in its own table, so deleting chats does not reset it.
- **Guests.** `POST /api/auth/guest` creates a `guest-xxxxxx` user (`is_guest`, unusable password). Guests cannot sign in with a password, change it, delete the account, use admin endpoints, or appear in the admin list; registration rejects the `guest-` prefix. `GET /api/cron/cleanup-guests` (Bearer `CRON_SECRET`) deletes guests older than 24 hours and stale `ai_usage` rows; a Vercel schedule calls it daily at 04:00 UTC.
- **Admins.** `users.is_admin`; the seeded `user` is admin locally. `backend/app/admin.py` holds the admin API; admins cannot demote or delete themselves. The account menu shows "Manage users" only when `/api/auth/me` returns `isAdmin`.
- **Database.** Postgres via `psycopg` 3 and a lazily created `psycopg_pool` pool (`prepare_threshold=None` because the transaction pooler cannot keep prepared statements; `DB_POOL_MAX`, default 10). The schema lives only in `supabase/migrations/`; `db.py` never creates tables. RLS is on with no Data API grants, so only the app's direct connection can read the tables. Every new account gets the sample board. `user` (admin) and `e2e-test-user` (both password `password`) are seeded only when `SEED_DEV_USERS=1`.
- **Abuse controls outside the app.** A Vercel Firewall rule limits POST `^/api/auth/(login|register|guest)$` to 10 requests per 60 seconds per IP and answers 429; the frontend shows "Too many attempts. Wait a minute and try again." for a 429 without a `detail`. OpenRouter key spend limit.

## Technical decisions and trade-offs

| Decision | Why | Cost |
|---|---|---|
| Static Next.js export + FastAPI, one origin | Simple cookie auth and relative URLs; one container locally | No SSR or Next API routes; `npm run dev` has no backend |
| Board stored as one JSON document | Simple full-board saves; the AI reads and returns the whole board | Whole-board writes: two tabs editing the same board overwrite each other (last write wins); the AI prompt grows with the board |
| Own auth (signed cookie, PBKDF2) rather than Supabase Auth | Kept the existing, tested auth; no third-party login flow | No email verification or password reset |
| Supabase Postgres via the transaction pooler | Works with serverless functions that open many short connections | No prepared statements (`prepare_threshold=None`); tests run through the local pooler to catch this |
| Vercel Services (two services, one project) | Push-to-deploy, per-branch previews, both halves ship together | Vercel-specific config; previews need a bypass secret for automation |
| Two Supabase projects (prod, preview) | Branch migrations and test runs never touch the live demo | Every migration is pushed twice |
| Docker stays the local runner | Same image as before, works offline from Vercel | Local and hosted differ in how the frontend is served; preview checks cover the gap |
| AI quota reserved before the call, under one advisory lock | Parallel requests cannot exceed the limits | Serializes quota checks site-wide; usage is not refunded when the AI call fails |
| Guests cleaned up by a daily schedule | No background worker needed | Guest data lingers up to about 48 hours (session ends at 24) |
| Rate limiting in the Vercel Firewall, not app code | No app state needed for counting | Per IP: people behind one network share the 10 per minute, and demo starts count too |
| OpenRouter with `openai/gpt-oss-120b`, JSON mode | Cheap, capable model; structured replies | Model output is validated server side; an invalid board is rejected, not repaired |

## Repository layout

- `backend/`: FastAPI app (`app/`), tests (`tests/`), `pyproject.toml` and `uv.lock` (Python 3.12).
- `frontend/`: Next.js 16, React 19, TypeScript, Tailwind CSS v4; unit tests next to the code, Playwright specs in `tests/`.
- `supabase/`: `config.toml` (local stack, pooler on) and `migrations/`.
- `scripts/`: start and stop scripts (Mac, Linux, Windows) and `create-admin.sh`.
- `Dockerfile`: builds the frontend export, then the backend image that serves it.
- `vercel.json`: services, rewrites, region `iad1` (next to the Supabase projects in us-east-1), and the cleanup schedule.
- `docs/`: `PLAN.md`, `DATABASE.md`.
- Never committed: `.env` (from `.env.example`), `.secrets/` (hosted URLs and secrets), `.vercel/`, `data/`.

## Commands

Database: `npx supabase start` (local Postgres in Docker; direct port 54322, transaction pooler 54329 with user `postgres.pooler-dev`, Studio http://127.0.0.1:54323). `.env` (from `.env.example`) needs `DATABASE_URL`, `SESSION_SECRET_KEY`, `SEED_DEV_USERS=1`, and `OPENROUTER_API_KEY` for the assistant.

Full app (Docker container `pm-app` on http://localhost:8000, `.env` passed in, local `DATABASE_URL` rewritten to `host.docker.internal`, nothing stored on disk):
- `./scripts/start-mac.sh` / `./scripts/stop-mac.sh` (also `-linux.sh` and `-windows.bat`). Start rebuilds the image every time, so rerun it after any change.

Backend (`backend/`):
- `uv run pytest`: all tests, on database `kanban_test` (`TEST_DATABASE_URL`, default the local direct port; recreated from the migrations each run). Live OpenRouter tests are excluded by default (`-m 'not live_ai'`).
- `uv run pytest tests/test_board.py::test_name`: one test.
- No local `uv`? From the repo root: `docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/backend:/w" -v "$PWD/supabase:/supabase" -w /w -e UV_PROJECT_ENVIRONMENT=/tmp/venv -e TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/kanban_test ghcr.io/astral-sh/uv:python3.12-bookworm-slim uv run pytest`
- `uv run pytest -m live_ai`: real OpenRouter calls (needs `OPENROUTER_API_KEY`).
- `docker exec -e TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/kanban_test pm-app uv run pytest`: tests inside the container.
- `uv run python -m app.manage create-admin <name>`: create or promote an admin; for hosted databases use `./scripts/create-admin.sh <prod|preview> <name>`.
- `uv run uvicorn app.main:app --reload --port 8000`: local server (serves `backend/static/` at `/` only if it exists).

Frontend (`frontend/`):
- `npm run lint`, `npm run build` (static export to `out/`), `npx tsc --noEmit`.
- `npm run test:unit` (Vitest); one file: `npx vitest run src/lib/kanban.test.ts`; one test: add `-t "name"`.
- `npm run test:e2e`: Playwright against `BASE_URL` (default `http://127.0.0.1:8000`, the container). One test: `npx playwright test -g "name"`.

Hosting (Vercel CLI through `npx --yes vercel@66.4.0`):
- `npx vercel schedules executions list cleanup-guests`: runs of the daily cleanup (`vercel crons ls` does not show `schedules`).
- Schema changes: `npx supabase migration new <name>`, `npx supabase db reset` locally, then `npx supabase db push --db-url "$(cat .secrets/preview-database-url)"` before merging and the same with `prod-database-url` after. Never edit a pushed migration.

## Testing conventions

- Backend: `tests/conftest.py` recreates `kanban_test` once per run (refusing any database not ending in `_test`), truncates all tables and reseeds before each test, and provides `client` (signed in as `user`), `anon`, and `guest` fixtures, a `backdate` helper for time-based rules, and `user_id`/`is_admin` helpers. OpenRouter is faked by monkeypatching `httpx.post`.
- Frontend component tests stub `fetch` with `src/test/fetchMock.ts`.
- Playwright runs with `workers: 1` because tests share state. Board and chat E2E tests sign in as `e2e-test-user` and first reset it to one sample board with no chats. Registration and admin tests create throwaway `e2e-...` accounts and delete them. `tests/a11y.spec.ts` runs axe-core on every main screen at desktop and mobile sizes; add new screens and dialogs to it.
- `tests/demo.spec.ts` needs no seeded accounts, so it is the one to run against hosted deployments: `BASE_URL=<url> VERCEL_BYPASS=<secret> npx playwright test tests/demo.spec.ts` (the bypass header is only needed for protected previews).
- Each part of work ends with the full suite: backend, frontend unit, lint, type check, build, and E2E plus accessibility against a freshly rebuilt container.

## Hosting and release

- Vercel project `kanban-studio`, Production Branch `main`. Every pushed branch gets a preview behind Vercel Authentication, on the `kanban-studio-preview` Supabase project; `main` deploys production on `kanban-studio-prod`.
- Release: push a branch; push any new migration to the preview database; run `tests/demo.spec.ts` against the preview with the bypass secret and check by hand what the branch changed; push the migration to production; merge the pull request.
- Vercel environment variables (Production and Preview, different values each): `DATABASE_URL` (pooler, port 6543), `SESSION_SECRET_KEY`, `CRON_SECRET`, `OPENROUTER_API_KEY`, `AI_DAILY_LIMIT`, `AI_DAILY_LIMIT_GUEST`, optional `AI_DAILY_LIMIT_TOTAL`. The full variable list is in `backend/AGENTS.md`.
- Hosted URLs and secrets live in the gitignored `.secrets/` folder. Never print, paste, or commit them; pipe them into commands.

## Known issues and limitations

- Whole-board saves: the same board open in two tabs or devices overwrites itself, last write wins.
- The sign-in rate limit is per IP and includes demo starts, so a classroom or office on one network shares 10 per minute.
- Guest data is deleted by the daily cleanup, so it can survive up to about 48 hours after the session ends at 24.
- No per-account board cap (deferred): a registered account can create many boards, each up to 500 cards.
- AI usage is counted when the request starts and is not refunded if OpenRouter fails.
- No email password reset, backups, or privacy policy (out of scope for a demo).
- The free Supabase plan can pause an idle project; the daily cleanup query should keep it awake, but this has not been tested over a long quiet spell.
- `frontend/test-results/.last-run.json` is tracked in git and changes after Playwright runs; restore it with `git checkout` before committing.
- `npm run dev` shows the UI without a backend; use the container for anything that calls the API.

## Working agreements

- Plan in `docs/PLAN.md`; commit each part once its tests pass, before starting the next. Work on a branch; merge to `main` through a pull request.
- Confirm with the project owner before hosted or outward-facing steps (production deploys, merges, firewall changes, account changes).
- Root-cause before fixing: prove the cause with evidence, then fix it.

## Coding standards

1. Use latest versions of libraries and idiomatic approaches as of today.
2. Keep it simple: never over-engineer, always simplify, no unnecessary defensive programming, no extra features.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever.
4. When hitting issues, always identify the root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Color scheme

- Accent Yellow: `#ecad0a` - accent lines, highlights
- Blue Primary: `#209dd7` - links, key sections
- Purple Secondary: `#753991` - submit buttons, important actions
- Dark Navy: `#032147` - main headings
- Gray Text: `#888888` - supporting text, labels

Tailwind tokens and the accessible text shades (`muted`, `link`) are described in `frontend/AGENTS.md`.
