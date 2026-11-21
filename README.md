# Kanban Studio

Project management with Kanban boards and an AI assistant. A FastAPI backend serves a static Next.js frontend, with data in Postgres (Supabase). Locally it runs in one Docker container against a local Supabase database; the public demo runs on Vercel at https://kanban-studio-khaki.vercel.app.

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

## Hosted demo (Vercel + Supabase)

`vercel.json` defines one Vercel project with two services: `frontend` (the static export) and `backend` (FastAPI). Requests to `/api/*` go to the backend, everything else to the frontend, so the app stays on one origin. A daily schedule calls `/api/cron/cleanup-guests` to delete demo guests older than 24 hours. Preview deployments use the `kanban-studio-preview` Supabase project; production uses `kanban-studio-prod`.

Release workflow:

1. Push a branch. Vercel builds a preview (protected by Vercel login).
2. If the branch adds a migration, apply it to the preview database: `npx supabase db push --db-url "$(cat .secrets/preview-database-url)"`.
3. Run the demo test against the preview: `cd frontend && BASE_URL=<preview url> VERCEL_BYPASS="$(cat ../.secrets/vercel-bypass)" npx playwright test tests/demo.spec.ts`, and try anything else the branch changed.
4. Apply any migration to production (same command with `prod-database-url`), then merge the pull request into `main`. Vercel deploys `main` to production.

One-time setup, already done for this project (kept here for a fresh setup):

- Two Supabase projects; apply `supabase/migrations/` to each with `supabase db push --db-url`.
- A Vercel project linked to the GitHub repo with Production Branch `main`, and environment variables for Production and Preview: `DATABASE_URL` (the Supabase transaction pooler URL, port 6543), `SESSION_SECRET_KEY`, `CRON_SECRET`, `OPENROUTER_API_KEY`, `AI_DAILY_LIMIT`, `AI_DAILY_LIMIT_GUEST`. Use a different database URL, session secret, and cron secret per environment.
- A Vercel Firewall rate-limit rule: POST to `^/api/auth/(login|register|guest)$`, 10 requests per 60 seconds per IP, answering 429.
- A Protection Bypass for Automation secret (for the preview tests) and a spend limit on the OpenRouter key.
- An admin per database: `./scripts/create-admin.sh <prod|preview> <username>` (prompts for the password). Hosted databases have no seeded accounts.

Secrets for these commands live in the gitignored `.secrets/` folder; never commit them.

Design and schema notes: `docs/PLAN.md`, `docs/DATABASE.md`.
