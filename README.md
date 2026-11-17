# Kanban Studio

Project management with Kanban boards and an AI assistant. A FastAPI backend serves a static Next.js frontend, with data in Postgres (Supabase). Locally it runs in one Docker container against a local Supabase database.

## Run locally

Needs Docker and Node.js (for the Supabase CLI via `npx`).

```bash
npx supabase start                 # local Postgres and the transaction pooler, in Docker
cp .env.example .env               # then set SESSION_SECRET_KEY (and OPENROUTER_API_KEY for the assistant)
./scripts/start-mac.sh             # or start-linux.sh / scripts\start-windows.bat
```

Open http://localhost:8000 and sign in as `user` / `password` (an admin), or create an account, or click "Try the demo". These dev accounts exist only because `.env` sets `SEED_DEV_USERS=1`.

The start script rebuilds the image every time, so rerun it after code changes. It stops with a message if `.env` is missing or Supabase is not running. Stop with `./scripts/stop-mac.sh` (or the Linux/Windows variant) and `npx supabase stop`. Supabase Studio, for browsing the database, is at http://127.0.0.1:54323.

## Test

The backend tests create and reset their own `kanban_test` database on the local Supabase.

```bash
cd backend && uv run pytest              # backend (or inside the container, below)
docker exec -e TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/kanban_test pm-app uv run pytest
cd frontend && npm run test:unit         # frontend unit and component tests
cd frontend && npm run test:e2e          # end-to-end and accessibility, against the running container
```

Design and schema notes: `docs/PLAN.md`, `docs/DATABASE.md`.
