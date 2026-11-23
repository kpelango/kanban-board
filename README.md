# Kanban Studio

Kanban boards with an AI assistant that can create, edit, and move cards for you.

Try it: https://kanban-studio-khaki.vercel.app (click "Try the demo", no sign-up needed).

## Quick start (local)

Needs Docker and Node.js.

```bash
npx supabase start          # local Postgres, in Docker
cp .env.example .env        # set SESSION_SECRET_KEY, and OPENROUTER_API_KEY for the assistant
./scripts/start-mac.sh      # or start-linux.sh / scripts\start-windows.bat
```

Open http://localhost:8000 and sign in as `user` / `password` (admin), register, or click "Try the demo". Stop with `./scripts/stop-mac.sh` and `npx supabase stop`.

## Test

```bash
cd backend && uv run pytest         # backend, on its own kanban_test database
cd frontend && npm run test:unit    # frontend unit and component tests
cd frontend && npm run test:e2e     # end-to-end and accessibility, against the running container
```

## Learn more

- `AGENTS.md`: goals, decisions, architecture and trade-offs, all commands, known issues. Start here to work on the project.
- `backend/AGENTS.md`, `frontend/AGENTS.md`, `scripts/AGENTS.md`: file-by-file guides.
- `docs/DATABASE.md`: schema and board format. `docs/PLAN.md`: build history.

## More detail

### Stack

Next.js (static export) and FastAPI on one origin, Postgres on Supabase, OpenRouter for the assistant. Locally everything runs in one Docker container against a local Supabase; the start script rebuilds the image each time, so rerun it after code changes. The dev accounts exist only because `.env` sets `SEED_DEV_USERS=1`. Supabase Studio is at http://127.0.0.1:54323.

### Hosted demo (Vercel + Supabase)

`vercel.json` defines one Vercel project with a `frontend` and a `backend` service; `/api/*` goes to the backend. Branch pushes build protected previews on the `kanban-studio-preview` Supabase project; `main` deploys production on `kanban-studio-prod`. A daily schedule deletes demo guests older than 24 hours (check runs with `npx vercel schedules executions list cleanup-guests`).

Release workflow:

1. Push a branch. Vercel builds a preview (behind Vercel login).
2. If the branch adds a migration, apply it to the preview database: `npx supabase db push --db-url "$(cat .secrets/preview-database-url)"`.
3. Run the demo test against the preview: `cd frontend && BASE_URL=<preview url> VERCEL_BYPASS="$(cat ../.secrets/vercel-bypass)" npx playwright test tests/demo.spec.ts`, and try anything else the branch changed.
4. Apply any migration to production (same command with `prod-database-url`), then merge the pull request into `main`.

One-time setup, already done (kept for a fresh setup):

- Two Supabase projects, each with `supabase/migrations/` applied via `supabase db push --db-url`.
- A Vercel project linked to the GitHub repo (Production Branch `main`) with these variables for Production and Preview, different values each: `DATABASE_URL` (Supabase transaction pooler, port 6543), `SESSION_SECRET_KEY`, `CRON_SECRET`, `OPENROUTER_API_KEY`, `AI_DAILY_LIMIT`, `AI_DAILY_LIMIT_GUEST`, optionally `AI_DAILY_LIMIT_TOTAL` (default 500).
- A Vercel Firewall rate-limit rule: POST to `^/api/auth/(login|register|guest)$`, 10 per 60 seconds per IP, answering 429.
- A Protection Bypass for Automation secret (for preview tests) and a spend limit on the OpenRouter key.
- An admin per database: `./scripts/create-admin.sh <prod|preview> <username>` (prompts for the password). Hosted databases have no seeded accounts.

Secrets live in the gitignored `.secrets/` folder; never commit them.
