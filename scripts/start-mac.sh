#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGE_NAME="pm-app"
CONTAINER_NAME="pm-app"
PORT="${PORT:-8000}"

export PATH="/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/opt/homebrew/bin:${PATH}"

cd "${PROJECT_ROOT}"

mkdir -p "${PROJECT_ROOT}/data"

if docker ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

docker build -t "${IMAGE_NAME}" .

ENV_ARGS=()
if [ -f "${PROJECT_ROOT}/.env" ]; then
  ENV_ARGS=(--env-file "${PROJECT_ROOT}/.env")
fi

docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:8000" \
  -v "${PROJECT_ROOT}/data:/app/data" \
  "${ENV_ARGS[@]}" \
  "${IMAGE_NAME}" >/dev/null

echo "Server started at http://localhost:${PORT}"
