# Project Management MVP Execution Plan

## Architectural Decisions & Defaults

- **Runtime & Packaging**: Single Docker container running Python FastAPI via `uv` on port `8000`, serving the static Next.js export (`output: "export"`) at `/` and REST endpoints under `/api/*`.
- **Authentication**: Backend session authentication with hardcoded MVP credentials (`user` / `password`), setting a signed HTTP-only session cookie and backing onto a `users` table in SQLite.
- **Database**: Local SQLite database (`backend/data/pm.db`, persisted via a Docker volume/bind mount) initialized automatically on startup. Each user's board is stored as a single JSON document in a `boards` table linked to `users`.
- **Board API**: `GET /api/board` and `PUT /api/board` exchanging the full `BoardData` JSON payload (`columns` and `cards`), validated by Pydantic. Columns are the 5 fixed columns (renamable, not addable/removable).
- **Card Editing**: Inline card editing (title and details) supported directly in the Kanban UI in addition to adding, deleting, and drag-and-drop moving.
- **AI Integration**: OpenRouter (`openai/gpt-oss-120b`) using `OPENROUTER_API_KEY` from `.env`. Requests include the current `BoardData` JSON, the user message, and conversation history. Responses use Structured Outputs containing `assistant_message` and an optional updated `board` matching `BoardData`.
- **Chat History**: Stored in browser state for the initial MVP (Parts 9-10), with a dedicated follow-up step (Part 11) to persist chat history in the SQLite database.
- **Process**: Stop after each part for user review and approval before moving to the next part. Always update `docs/PLAN.md` checklists and create a git commit checkpoint upon completing each part.

---

## Part 1: Plan

Enrich this document to plan out each of these parts in detail, with substeps listed out as a checklist to be checked off by the agent, and with tests and success criteria for each. Also create an `AGENTS.md` file inside the `frontend` directory that describes the existing code there. Ensure the user checks and approves the plan.

### Substeps
- [x] Review root `AGENTS.md`, `docs/PLAN.md`, and existing `frontend/`, `backend/`, and `scripts/` directories
- [x] Clarify open requirements and architectural decisions with the user
- [x] Create `frontend/AGENTS.md` documenting the existing Next.js frontend architecture, components, state management, styling tokens, and test setup
- [x] Expand `docs/PLAN.md` with detailed checklists, tests, and success criteria for every part (including future database persistence for chat history)
- [x] Obtain user review and approval of the plan

### Tests & Success Criteria
- `frontend/AGENTS.md` accurately describes all existing files and scripts in `frontend/`
- `docs/PLAN.md` contains actionable checklists, test plans, and success criteria for all parts
- User explicitly approves the plan before Part 2 begins

---

## Part 2: Scaffolding

Set up the Docker infrastructure, the backend in `backend/` with FastAPI, and write the start and stop scripts in the `scripts/` directory. This should serve example static HTML to confirm that a "hello world" example works running locally and also make an API call.

### Substeps
- [x] Initialize Python project in `backend/` managed by `uv` (`pyproject.toml`, `.python-version`) with `fastapi`, `uvicorn[standard]`, `pydantic`, `python-dotenv`, `httpx`, and `pytest`
- [x] Create `backend/app/main.py` with a FastAPI app exposing `GET /api/health` (returns `{"status": "ok", "message": "Hello from FastAPI"}`) and serving static files at `/`
- [x] Create a temporary placeholder `backend/static/index.html` that renders a "Hello World" page and fetches `/api/health` on load to display the API response
- [x] Create `Dockerfile` and `.dockerignore` in the project root using `uv` to install dependencies and run `uvicorn` on port `8000`
- [x] Write start and stop scripts in `scripts/` for Mac/Linux (`start-mac.sh`, `stop-mac.sh`, `start-linux.sh`, `stop-linux.sh`) and Windows (`start-windows.bat`, `stop-windows.bat` or `.ps1`) that build/run the container with `.env` on port `8000` and stop/remove it cleanly
- [x] Update `backend/AGENTS.md` and `scripts/AGENTS.md` describing the backend and script setups

### Tests & Success Criteria
- **Backend Unit Tests**: `pytest` in `backend/tests/test_health.py` verifying `GET /api/health` returns `200 OK` and expected JSON, and `GET /` returns `200 OK` with HTML
- **Container Integration Check**: Running `./scripts/start-mac.sh` builds and starts the container; `curl http://localhost:8000/api/health` returns `{"status":"ok",...}` and `curl http://localhost:8000/` returns the static HTML page; `./scripts/stop-mac.sh` stops the container cleanly

