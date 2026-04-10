#!/usr/bin/env bash
set -euo pipefail

# ── helpers ───────────────────────────────────────────────────────────────────
log()  { echo "[deploy] $*"; }
die()  { echo "[deploy] ERROR: $*" >&2; exit 1; }

# ── pre-flight ────────────────────────────────────────────────────────────────
command -v docker >/dev/null || die "docker not found"
[ -f .env ] || die ".env file missing"

# Read PORT from .env; fall back to 8000 if not set or empty.
# Avoid exiting early under `set -euo pipefail` when PORT is absent.
PORT_LINE=$(grep -E '^PORT=' .env 2>/dev/null | head -1 || true)
PORT=$(printf '%s' "$PORT_LINE" | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
PORT=${PORT:-8000}
log "Using port ${PORT}."

# ── build ─────────────────────────────────────────────────────────────────────
log "Building image..."
docker compose build

# ── deploy ────────────────────────────────────────────────────────────────────
log "Starting container..."
docker-compose up -d --remove-orphans

# ── verify (no curl — works on any server) ───────────────────────────────────
log "Waiting for container to be running..."
for i in $(seq 1 15); do
  STATUS=$(docker inspect --format '{{.State.Status}}' "$(docker compose ps -q app 2>/dev/null)" 2>/dev/null || echo "")
  if [ "$STATUS" = "running" ]; then
    log "Container is running. App exposed on port ${PORT}."
    log "Logs: docker compose logs -f"
    exit 0
  fi
  sleep 1
done

die "Container did not reach 'running' state after 15 s. Check: docker compose logs -f"
