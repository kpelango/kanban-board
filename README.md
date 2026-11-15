# Kanban Studio

Project management with Kanban boards and an AI assistant. Runs locally in one Docker container (FastAPI backend serving a static Next.js frontend, SQLite storage).

## Run

Put `OPENROUTER_API_KEY=...` in `.env` (needed only for the AI assistant), then:

```bash
./scripts/start-mac.sh     # or start-linux.sh / scripts\start-windows.bat
./scripts/stop-mac.sh      # or stop-linux.sh / scripts\stop-windows.bat
```

Open http://localhost:8000 and sign in as `user` / `password` (an admin), or create an account. Data lives in `data/`.

## Test

```bash
docker exec pm-app uv run pytest        # backend
cd frontend && npm run test:unit        # frontend unit and component tests
cd frontend && npm run test:e2e         # end-to-end and accessibility, against the running container
```

Design and schema notes: `docs/PLAN.md`, `docs/DATABASE.md`.
