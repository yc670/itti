#!/usr/bin/env bash
#
# deploy-client.sh — standalone build+deploy for the ITTI frontend,
# runnable manually from a Droplet/VPS or a local machine, without
# GitHub Actions.
#
# This intentionally mirrors .github/workflows/deploy-frontend.yml
# step-for-step (same build, same Spaces sync flags, same cache-control
# split, same CDN purge) so the two paths behave identically - if
# you're using GitHub Actions for this already, you don't need this
# script; it exists for triggering the exact same deploy from
# somewhere Actions can't reach (a locked-down internal network) or
# for testing a build against Spaces manually before trusting Actions
# with it.
#
# WHAT THIS SCRIPT DOES, IN ORDER
# ---------------------------------
#  1. Install npm dependencies (npm ci - exact lockfile versions)
#  2. Build the production bundle (vite build, then the postbuild
#     prerender hook - see client/scripts/prerender.mjs)
#  3. Sync dist/ to the DigitalOcean Spaces bucket:
#       - everything except index.html/robots.txt/sitemap.xml gets a
#         1-year immutable cache (safe because Vite content-hashes
#         every filename - a changed file gets a new name, never
#         overwrites an old cached one)
#       - --delete removes anything in the bucket no longer present in
#         this build (old hashed JS/CSS from previous builds)
#  4. Upload index.html with no-cache (must always be revalidated,
#     since it's what points at the hashed asset filenames above - see
#     the workflow's own comment on this, copied through here)
#  5. Upload robots.txt/sitemap.xml with no-cache (unlike hashed
#     assets, these keep the same URL but their content is meant to
#     change over time)
#  6. Purge the DigitalOcean CDN cache so the new index.html is served
#     immediately instead of waiting out the CDN's own TTL
#
# REQUIREMENTS
#   - Node 20+, npm
#   - Playwright's Chromium installed (`npx playwright install --with-deps
#     chromium`) - the build's postbuild hook needs a real browser to
#     prerender each route to static HTML; skip with --no-prerender-check
#     if you've already confirmed it's installed and want to save time
#   - AWS CLI (`aws`) configured or credentials passed via the env vars
#     below - Spaces speaks the S3 API, so the same `aws s3` commands
#     the GitHub workflow uses work here unchanged
#   - The repo-root .env must have GOOGLE_CLIENT_ID set (same as local
#     dev - see vite.config.js) before building, or the Google
#     Sign-In button will silently fail to render in the built site
#
# REQUIRED ENVIRONMENT VARIABLES
#   DO_SPACES_KEY, DO_SPACES_SECRET   - Spaces access key pair
#   DO_SPACES_BUCKET                  - bucket name, e.g. itti-frontend
#   DO_SPACES_REGION                  - e.g. nyc3
#   DO_API_TOKEN                      - DigitalOcean API token (CDN purge)
#   DO_CDN_ENDPOINT_ID                - the CDN endpoint's ID to purge
#
# USAGE
#   export DO_SPACES_KEY=...  DO_SPACES_SECRET=...  DO_SPACES_BUCKET=...
#   export DO_SPACES_REGION=...  DO_API_TOKEN=...  DO_CDN_ENDPOINT_ID=...
#   ./deploy-client.sh
#   ./deploy-client.sh --skip-install       # dist/ already built, just sync+purge
#   ./deploy-client.sh --no-prerender-check # skip the Playwright-installed check
#
# AUTOMATION
#   Same note as deploy-server.sh: not a cron job, since "did client/
#   change" isn't a time-based question. If you're not using
#   deploy-frontend.yml's GitHub Actions trigger for this, wire this
#   script into whatever push-triggered mechanism you're running for
#   the backend (see deploy-server.sh's AUTOMATION section) - call
#   this script alongside/after it when the push touches client/.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$REPO_ROOT/client"

SKIP_INSTALL=false
CHECK_PRERENDER=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install)
      SKIP_INSTALL=true; shift ;;
    --no-prerender-check)
      CHECK_PRERENDER=false; shift ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

