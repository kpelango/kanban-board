#!/usr/bin/env bash
# Creates (or promotes) an admin account in the app, on a hosted database.
#   ./scripts/create-admin.sh <prod|preview> <username>
# Reads the database URL from .secrets/<env>-database-url and prompts for the password.
# Runs backend/app/manage.py in the uv Docker image, so no local Python setup is needed.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/opt/homebrew/bin:${PATH}"

if [ $# -ne 2 ]; then
  echo "Usage: $0 <prod|preview> <username>" >&2
  exit 1
fi
URL_FILE="${PROJECT_ROOT}/.secrets/$1-database-url"
[ -f "${URL_FILE}" ] || { echo "Error: ${URL_FILE} not found." >&2; exit 1; }

docker run --rm -it \
  -v "${PROJECT_ROOT}/backend:/w" -w /w \
  -e UV_PROJECT_ENVIRONMENT=/tmp/venv \
  -e DATABASE_URL="$(cat "${URL_FILE}")" \
  ghcr.io/astral-sh/uv:python3.12-bookworm-slim \
  uv run --quiet python -m app.manage create-admin "$2"