---

## Part 3: Add in Frontend

Update so that the frontend is statically built and served, so that the app has the demo Kanban board displayed at `/`. Include inline card editing to satisfy the card-editing business requirement. Comprehensive unit and integration tests.

### Substeps
- [x] Add inline card editing (`onEditCard`) to `KanbanCard.tsx`, `KanbanColumn.tsx`, and `KanbanBoard.tsx` so users can edit an existing card's title and details
- [x] Configure `frontend/next.config.ts` with `output: "export"` so `npm run build` outputs static assets to `frontend/out`
- [x] Update multi-stage `Dockerfile`: Stage 1 builds the Next.js static export (`frontend/out`); Stage 2 copies `frontend/out` into the FastAPI static directory and serves it at `/`
- [x] Update `frontend/playwright.config.ts` so E2E tests can run against the running server (`BASE_URL` defaulting to `http://127.0.0.1:8000` when testing the container or dev server)
- [x] Add unit and E2E tests covering card editing in addition to existing column rename, card add/delete, and drag-and-drop tests

### Tests & Success Criteria
- **Frontend Unit Tests**: `npm run test:unit` passes all existing tests plus new tests for editing a card's title and details
- **Backend Tests**: `pytest` verifies `/` serves the built Next.js `index.html` and `/api/health` still works
- **E2E Tests**: `npx playwright test` against the running Docker container on port `8000` passes board load, column rename, card add, card edit, card delete, and card drag-and-drop

---

## Part 4: Add in a Fake User Sign In Experience

Update so that on first hitting `/`, you need to log in with dummy credentials (`"user"`, `"password"`) in order to see the Kanban, and you can log out. Comprehensive tests.

### Substeps
- [x] Add authentication endpoints in FastAPI (`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`) validating username `"user"` and password `"password"` and setting/clearing a signed HTTP-only session cookie
- [x] Build a clean login screen component (`LoginForm.tsx`) styled with the project color scheme (`--navy-dark`, `--primary-blue`, `--secondary-purple`, `--accent-yellow`)
- [x] Update the frontend root view to check authentication state (`/api/auth/me`), displaying `LoginForm` when unauthenticated and `KanbanBoard` (with a "Log out" button in the header) when authenticated
- [x] Handle invalid credential error states clearly in the login UI

### Tests & Success Criteria
- **Backend Unit Tests**: `pytest` tests for `POST /api/auth/login` (valid credentials succeed and set cookie; invalid credentials return `401`), `GET /api/auth/me` (authenticated vs `401` unauthenticated), and `POST /api/auth/logout` (clears session)
- **Frontend Unit Tests**: `vitest` tests for `LoginForm` rendering, validation/error display on wrong credentials, transitioning to the board on login, and logging out
- **E2E Tests**: Playwright test verifying unauthenticated visit to `/` shows login screen, invalid login shows error, logging in with `user` / `password` reveals the Kanban board, refreshing preserves session, and clicking "Log out" returns to the login screen

---

## Part 5: Database Modeling

Propose a database schema for the Kanban, saving it as JSON. Document the database approach in `docs/` and get user sign-off.

### Substeps
- [x] Create `docs/DATABASE.md` detailing the SQLite database schema and JSON structure:
  - `users` table (`id`, `username` UNIQUE, `password_hash`, `created_at`) supporting multiple users for the future while seeding the default `"user"` account
  - `boards` table (`id`, `user_id` UNIQUE FK -> `users.id`, `board_json` TEXT, `updated_at`) storing the user's single Kanban board as a JSON document matching `BoardData` (`columns` array and `cards` dictionary)
  - Future-ready note/design for `chat_messages` table (`id`, `user_id`, `role`, `content`, `created_at`) to be activated in Part 11
  - Initialization and seeding strategy (auto-create tables and seed default user + initial Kanban board on first run if DB file does not exist)
- [x] Present `docs/DATABASE.md` to the user and pause for explicit sign-off

### Tests & Success Criteria
- `docs/DATABASE.md` is clear, concise, and covers tables, JSON schema, constraints, and seeding
- User explicitly approves the database design before Part 6 begins

---

## Part 6: Backend

Add API routes to allow the backend to read and change the Kanban for a given user; test this thoroughly with backend unit tests. The database should be created if it doesn't exist.

