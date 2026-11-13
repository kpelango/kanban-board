#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="pm-app"
export PATH="/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/opt/homebrew/bin:${PATH}"

if docker ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
  docker rm -f "${CONTAINER_NAME}" >/dev/null
  echo "Stopped and removed container ${CONTAINER_NAME}"
else
  echo "Container ${CONTAINER_NAME} is not running"
fi
