# Server Lifecycle Scripts

## Overview

The `scripts/` directory contains cross-platform helper scripts to build and run the full-stack Docker container (`pm-app`) on port `8000` (with `.env` environment variables and a persistent `data/` volume mount) and to stop/remove the container cleanly.

## Available Scripts

- **macOS**
  - `./scripts/start-mac.sh`: Builds the `pm-app` Docker image and starts the container on `http://localhost:8000`.
  - `./scripts/stop-mac.sh`: Stops and removes the `pm-app` container.
- **Linux**
  - `./scripts/start-linux.sh`: Builds the `pm-app` Docker image and starts the container on `http://localhost:8000`.
  - `./scripts/stop-linux.sh`: Stops and removes the `pm-app` container.
- **Windows**
  - `scripts\start-windows.bat`: Builds the `pm-app` Docker image and starts the container on `http://localhost:8000`.
  - `scripts\stop-windows.bat`: Stops and removes the `pm-app` container.