### Substeps
- [x] Implement SQLite database module (`backend/app/db.py`) that automatically creates the SQLite file and tables on startup if they do not exist, and seeds the default `"user"` account with `initialData` board JSON
- [x] Define Pydantic models (`backend/app/schemas.py`) for `Card`, `Column`, and `BoardData` (enforcing the 5 fixed column IDs and valid card references)
- [x] Implement authenticated routes in FastAPI:
  - `GET /api/board`: Returns the current logged-in user's `BoardData` JSON from SQLite
  - `PUT /api/board`: Validates and saves the updated `BoardData` JSON for the logged-in user in SQLite
- [x] Configure Docker run script / volume mount so the SQLite database file persists in a local `data/` directory across container restarts

### Tests & Success Criteria
- **Backend Unit Tests**: Thorough `pytest` suite using an isolated temporary SQLite database testing:
  - Automatic database creation and default user/board seeding when the DB file does not exist
  - `GET /api/board` returns `401` when unauthenticated and returns the seeded 5-column board when authenticated
  - `PUT /api/board` updates column titles, adds/edits/deletes cards, and reorders/moves cards across columns, and subsequent `GET /api/board` returns the persisted changes
  - `PUT /api/board` rejects malformed payloads or invalid card/column structures with `422`
  - Multi-user isolation in the DB layer (user A's board update does not affect user B's board)

---

## Part 7: Frontend + Backend

Have the frontend actually use the backend API, so that the app is a proper persistent Kanban board. Test very thoroughly.

### Substeps
- [x] Create an API client module (`frontend/src/lib/api.ts`) for auth (`/api/auth/*`) and board persistence (`GET /api/board`, `PUT /api/board`)
- [x] Update `KanbanBoard.tsx` to load initial board state from `GET /api/board` after login and persist board mutations (column rename, card add, card edit, card delete, card drag-and-drop move) via `PUT /api/board` with optimistic UI updates and error handling
- [x] Ensure loading and error states are clean and unobtrusive

### Tests & Success Criteria
- **Frontend Unit Tests**: `vitest` tests mocking `/api/board` to verify initial fetch on mount and `PUT /api/board` calls when renaming a column, adding, editing, moving, and deleting a card
- **E2E Persistence Tests**: Playwright tests running against the Docker container verifying that after logging in:
  - Renaming a column, adding a card, editing a card, moving a card, and deleting a card all persist after a full page reload (`page.reload()`)
  - Logging out and logging back in preserves all board modifications

---

## Part 8: AI Connectivity

Allow the backend to make an AI call via OpenRouter. Test connectivity with a simple "2+2" test and ensure the AI call is working.

### Substeps
- [x] Implement `backend/app/ai.py` to call OpenRouter (`https://openrouter.ai/api/v1/chat/completions` or via the `openai` SDK configured with OpenRouter base URL) using `OPENROUTER_API_KEY` from `.env` and model `openai/gpt-oss-120b`
- [x] Add a simple connectivity function and endpoint/test helper to send a prompt (e.g., `"What is 2+2? Reply with just the number."`) and return the model's response
- [x] Ensure `.env` is loaded in both local `pytest` runs and the Docker container

### Tests & Success Criteria
- **Backend Unit Tests**: `pytest` unit test with mocked OpenRouter HTTP response verifying request headers, model name (`openai/gpt-oss-120b`), and error handling when `OPENROUTER_API_KEY` is missing or upstream fails
- **Live Connectivity Test**: `pytest -m live_ai` (or dedicated verification run) making a real call to OpenRouter with `"What is 2+2?"` and verifying the response contains `"4"`

---

## Part 9: AI Structured Outputs with Kanban Context

Extend the backend call so that it always calls the AI with the JSON of the Kanban board, plus the user's question (and conversation history). The AI should respond with Structured Outputs that includes the response to the user and optionally an update to the Kanban. Test thoroughly.

### Substeps
- [x] Define Pydantic schemas for the chat endpoint (`POST /api/chat`):
  - Request: `message: str` and `history: list[ChatMessage]` (sent from browser state for the MVP)
  - Structured Output schema from the LLM: `assistant_message: str` and `updated_board: BoardData | None` (or `board_updated: bool` + `board: BoardData | None`)
