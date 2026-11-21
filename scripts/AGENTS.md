# Server Lifecycle Scripts

## Overview

The `scripts/` directory builds and runs the full-stack Docker container (`pm-app`) on port `8000` and stops it. The app keeps no files on disk; all data is in the Postgres database named by `DATABASE_URL` in `.env` (the local Supabase pooler in development, see `.env.example`).

The start scripts:
- stop with a clear message if `.env` or its `DATABASE_URL` is missing, or if a local `DATABASE_URL` points at a port nothing listens on (Supabase not started);
- rewrite a `127.0.0.1`/`localhost` database host to `host.docker.internal` (with `--add-host=host.docker.internal:host-gateway` so this also works on Linux);
- pass `.env` with `--env-file` and override only `DATABASE_URL` with `-e`;
- wait for `/api/health` and print the container logs if it exits during startup (for example when `SESSION_SECRET_KEY` is unset).

`ENV_FILE` and `PORT` environment variables override the `.env` path and host port (Mac/Linux).

## Available Scripts

- **macOS / Linux**
  - `./scripts/start-mac.sh` / `./scripts/start-linux.sh`: both run `start-common.sh`, which builds the `pm-app` image and starts it on `http://localhost:8000`. The Mac wrapper adds Docker Desktop's paths to `PATH`.
  - `./scripts/stop-mac.sh` / `./scripts/stop-linux.sh`: stop and remove the `pm-app` container.
- **Windows**
  - `scripts\start-windows.bat`: the same checks and startup (without the health wait).
  - `scripts\stop-windows.bat`: stops and removes the `pm-app` container.
- **Hosted databases**
  - `./scripts/create-admin.sh <prod|preview> <username>`: runs `python -m app.manage create-admin` in the `uv` Docker image against the URL in `.secrets/<env>-database-url`, prompting for the password (so it never appears in shell history). Needs Docker only.