log() { echo "[deploy-client $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ---- Sanity-check required env vars up front, before doing any work ----
required_vars=(DO_SPACES_KEY DO_SPACES_SECRET DO_SPACES_BUCKET DO_SPACES_REGION DO_API_TOKEN DO_CDN_ENDPOINT_ID)
missing=()
for v in "${required_vars[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    missing+=("$v")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing required environment variable(s): ${missing[*]}" >&2
  echo "See this script's header comment for what each one is." >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found - install it first (pip install awscli, or your package manager)." >&2
  exit 1
fi

cd "$CLIENT_DIR"

# ---- 1. Install dependencies ----
if [[ "$SKIP_INSTALL" == false ]]; then
  log "Installing npm dependencies (npm ci)..."
  npm ci

  if [[ "$CHECK_PRERENDER" == true ]]; then
    if ! npx playwright --version >/dev/null 2>&1; then
      log "Playwright not found after npm ci - unexpected, check package.json."
      exit 1
    fi
    # Confirm Chromium's actual browser binary is present, not just the
    # npm package - these are separate downloads (see the GitHub
    # workflow's own comment on this exact failure mode).
    if ! npx playwright install --dry-run chromium >/dev/null 2>&1; then
      log "Installing Playwright's Chromium (needed by the postbuild prerender step)..."
      npx playwright install --with-deps chromium
    fi
  fi
else
  log "--skip-install set - using existing node_modules/ and dist/ as-is."
fi

# ---- 2. Build ----
if [[ "$SKIP_INSTALL" == false ]]; then
  log "Building production bundle (vite build + prerender)..."
  npm run build
fi

if [[ ! -d "$CLIENT_DIR/dist" ]]; then
  echo "dist/ not found after build - something went wrong, or --skip-install was passed without a prior build." >&2
  exit 1
fi

# ---- AWS CLI credentials for this run only (not written to disk) ----
export AWS_ACCESS_KEY_ID="$DO_SPACES_KEY"
export AWS_SECRET_ACCESS_KEY="$DO_SPACES_SECRET"
SPACES_ENDPOINT="https://${DO_SPACES_REGION}.digitaloceanspaces.com"

# ---- 3. Sync dist/ to Spaces (immutable cache, excluding the 3 files below) ----
log "Syncing dist/ to s3://${DO_SPACES_BUCKET} ..."
aws s3 sync dist/ "s3://${DO_SPACES_BUCKET}" \
  --endpoint-url "$SPACES_ENDPOINT" \
  --acl public-read \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html" \
  --exclude "robots.txt" \
  --exclude "sitemap.xml"

# ---- 4. index.html: always revalidate ----
log "Uploading index.html (no-cache)..."
aws s3 cp dist/index.html "s3://${DO_SPACES_BUCKET}/index.html" \
  --endpoint-url "$SPACES_ENDPOINT" \
  --acl public-read \
  --cache-control "public,max-age=0,must-revalidate"

# ---- 5. robots.txt / sitemap.xml: always revalidate ----
log "Uploading robots.txt and sitemap.xml (no-cache)..."
aws s3 cp dist/robots.txt "s3://${DO_SPACES_BUCKET}/robots.txt" \
  --endpoint-url "$SPACES_ENDPOINT" \
  --acl public-read \
  --cache-control "public,max-age=0,must-revalidate"
aws s3 cp dist/sitemap.xml "s3://${DO_SPACES_BUCKET}/sitemap.xml" \
  --endpoint-url "$SPACES_ENDPOINT" \
  --acl public-read \
  --cache-control "public,max-age=0,must-revalidate"

# ---- 6. Purge CDN cache ----
log "Purging DigitalOcean CDN cache..."
purge_response=$(curl -s -w "\n%{http_code}" -X DELETE \
  -H "Authorization: Bearer ${DO_API_TOKEN}" \
  "https://api.digitalocean.com/v2/cdn/endpoints/${DO_CDN_ENDPOINT_ID}/cache" \
  -H "Content-Type: application/json" \
  -d '{"files": ["*"]}')
purge_status=$(echo "$purge_response" | tail -n1)
purge_body=$(echo "$purge_response" | sed '$d')

if [[ "$purge_status" -ge 200 && "$purge_status" -lt 300 ]]; then
  log "CDN purge accepted (HTTP $purge_status)."
else
  log "CDN purge request returned HTTP $purge_status: $purge_body"
  log "Deploy of dist/ to Spaces succeeded, but the CDN may keep serving a stale cached version until its normal TTL expires. Investigate the purge failure separately."
  exit 1
fi

log "Frontend deploy complete."
