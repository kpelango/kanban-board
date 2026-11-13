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
  - `main.py`: FastAPI application entrypoint. Mounts API routes (`/api/health`) and serves static files from `static/` at `/`.
- `static/`
  - `index.html`: Static HTML entrypoint served at `/` (replaced in Docker builds with the Next.js static export in Part 3).
- `tests/`
  - `test_health.py`: Pytest unit tests verifying `/api/health` and static root `/` serving.

## Commands

- Run tests in container: `docker exec pm-app uv run pytest`
- Run server locally with `uv`: `uv run uvicorn app.main:app --reload --port 8000`