- [x] Construct a clear system prompt instructing `openai/gpt-oss-120b` on how to inspect and manipulate the user's 5-column Kanban board (creating cards, editing card titles/details, moving/reordering cards across columns, deleting cards, renaming columns) while preserving existing IDs and valid column structure
- [x] Implement `POST /api/chat` in FastAPI:
  - Loads the current user's board from SQLite
  - Sends system prompt + current board JSON + conversation history + new user message to OpenRouter using Structured Outputs (`response_format`)
  - If the AI returns an `updated_board`, validates it and saves it to SQLite for the user
  - Returns `{ "reply": ..., "board": ... }` to the caller

### Tests & Success Criteria
- **Backend Unit Tests**: Comprehensive `pytest` tests (with mocked OpenRouter responses) verifying:
  - Conversation history and current board JSON are included in the LLM payload
  - Conversational response without board modification leaves the DB unchanged and returns `reply`
  - AI response with an `updated_board` (create/edit/move/delete card) persists the new board to SQLite and returns the updated board in the response
  - Unauthenticated requests to `POST /api/chat` return `401`
- **Live AI Integration Test**: Opt-in live test verifying `openai/gpt-oss-120b` returns valid Structured Outputs when asked a question about the board and when asked to add/move a card

---

## Part 10: AI Chat Sidebar UI

Add a beautiful sidebar widget to the UI supporting full AI chat, and allowing the LLM (as it determines) to update the Kanban based on its Structured Outputs. If the AI updates the Kanban, then the UI should refresh automatically.

### Substeps
- [x] Create `ChatSidebar.tsx` styled with the project palette (`--navy-dark`, `--primary-blue`, `--secondary-purple`, `--accent-yellow`), featuring:
  - Collapsible or docked right-hand sidebar layout alongside the Kanban board
  - Scrollable message history (user and assistant bubbles), loading indicator while awaiting the AI, and message input form
  - Conversation history held in browser React state for the MVP and sent with each `POST /api/chat` request
- [x] Integrate `ChatSidebar` into `KanbanBoard.tsx` so that whenever `POST /api/chat` returns an updated `board`, the Kanban board state updates immediately in the UI without requiring a page reload

### Tests & Success Criteria
- **Frontend Unit Tests**: `vitest` tests verifying sidebar open/close, sending a message, displaying user and assistant messages, maintaining browser conversation history across turns, and automatically updating the rendered Kanban board when the API response includes an updated `board`
- **E2E Tests**: Playwright test verifying a user can log in, open the AI sidebar, send a prompt to create or move a card, see the assistant reply in the chat, and see the new/moved card appear on the Kanban board automatically

---

## Part 11: Persist Chat History in SQLite (Post-MVP Enhancement)

Convert the chat history from browser-only memory to be stored in the SQLite database per user so conversation history survives page reloads and sessions.

### Substeps
- [x] Add a `chat_messages` table (`id`, `user_id` FK -> `users.id`, `role`, `content`, `created_at`) to `backend/app/db.py` and `docs/DATABASE.md`
- [x] Add `GET /api/chat/history` and `DELETE /api/chat/history` (clear chat) endpoints, and update `POST /api/chat` to load recent conversation history from SQLite and append both the user message and assistant reply to `chat_messages`
- [x] Update `ChatSidebar.tsx` to load existing messages from `GET /api/chat/history` on mount and provide a "Clear chat" action

### Tests & Success Criteria
- **Backend Unit Tests**: `pytest` tests verifying messages are persisted per user in `chat_messages`, loaded automatically in subsequent `POST /api/chat` turns, returned by `GET /api/chat/history`, and cleared by `DELETE /api/chat/history`
- **Frontend & E2E Tests**: Vitest and Playwright tests verifying chat messages persist across a page reload and can be cleared by the user

---

# Phase 2: Multi-User, Multi-Board, Richer Kanban (Ralph loop)

Goal: turn the MVP into a fuller project management tool while keeping the stack and the 5 fixed (renamable) columns. Each part ends with backend `pytest`, frontend `vitest`, lint, build, and Playwright E2E against a freshly rebuilt container.

