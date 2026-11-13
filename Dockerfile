FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

COPY backend/pyproject.toml backend/.python-version ./
RUN uv sync --no-install-project

COPY backend/app ./app
COPY --from=frontend-builder /frontend/out ./static
COPY backend/tests ./tests
COPY backend/AGENTS.md ./AGENTS.md

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
