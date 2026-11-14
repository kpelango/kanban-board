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
  - `main.py`: FastAPI application entrypoint. Mounts API routes (`/api/health`, `/api/auth/*`) and serves static files from `static/` at `/`.
  - `auth.py`: Session authentication routes (`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`) using signed HTTP-only cookies (`itsdangerous`).
- `tests/`
  - `test_health.py`: Pytest unit tests verifying `/api/health` and static root `/` serving.
  - `test_auth.py`: Pytest unit tests verifying login, session verification, invalid credentials, and logout.

## Commands

- Run tests in container: `docker exec pm-app uv run pytest`
- Run server locally with `uv`: `uv run uvicorn app.main:app --reload --port 8000`
