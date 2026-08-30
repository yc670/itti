#!/usr/bin/env bash
#
# deploy-server.sh — full update sequence for the ITTI backend on a
# self-managed Droplet/VPS (NOT DigitalOcean App Platform, which
# handles all of this itself via server/Dockerfile's CMD - see that
# file's comment if you're on App Platform instead, this script isn't
# for you).
#
# WHAT THIS ASSUMES ABOUT YOUR SERVER LAYOUT
# -------------------------------------------
# These match no existing setup in this repo (there wasn't one for a
# bare Droplet before this script) - adjust the variables below once
# to match reality, then leave them alone.
#
#   - Repo cloned at /opt/itti_website, backend venv at
#     /opt/itti_website/server/venv
#   - A systemd service named "itti-backend" runs gunicorn (see
#     itti-backend.service.example alongside this script for a unit
#     file that matches what this script expects - install it once
#     with `systemctl enable itti-backend` before ever running this)
#   - A systemd service named "itti-frontend-nginx" is your nginx
#     reverse proxy in front of gunicorn — reloaded (not restarted)
#     since nginx's reload is zero-downtime and this script isn't
#     changing nginx's own config, just picking up a possibly-updated
#     static error/maintenance page if you keep one
#   - You run this AS the deploy user (needs sudo for the systemctl
#     calls - configure passwordless sudo for exactly those two
#     commands for that user, don't run this whole script as root)
#
# WHAT THIS SCRIPT DOES, IN ORDER
# ---------------------------------
#  1. Pull the latest code for the target branch
#  2. Install/update Python dependencies (requirements-prod.txt)
#  3. Run Alembic migrations (alembic upgrade head - safe/no-op if
#     nothing new, same reasoning as server/Dockerfile's CMD comment)
#  4. Restart the backend systemd service (picks up new code AND new
#     env vars if .env changed - gunicorn workers don't hot-reload
#     either)
#  5. Reload nginx (zero-downtime, only matters if its config changed)
#  6. Health-check the running service and roll back the restart
#     trigger point if it doesn't come back healthy
#
# WHAT THIS SCRIPT DOES NOT DO
# -------------------------------
#  - Build or deploy the frontend — see deploy-client.sh for that,
#    it's a separate script/separate host concern (see that script's
#    header for why)
#  - Create backups before migrating — see the --backup-db flag below,
#    off by default because pg_dump against a large production DB adds
#    real time to every deploy; turn it on for major/risky migrations
#  - Install system packages, configure nginx/systemd/certbot for the
#    first time, or provision the server — this is an UPDATE script
#    for a server that's already set up once, not a provisioning script
#
# USAGE
#   ./deploy-server.sh                  # standard update
#   ./deploy-server.sh --branch main    # deploy a different branch
#   ./deploy-server.sh --backup-db      # pg_dump before migrating
#   ./deploy-server.sh --no-restart     # pull+migrate only, no restart
#     (useful for staging a migration during a maintenance window
#     before actually cutting traffic over)
#
# AUTOMATION
#   Not a cron job — cron polling for "did anything change" is the
#   wrong trigger for a deploy. Instead, wire this up as a GitHub
#   webhook target: a small always-running listener (e.g. `webhook`
#   from github.com/adnanh/webhook, or a systemd path unit watching a
#   marker file an existing CI job touches over SSH) invokes this
#   script when the target branch's push event fires. Document your
#   actual trigger mechanism here once it's wired up - deliberately
#   left unspecified since it depends on infra this repo doesn't have
#   yet (a webhook receiver, its own systemd service, a firewall rule
#   to allow GitHub's webhook IPs through).

set -euo pipefail

# ---- Configuration - edit these once for your actual server ----
REPO_DIR="/opt/itti_website"
SERVER_DIR="$REPO_DIR/server"
VENV_DIR="$SERVER_DIR/venv"
BACKEND_SERVICE="itti-backend"
NGINX_SERVICE="itti-frontend-nginx"
HEALTH_URL="http://127.0.0.1:8080/api/health"
HEALTH_RETRIES=10
HEALTH_RETRY_DELAY=3   # seconds between health-check attempts

# ---- Flags ----
BRANCH="database"
BACKUP_DB=false
DO_RESTART=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="$2"; shift 2 ;;
    --backup-db)
      BACKUP_DB=true; shift ;;
    --no-restart)
      DO_RESTART=false; shift ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

