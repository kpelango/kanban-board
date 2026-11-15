# Backend Architecture and Codebase Guide

## Overview

Python 3.12 FastAPI app managed with `uv`. Serves the REST API under `/api/*` and the static Next.js export from `static/` at `/`.

## Tech Stack

FastAPI, Uvicorn, Pydantic v2, `python-dotenv`, `itsdangerous` (signed session cookie), `httpx` (OpenRouter), stdlib `sqlite3` and `hashlib` (PBKDF2 passwords), `pytest` with FastAPI `TestClient`.

## Modules (`app/`)

- `main.py`: app entrypoint; loads `.env`, initializes the DB on startup, mounts routers and static files.
- `schemas.py`: all Pydantic models (limits: card title 200, details 5000, column title 40, 500 cards per board). `BoardData` (5 fixed columns, card integrity, card `priority`/`dueDate`/`labels`/`checklist`, column `wipLimit`), auth/board/conversation request and response models, board templates (`sample`, `blank`).
- `db.py`: `get_connection()` context manager (commits, rolls back on error, always closes), SQLite schema, Phase 1 migration, seeding, password hashing, and data access. Functions take a `user_id` and return `None`/`False` when the row is missing or owned by someone else. See `docs/DATABASE.md`.
- `auth.py`: session cookies signed with `SESSION_SECRET_KEY`, or a random secret generated once into `data/session_secret` (0600). Tokens carry a fingerprint of the password hash, so a password change or admin reset signs out other sessions (`PUT /api/auth/password` re-issues the caller's cookie). `get_current_user` dependency (cookie -> existing user with `is_admin`, else 401); `POST /api/auth/login|register|logout`, `GET /api/auth/me`, `PUT /api/auth/password`, `DELETE /api/auth/account`.
- `admin.py`: `require_admin` dependency (403 otherwise, checked before the target user lookup); `GET /api/admin/users`, `PUT /api/admin/users/{id}/password`, `PATCH /api/admin/users/{id}` (admin flag), `DELETE /api/admin/users/{id}`. Admins cannot demote or delete themselves.
- `board.py`: `GET/POST /api/boards` (POST takes a `template` or, for duplicate/import, validated `data`), `GET/PUT/PATCH/DELETE /api/boards/{id}` (cannot delete the last board).
- `ai.py`: OpenRouter client (`openai/gpt-oss-120b`), `POST /api/ai/test`, conversations: `GET/POST /api/boards/{id}/conversations`, `GET/PATCH/DELETE /api/conversations/{id}`, `POST /api/conversations/{id}/messages`. A message sends the system prompt (full board JSON), the last 20 messages, and the new message; a returned `updated_board` is validated and saved to the conversation's board. The first message titles a new conversation.

## Tests (`tests/`)

`conftest.py` gives every test its own temporary database (`DATABASE_PATH`) plus `client` (signed in as `user`) and `anon` fixtures. OpenRouter is faked by monkeypatching `httpx.post`. `@pytest.mark.live_ai` tests call the real API and are skipped by default.

## Commands

- `docker exec pm-app uv run pytest` (run inside the running container)
- Without rebuilding: `docker run --rm -v "$PWD/backend/app:/app/app" -v "$PWD/backend/tests:/app/tests" pm-app uv run pytest`
- Live AI: add `--env-file .env` to the command above and pass `-m live_ai`
