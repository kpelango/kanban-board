#!/usr/bin/env bash
set -euo pipefail

export PATH="/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/opt/homebrew/bin:${PATH}"

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start-common.sh"