log() { echo "[deploy-server $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

cd "$REPO_DIR"

# ---- 1. Pull latest code ----
log "Fetching branch '$BRANCH'..."
git fetch origin "$BRANCH"
BEFORE_SHA=$(git rev-parse HEAD)
git checkout "$BRANCH"
git pull origin "$BRANCH"
AFTER_SHA=$(git rev-parse HEAD)

if [[ "$BEFORE_SHA" == "$AFTER_SHA" ]]; then
  log "Already up to date ($AFTER_SHA) - nothing to deploy. Exiting."
  exit 0
fi
log "Updated $BEFORE_SHA -> $AFTER_SHA"

# ---- Optional: back up the database before migrating ----
# Only meaningful against Postgres (production) - the DATABASE_URL env
# var is what models/database.py itself reads to decide SQLite vs
# Postgres, so this parses it the same way rather than assuming.
if [[ "$BACKUP_DB" == true ]]; then
  if [[ -f "$SERVER_DIR/.env" ]]; then
    DATABASE_URL=$(grep -E '^DATABASE_URL=' "$SERVER_DIR/.env" | cut -d '=' -f2- || true)
  fi
  if [[ "${DATABASE_URL:-}" == postgres* ]]; then
    BACKUP_FILE="/opt/itti_website_backups/pre_deploy_$(date +%Y%m%d_%H%M%S).sql"
    mkdir -p "$(dirname "$BACKUP_FILE")"
    log "Backing up database to $BACKUP_FILE ..."
    pg_dump "$DATABASE_URL" > "$BACKUP_FILE"
    log "Backup complete ($(du -h "$BACKUP_FILE" | cut -f1))"
  else
    log "BACKUP_DB requested but DATABASE_URL isn't Postgres (or wasn't found) - skipping backup, nothing to dump for SQLite via pg_dump."
  fi
fi

# ---- 2. Install/update Python dependencies ----
log "Installing Python dependencies..."
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
pip install --no-cache-dir -r "$SERVER_DIR/requirements-prod.txt"

# ---- 3. Run database migrations ----
log "Running Alembic migrations..."
cd "$SERVER_DIR"
alembic upgrade head
cd "$REPO_DIR"

if [[ "$DO_RESTART" == false ]]; then
  log "--no-restart set - code pulled and migrated, service NOT restarted. Run again without --no-restart when ready to cut over."
  exit 0
fi

# ---- 4. Restart the backend service ----
log "Restarting $BACKEND_SERVICE..."
sudo systemctl restart "$BACKEND_SERVICE"

# ---- 5. Reload nginx (zero-downtime) ----
if systemctl list-unit-files | grep -q "^${NGINX_SERVICE}"; then
  log "Reloading $NGINX_SERVICE..."
  sudo systemctl reload "$NGINX_SERVICE"
else
  log "No $NGINX_SERVICE unit found - skipping (using system nginx directly? adjust NGINX_SERVICE above)."
fi

# ---- 6. Health check, with rollback on failure ----
log "Health-checking $HEALTH_URL ..."
healthy=false
for i in $(seq 1 "$HEALTH_RETRIES"); do
  if curl -sf -o /dev/null "$HEALTH_URL"; then
    healthy=true
    break
  fi
  log "  attempt $i/$HEALTH_RETRIES failed, retrying in ${HEALTH_RETRY_DELAY}s..."
  sleep "$HEALTH_RETRY_DELAY"
done

if [[ "$healthy" == true ]]; then
  log "Health check passed. Deploy of $AFTER_SHA complete."
  exit 0
fi

log "Health check FAILED after $HEALTH_RETRIES attempts. Rolling back code to $BEFORE_SHA and restarting..."
git checkout "$BEFORE_SHA"
# Deliberately NOT re-running migrations backward here - Alembic
# migrations in this repo are additive (new tables/columns), and
# downgrading automatically on a failed health check is a much
# riskier default than leaving the schema at $AFTER_SHA's version
# while the code rolls back to $BEFORE_SHA. A backend running
# $BEFORE_SHA's code against $AFTER_SHA's schema is the same
# situation this repo's CI already treats as safe (forward-compatible
# migrations), so this is intentional, not an oversight. If a
# migration itself is what broke health, restore from the --backup-db
# dump instead.
source "$VENV_DIR/bin/activate"
pip install --no-cache-dir -r "$SERVER_DIR/requirements-prod.txt"
sudo systemctl restart "$BACKEND_SERVICE"
log "Rolled back to $BEFORE_SHA. Investigate before retrying the deploy."
exit 1
