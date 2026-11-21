#!/usr/bin/env bash
# Shared by start-mac.sh and start-linux.sh: builds the image and runs it against the
# database in DATABASE_URL (the local Supabase pooler in development).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGE_NAME="pm-app"
CONTAINER_NAME="pm-app"
PORT="${PORT:-8000}"
ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"

fail() {
  echo "Error: $*" >&2
  exit 1
}

[ -f "${ENV_FILE}" ] || fail "${ENV_FILE} not found. Copy .env.example to .env and fill it in."

DATABASE_URL="$( (grep -E '^DATABASE_URL=' "${ENV_FILE}" || true) | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'\r')"
[ -n "${DATABASE_URL}" ] || fail "DATABASE_URL is not set in ${ENV_FILE}. See .env.example."

# postgresql://user:password@host:port/dbname -> host and port
HOST_PORT="${DATABASE_URL#*://}"
HOST_PORT="${HOST_PORT##*@}"
HOST_PORT="${HOST_PORT%%/*}"
DB_HOST="${HOST_PORT%%:*}"
DB_PORT="${HOST_PORT##*:}"
[ "${DB_PORT}" != "${HOST_PORT}" ] || DB_PORT=5432

case "${DB_HOST}" in
  localhost | 127.0.0.1)
    if ! (exec 3<>"/dev/tcp/127.0.0.1/${DB_PORT}") 2>/dev/null; then
      fail "nothing is listening on port ${DB_PORT}, so the local database is not running.
Start it with: npx supabase start   (check the pooler port with: npx supabase status)"
    fi
    # Inside the container, localhost is the container itself; reach the host instead
    DATABASE_URL="${DATABASE_URL/@${DB_HOST}:/@host.docker.internal:}"
    ;;
esac

cd "${PROJECT_ROOT}"

if docker ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

docker build -t "${IMAGE_NAME}" .

# -e after --env-file wins, so only the database host changes
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:8000" \
  --add-host=host.docker.internal:host-gateway \
  --env-file "${ENV_FILE}" \
  -e "DATABASE_URL=${DATABASE_URL}" \
  "${IMAGE_NAME}" >/dev/null

for _ in $(seq 1 30); do
  if curl -fs "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    echo "Server started at http://localhost:${PORT}"
    exit 0
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null)" != "true" ]; then
    docker logs --tail 20 "${CONTAINER_NAME}" >&2 || true
    fail "the container stopped during startup (logs above)."
  fi
  sleep 1
done
docker logs --tail 20 "${CONTAINER_NAME}" >&2 || true
fail "the server did not answer on http://localhost:${PORT}/api/health within 30 seconds."
