# Backend Architecture and Codebase Guide

## Overview

The `backend/` directory contains a Python FastAPI application managed with `uv`. It serves both the `/api/*` REST API endpoints and the static frontend assets at `/`.

## Tech Stack

- **Runtime & Package Manager**: Python 3.12, `uv`
- **Framework**: FastAPI (`fastapi`), Uvicorn (`uvicorn[standard]`)
- **Validation & Config**: Pydantic v2 (`pydantic`), `python-dotenv`, `itsdangerous`
- **HTTP Client**: `httpx`
- **Testing**: `pytest`, FastAPI `TestClient`

## Directory Structure

- `pyproject.toml` & `.python-version`: `uv` project configuration and dependencies.
- `app/`
  - `main.py`: FastAPI application entrypoint. Initializes SQLite on startup, mounts API routes (`/api/health`, `/api/auth/*`, `/api/board`), and serves static files from `static/` at `/`.
  - `auth.py`: Session authentication routes (`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`) using signed HTTP-only cookies (`itsdangerous`) and verifying user credentials against SQLite.
  - `db.py`: SQLite persistence module (`users` and `boards` tables), automatic DB creation and default user/board seeding, and per-user board read/write helpers.
  - `schemas.py`: Pydantic models (`Card`, `Column`, `BoardData`, `ChatMessage`, `ChatRequest`, `AIChatStructuredOutput`, `ChatResponse`) validating the 5 fixed column IDs, card reference integrity, and AI structured output payloads.
  - `board.py`: Authenticated board routes (`GET /api/board`, `PUT /api/board`).
  - `ai.py`: OpenRouter integration (`openai/gpt-oss-120b`), connectivity endpoint (`POST /api/ai/test`), and Kanban-aware structured output chat endpoint (`POST /api/chat`).
- `tests/`
  - `test_health.py`: Pytest unit tests verifying `/api/health` and static root `/` serving.
  - `test_auth.py`: Pytest unit tests verifying login, session verification, invalid credentials, and logout.
  - `test_board.py`: Pytest unit tests verifying SQLite auto-creation, board read/write persistence, schema validation (`422`), authentication checks (`401`), and multi-user isolation.
  - `test_ai.py`: Pytest unit tests (mocked HTTP) and opt-in `@pytest.mark.live_ai` live connectivity test for OpenRouter (`openai/gpt-oss-120b`).

## Commands

- Run tests in container: `docker exec pm-app uv run pytest`
- Run server locally with `uv`: `uv run uvicorn app.main:app --reload --port 8000`