Decisions:
- **Users**: self-service registration, change password, delete account. Passwords hashed with salted PBKDF2 (stdlib); legacy unsalted SHA-256 hashes are verified and upgraded on login. Seeded `user` and `e2e-test-user` remain.
- **Boards**: many boards per user (`boards.name`, no `UNIQUE(user_id)`). New boards start from the sample template or empty. A user always keeps at least one board.
- **Conversations**: many AI conversations per board (`conversations` table, `chat_messages.conversation_id`). The AI always works on the board the conversation belongs to. Conversation titles default to the first message.
- **Migration**: existing databases are migrated in place on startup (boards table rebuilt without the unique constraint, legacy chat messages moved into a "Previous chat" conversation on the user's first board).
- **Cards**: optional `priority` (`none|low|medium|high`), `dueDate` (`YYYY-MM-DD`), `labels` (list of strings). Columns: optional `wipLimit`. Old board JSON stays valid.

## Part 12: Backend - users, boards, conversations, richer cards
- [x] Salted password hashing with legacy upgrade; `POST /api/auth/register`, `PUT /api/auth/password`, `DELETE /api/auth/account`
- [x] Schema migration and multi-board CRUD: `GET/POST /api/boards`, `GET/PUT/PATCH/DELETE /api/boards/{id}`
- [x] Conversations: `GET/POST /api/boards/{id}/conversations`, `GET/PATCH/DELETE /api/conversations/{id}`, `POST /api/conversations/{id}/messages`
- [x] Card `priority`/`dueDate`/`labels` and column `wipLimit` in schemas and AI prompt
- [x] Tests: registration, password change, account deletion, migration from the Phase 1 schema, board CRUD and isolation, conversation CRUD and isolation, AI chat per conversation

## Part 13: Frontend - accounts, board switcher, conversations
- [x] Register / sign-in toggle; account panel (change password, delete account)
- [x] Board switcher: list, create (template or blank), rename, delete
- [x] Chat sidebar with conversation list: new, switch, rename, delete
- [x] Tests: vitest component tests and Playwright E2E for each flow

## Part 14: UI redesign and responsive layout
- [x] Redesign with the project palette; mobile-first layout (horizontal snap-scrolling columns on small screens, full-screen chat on mobile, touch-friendly drag with touch sensor and a "Move to" control)
- [x] Card detail editor for priority, due date, labels; card badges (priority, due/overdue, labels)
- [x] Board toolbar: search, priority/label filters, stats (total, done, overdue), column WIP limits with over-limit warning
- [x] Tests: unit tests for filter/stat helpers, component tests, Playwright E2E at desktop and mobile viewport

## Part 15: Hardening and documentation
- [x] Code review fixes: ignore stale board/chat responses after switching, flush pending board saves before AI messages, focus the first field in dialogs, case-insensitive usernames (with regression tests)
- [x] Full regression, code review pass, docs (`AGENTS.md` files, `docs/DATABASE.md`, `CLAUDE.md`)

## Part 16: Card checklists
- [x] `checklist` on cards (`[{id, text, done}]`, max 50 items) in schemas, AI prompt, and TypeScript types
- [x] Checklist editor in the card dialog (add, toggle, edit, remove) and a done/total progress badge on cards
- [x] Tests: backend validation, unit tests for checklist progress, component and E2E tests

## Part 17: Everyday board tools
- [x] Due-date filter: overdue, due in the next 7 days, no due date
- [x] Undo after deleting a card (toast restores it to the same column position)
- [x] `/` keyboard shortcut focuses card search
- [x] Tests: unit tests for the due filter, component tests for undo and the shortcut, E2E for due filter and undo

## Part 18: Card archive
- [x] `archived` map on BoardData (`{cardId: columnId}`): archived cards stay in `cards` but leave the columns; validated and explained to the AI
- [x] Archive from the card dialog, "Archive all cards" in column settings, archived panel with restore (to the original column) and permanent delete
- [x] Board stats and board card counts cover active cards only
- [x] Tests: backend validation and counts, unit tests for archive helpers, component and E2E tests

## Part 19: Admin user management
- [x] `users.is_admin` (migrated in place; seeded `user` is an admin); `GET /api/auth/me` returns `isAdmin`
- [x] Admin API: `GET /api/admin/users`, `PUT /api/admin/users/{id}/password`, `PATCH /api/admin/users/{id}` (admin flag), `DELETE /api/admin/users/{id}`; admins cannot demote or delete themselves
- [x] "Manage users" dialog in the account menu for admins
- [x] Tests: backend permissions and actions, component tests, E2E

## Part 20: Session handling, AI feedback, accessibility checks
- [x] Any 401 from the API (expired session, account deleted by an admin) returns the app to sign-in with a notice
- [x] Assistant replies that changed the board are marked "Updated the board"
- [x] Automated accessibility scans (axe-core) in E2E for sign-in, board, dialogs, chat, and mobile; fix violations
- [x] Tests: unit tests for the session-expiry signal and chat marker, E2E for expiry and accessibility

## Part 21: Security hardening
- [x] Session secret from `SESSION_SECRET_KEY`, otherwise a random secret generated once and kept in `data/session_secret` (never a hard-coded default)
- [x] Sessions are tied to the password: changing or resetting a password signs out other sessions (the current one is re-issued)
- [x] Size limits: card title 200, details 5000, column title 40, at most 500 cards per board
- [x] Tests: forged cookies rejected, secret persistence, session invalidation on password change/reset, limit validation

## Part 22: Duplicate, export, and import boards
- [x] `POST /api/boards` accepts optional `data` (validated BoardData) instead of a template
- [x] Board menu: duplicate this board, export it as a JSON file, import a board from a JSON file
- [x] Tests: backend create-with-data and validation, component tests, E2E for duplicate, export download, and import

## Part 23: Code quality pass
- [x] SQLite connections are closed after every use (context manager that commits, rolls back on error, and closes)
- [x] Shared frontend helpers instead of copies: timestamp formatting, error messages, close icon
- [x] Cross-platform start/stop scripts reviewed; root README with the essentials
- [x] Full regression

## Part 24: Final regression
- [x] Fresh container build; backend, live OpenRouter, frontend unit, lint, type check, production build
- [x] Live AI conversation through the running server (card with priority, due date, and checklist created in the requested column)
- [x] E2E and accessibility suite run twice in a row (`--repeat-each=2`) with no failures and no server errors
- [x] Fixed a registration race found by the repeat run: username uniqueness (ignoring case) is now enforced by a unique index, and a duplicate returns 409 instead of 500
- [x] Playwright runs with one worker because tests share and reset the `e2e-test-user` account

# Phase 3: Public demo on Vercel + Supabase

Goal: put Kanban Studio online as a public demo anyone can open from a link, with a one-click "Try the demo" guest login and normal registration. Demo data can be thrown away and downtime is tolerable, but strangers must not be able to take over admin or run up the OpenRouter bill. Work happens on branch `feature/vercel-supabase-demo`.

Every part ends with the same gate before the next part starts: tests are written for the part's changes first, then the full suite runs and must pass: backend `pytest` (on the local Supabase Postgres), frontend `vitest`, lint, type check, build, and Playwright E2E plus accessibility scans against a freshly rebuilt container. A part is checked off only when its own "Done when" item is confirmed too.

Decisions:
- **Hosting**: one Vercel project with two Services (`vercel.json` `services`): `frontend` (the Next.js static export, unchanged) and `backend` (FastAPI, entrypoint `app.main:app`). Top-level rewrites send `/api/(.*)` to the backend and everything else to the frontend, so the site stays on one domain and the same-origin cookie keeps working.
- **Database**: Supabase Postgres only; no SQLite code path remains. `psycopg` 3 with `psycopg_pool`, connecting through the Supabase transaction pooler (`prepare_threshold=None`). The app keeps its own auth (no Supabase Auth).
- **Schema**: `supabase/migrations/*.sql`, applied by the Supabase CLI locally (`supabase start` / `db reset`) and to the hosted project (`supabase db push`). The SQLite Phase 1 migration is removed.
- **No default accounts in production**: `user` and `e2e-test-user` (password `password`) are seeded only when `SEED_DEV_USERS=1` (local and tests). The production admin is created once with `uv run python -m app.manage create-admin <name>`.
- **Local dev**: Docker stays the local runner, with parity checks. The container connects to the local Supabase pooler like production does, `SESSION_SECRET_KEY` is required everywhere (no file fallback), Docker and Vercel use Python 3.12, and each branch's Vercel preview gets the Playwright suite before production.
- **Guests**: accounts named `guest-xxxxxx`, deleted 24 hours after creation by a daily Vercel Cron; no conversion to a full account.
- **AI limits**: per account per rolling 24 hours, 10 messages for guests and 30 for registered users (env-configurable), counted from a separate `ai_usage` table so deleting chats or boards does not reset the count; plus a spend limit on the OpenRouter key. `POST /api/ai/test` becomes admin-only so it cannot be used to call OpenRouter outside the limit.
- **Guest restrictions**: registration rejects names starting with `guest-`; guests get 403 on password change, account deletion, and admin endpoints.
- **Environments**: two Supabase projects, one for production and one for Vercel previews, so branch migrations and test runs never touch the live demo.
- **Data layer approach**: minimal port. `db.py` keeps every public function and signature with Postgres inside (lazy `psycopg_pool` pool, max 10 connections, `dict_row`, `Jsonb`, `RETURNING id`, `lower(username)`); no connection is held during the OpenRouter call. AI usage is reserved atomically before the call (`try_consume_ai_quota`) and not refunded if the call fails. Vercel functions run in the same region as the Supabase project. Tests refuse to run unless the database name ends in `_test`.
- **Admin user list**: guests are hidden; they expire on their own.
- **Preview testing**: previews stay behind Vercel Deployment Protection; Playwright sends the protection-bypass secret. Only anonymous-safe specs (new `tests/demo.spec.ts`: demo, registration, sign-in accessibility) run against previews, because the hosted databases have no dev accounts.
- **Sign-in abuse**: a Vercel Firewall rate-limit rule on `/api/auth/*` (dashboard setting).
- **Not in scope**: email password reset, backups, privacy policy, guest-to-account conversion, migrating existing local SQLite data (boards can be moved with Export/Import JSON).

## Part 25: Postgres schema and data layer
- [x] `supabase init`; migration `supabase/migrations/<timestamp>_init.sql`: `users` (identity id, `is_admin` and `is_guest` booleans, `created_at timestamptz`, unique index on `lower(username)`), `boards` (`board_json jsonb`), `conversations`, `chat_messages` (`created_at`), `ai_usage` (`user_id`, `created_at`), all cascading on delete
- [x] `backend/pyproject.toml`: add `psycopg[binary]` and `psycopg-pool`; commit `uv.lock`
- [x] Rewrite `backend/app/db.py` with the same public functions: pooled `get_connection()`, `%s` placeholders, `RETURNING id`, `UniqueViolation` for duplicate usernames, `lower(username)` lookups, jsonb card-count summary, `get_messages(limit=None)` (`LIMIT NULL`), `seed_dev_users()` only when `SEED_DEV_USERS=1`
- [x] `createdAt`/`updatedAt` become `datetime` in `schemas.py` (ISO with offset); `frontend/src/lib/format.ts` parses ISO
- [x] `backend/app/manage.py` with `create-admin`
- [x] Tests: `conftest.py` uses a `kanban_test` database on the local Supabase Postgres (migrations applied once, tables truncated and dev users seeded per test); SQLite-only tests removed; rollback test rewritten; new tests for case-insensitive duplicates, jsonb card count, ISO timestamps, `get_messages` with and without a limit, seeding only when `SEED_DEV_USERS=1`, `create-admin` creating an admin that can sign in; `format.test.ts` updated for ISO timestamps
- [x] Done when: every existing backend test passes unchanged in behavior on Postgres (only SQLite-specific tests removed), and `supabase db reset` applies the migration cleanly from empty

## Part 26: Serverless-safe configuration
- [ ] `auth.py`: `SESSION_SECRET_KEY` required at startup everywhere; `data/session_secret` fallback removed; cookie `secure=True` when `VERCEL` is set
- [ ] `main.py`: startup no longer creates the schema; the static mount stays for Docker
- [ ] Tests: startup fails without `SESSION_SECRET_KEY`; cookie has `Secure` when `VERCEL` is set and not otherwise; forged-cookie and session-invalidation tests still pass with the env secret; secret-file tests removed
- [ ] Done when: the container starts with the secret from `.env`, refuses to start without it, and nothing is written to disk at runtime

## Part 27: Demo guests, cleanup, and AI limits
- [ ] `POST /api/auth/guest`: creates `guest-<6 random chars>` (`is_guest`, unusable password, sample board), starts the session; `isGuest` added to `UserResponse` and the TS `User` type
- [ ] `GET /api/cron/cleanup-guests`: requires `Authorization: Bearer $CRON_SECRET`; deletes guests older than 24 hours (cascade removes their data)
- [ ] AI daily limit in `send_message`: count the user's `ai_usage` rows in the last 24 hours; over `AI_DAILY_LIMIT_GUEST` (10) or `AI_DAILY_LIMIT` (30) returns 429 with a readable message; each AI call records a row
- [ ] `POST /api/ai/test` admin-only; registration rejects the `guest-` prefix; guests get 403 on password change, account deletion, admin endpoints
- [ ] Tests: guest login (flagged, sample board, session works, two guests get different names); guests cannot use admin endpoints or change a password; cleanup (401 without or with a wrong secret, deletes only guests older than 24 hours together with their boards and chats, leaves registered users alone); AI limit (message N passes and N+1 returns 429 for guests and registered users, OpenRouter is not called once over the limit, usage older than 24 hours does not count, deleting the chat does not reset the count); `/api/ai/test` returns 403 for non-admins; `guest-` names rejected at registration
- [ ] Done when: a guest created through the running container can use the board and chat, and the cleanup endpoint removes a guest whose `created_at` is backdated

## Part 28: Frontend demo entry
- [ ] Sign-in screen: "Try the demo" button ("No sign-up needed. Guest boards are deleted after 24 hours."); replace "Runs locally on your machine"
- [ ] Account menu for guests: "Guest account, deleted after 24 hours", no Account settings; `tryDemo()` in `lib/api.ts`
- [ ] Tests: AuthScreen ("Try the demo" signs in, shows a server error if it fails); Workspace (guest menu text, no Account settings for guests); `api.test.ts` for `tryDemo`; Playwright "try the demo" flow (guest lands on the sample board, adds a card, signs out); sign-in screen with the demo button and the guest account menu in `a11y.spec.ts` at desktop and mobile sizes
- [ ] Done when: screenshots of the sign-in screen and guest menu at desktop and phone width look right, and axe reports no violations

## Part 29: Local dev parity
- [ ] `supabase/config.toml`: pooler enabled in transaction mode; `.env` uses the local pooler `DATABASE_URL`, `SESSION_SECRET_KEY`, `SEED_DEV_USERS=1`; `.env.example` committed
- [ ] `scripts/start-*`: check Supabase is running, pass `DATABASE_URL` via `host.docker.internal` (Linux: `--add-host=host.docker.internal:host-gateway`), drop the `./data` mount
- [ ] Python 3.12 pinned in `Dockerfile` and `.python-version`
- [ ] Tests: start script fails with a clear message when Supabase is not running; backend suite passes when connecting through the local pooler (catches prepared-statement problems that a direct connection would hide)
- [ ] Full local regression: backend, live AI (`pytest -m live_ai`), frontend unit, lint, build, E2E and accessibility against the container
- [ ] Done when: a fresh clone can follow the README (`supabase start`, `.env` from `.env.example`, `./scripts/start-mac.sh`) and reach a working app with seeded dev users

## Part 30: Vercel project and hosted setup
- [ ] Root `vercel.json`: `frontend` and `backend` services, backend `maxDuration` 60, rewrites (`/api/(.*)` to backend, then `/(.*)` to frontend), daily cron for guest cleanup
- [ ] Create two Supabase projects (production and preview); `supabase link` and `supabase db push` to each; create the admin with `app.manage` on each
- [ ] `vercel link`; env vars for Production and Preview (each pointing at its own Supabase project): `DATABASE_URL` (transaction pooler), `SESSION_SECRET_KEY`, `OPENROUTER_API_KEY`, `CRON_SECRET`, `AI_DAILY_LIMIT`, `AI_DAILY_LIMIT_GUEST`; create a protection-bypass secret for automated preview tests
- [ ] Vercel Firewall rate-limit rule on `/api/auth/(login|register|guest)`; spend limit on the OpenRouter key
- [ ] Tests: `vercel build` succeeds locally for both services; `supabase migration list` shows local and hosted migrations in sync; `/api/health` on the first preview returns 200; a deep link (for example `/?x=1`) and a page refresh return the app, not a 404
- [ ] Done when: the preview URL loads the sign-in screen, the hosted database has the schema and exactly one admin, and none of the dev accounts exist there

## Part 31: Preview check, production, and docs
- [ ] Tests on the preview: `BASE_URL=<preview> VERCEL_BYPASS=<secret> npx playwright test tests/demo.spec.ts`; manual checks: "Try the demo", edit a card and reload (saved), send AI messages up to the guest limit (429 message shown), register a normal account, confirm `user`/`password` does not sign in, cron endpoint returns 401 without the secret and 200 with it, sign-in rate limit kicks in after repeated failures, the session cookie is `Secure`
- [ ] Production deploy; the same smoke checks on the production URL; the cron shows in the Vercel dashboard and its first run succeeds in the logs
- [ ] Done when: the production link works for a first-time visitor end to end, and the docs below match what was actually deployed
- [ ] Docs: `AGENTS.md` (Technical Decisions), `CLAUDE.md`, `docs/DATABASE.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`, `scripts/AGENTS.md`, `README.md` (local setup, deploy steps, release workflow)
