"""
ITTI backend — Flask API

Serves:
  GET /api/world-data        -> full TopoJSON world topology (countries)
  GET /api/countries         -> dict of all country metric records, keyed by
                                 3-digit ISO numeric code (matches TopoJSON
                                 feature.id, zero-padded)
  GET /api/countries/<code>  -> single country's metric record
  GET /api/country-profiles         -> dict of narrative country profiles
                                        (historical overview + reference,
                                        plus a dashboard note for the
                                        subset with GTBI/ETTI data), keyed
                                        the same way as /api/countries
  GET /api/country-profiles/<code>  -> single country's narrative profile

All country metrics (GTBI / ETTI / EVS / TIE / PDL / ITS) currently live as
placeholders (0) in data/country_data.json. Swap that file's values — or
point load_json() at a real datasource/DB — once live figures are
available; nothing else needs to change.

Auth (Google Sign-In + email/password), server-side session:
  POST /api/auth/google      -> verify a Google ID token, create/find user, start session
  POST /api/auth/signup      -> create an email/password account (always basic tier)
  POST /api/auth/login       -> log in with email/password
  GET  /api/auth/me          -> current session's user record
  POST /api/auth/logout      -> clear session
  DELETE /api/auth/me        -> soft-delete the logged-in user's account

Documents (upload / list / delete), with CRUD events logged for each
action. Uploading/deleting requires the "publisher" tier
(see decorators.py + docs/ACCESS_LEVELS.md); listing your own documents
and event history just requires being logged in. Permanent (hard) delete
is admin-only.
"""
import logging
import json
import io
import os
import re
import secrets
import hmac
import tempfile
from datetime import datetime, timedelta

import stripe
from PIL import Image
from dotenv import load_dotenv
from flask import Flask, jsonify, abort, request, session, send_file
from flask_cors import CORS
from flask_compress import Compress
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import HTTPException
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

import globe_data
import country_profiles_upload
from decorators import get_current_user, login_required, roles_required
from pagination import parse_pagination_args, paginated_json_response
from sqlalchemy import inspect
from models.database import Base, DATABASE_URL, engine
from models.user import (
    create_user, get_user, get_user_by_google_sub, get_user_by_email,
    update_user, delete_user, restore_user, STATUS_HIDDEN,
    get_all_users, VALID_ROLES, ROLE_ADMIN, ROLE_PUBLISHER, ROLE_REVIEWER,
)
from models.document import (
    create_document, get_documents_by_user, get_document, delete_document,
    hard_delete_document,
)
from models.report import (
    create_report, get_report, get_all_reports, get_published_reports, get_pending_reports,
    get_changes_requested_reports, get_deletion_requested_reports, get_deleted_reports,
    get_reports_by_uploader,
    delete_report, restore_report, hard_delete_report, resubmit_report, set_report_category,
    request_report_deletion, reports_to_public_dicts, REPORT_CATEGORIES,
)
from models.report_review import (
    record_review, get_reviews_for_report, reviews_to_public_dicts, ReviewError,
    record_deletion_review, DeletionReviewError,
)
from models.notification import (
    get_notifications_for_user, get_unread_count, mark_notification_read, mark_all_read,
    mark_notifications_read, delete_notifications,
)
from models.favorite_report import (
    add_favorite_report, remove_favorite_report, get_favorite_report_ids, get_favorite_reports_by_user,
)
from models.user_event import create_user_event, get_events_by_user, CRUDAction
from models.password_reset_token import create_reset_token, get_valid_token, mark_token_used
from models.password_reset_code import (
    create_reset_code, verify_code, invalidate_active_codes, MAX_VERIFY_ATTEMPTS,
)
from models.email_verification_code import (
    create_verification_code, verify_code as verify_email_code,
)
from models.saved_chart import (
    create_saved_chart, get_saved_chart, get_saved_charts_by_user, delete_saved_chart,
)
from models.donation import (
    create_donation, get_donation, get_donation_by_confirmation_code,
    get_donation_by_payment_intent, attach_payment_intent,
    finalize_succeeded_donation, mark_donation_failed,
)
from models.enrollment import (
    create_enrollment, get_enrollment, get_enrollment_by_payment_intent,
    get_enrollments_for_user, attach_payment_intent as attach_enrollment_payment_intent,
    finalize_succeeded_enrollment, mark_enrollment_failed, record_refund,
    STATUS_SUCCEEDED as ENROLLMENT_STATUS_SUCCEEDED,
)
from models.fellow import (
    FELLOW_LEVEL_CODES, create_fellow, get_fellow, get_all_fellows,
    update_fellow, delete_fellow,
)
from storage import get_storage
import image_processing
from email_backend import (
    get_email_backend, send_password_reset_code_email, send_email_verification_code_email,
    send_donation_confirmation_email, send_enrollment_confirmation_email,
)
import validation

# Loads the repo-root .env (same file vite.config.js reads for
# GOOGLE_CLIENT_ID) so `python app.py` picks up the same values without
# needing them exported manually every time.
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("itti")

# Optional error tracking - completely inert unless SENTRY_DSN is set, so
# this is safe to leave in for local dev with no Sentry account at all.
SENTRY_DSN = os.environ.get("SENTRY_DSN")
if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.flask import FlaskIntegration

    sentry_sdk.init(dsn=SENTRY_DSN, integrations=[FlaskIntegration()], traces_sample_rate=0.1)
    logger.info("Sentry error tracking enabled")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
WORLD_DATA_PATH = os.path.join(DATA_DIR, "world-110m.json")
COUNTRY_DATA_PATH = os.path.join(DATA_DIR, "country_data.json")
COUNTRY_PROFILES_PATH = os.path.join(DATA_DIR, "country_profiles.json")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

IS_PRODUCTION = os.environ.get("FLASK_ENV") == "production"

# Set this to the Client ID from your Google Cloud OAuth credentials.
# Put it in the repo-root .env in production rather than hardcoding it.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_ORIGIN = os.environ.get("CLIENT_ORIGIN", "http://localhost:5173")

# Donations (Stripe Checkout). STRIPE_SECRET_KEY is required for the
# donate flow to work at all; STRIPE_WEBHOOK_SECRET is required to trust
# incoming webhook calls as genuinely from Stripe (without it the
# /api/donations/webhook route refuses every request rather than trusting
# unsigned payloads). Get both from the Stripe Dashboard - API keys page
# for the secret key, Webhooks page (after adding an endpoint pointing at
# /api/donations/webhook) for the webhook signing secret.
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
# Safe to send to the browser (that's the whole point of a publishable
# key) - loadStripe() on the frontend needs it to mount <Elements>.
STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

FLASK_SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")

# Refuse to boot with dev-default secrets in production - a misconfigured
# env var here is exactly the kind of mistake that's invisible until
# someone exploits it. Fails loudly and immediately instead.
if IS_PRODUCTION:
    missing = []
    if FLASK_SECRET_KEY == "dev-secret-change-me":
        missing.append("FLASK_SECRET_KEY")
    if not GOOGLE_CLIENT_ID:
        missing.append("GOOGLE_CLIENT_ID")
    if not STRIPE_SECRET_KEY:
        missing.append("STRIPE_SECRET_KEY")
    if not STRIPE_WEBHOOK_SECRET:
        missing.append("STRIPE_WEBHOOK_SECRET")
    # storage.py defaults to STORAGE_BACKEND=local, which writes to this
    # container's own disk - fine for local dev, but most hosts
    # (including the one app.yaml targets here) hand you a fresh
    # container on every redeploy, silently discarding anything written
    # to local disk. Every uploaded report/photo would be one deploy
    # away from disappearing without this check, with no error at
    # upload time to warn anyone it happened.
    if os.environ.get("STORAGE_BACKEND", "local").lower() != "s3":
        missing.append("STORAGE_BACKEND=s3 (currently unset/local - uploads would not survive a redeploy)")
    if missing:
        raise RuntimeError(
            f"FLASK_ENV=production but these required env vars are unset/using dev "
            f"defaults: {', '.join(missing)}. Refusing to start."
        )

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY

# Session cookie: Lax is fine for localhost:5173 <-> localhost:5000 (same
# registrable domain, different port = "same-site" for cookie purposes).
# If frontend and backend end up on different domains in production this
# needs SameSite=None + Secure instead - see docs/ACCESS_LEVELS.md.
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = IS_PRODUCTION
app.config["SESSION_COOKIE_HTTPONLY"] = True
# Flask's own default here is 31 days if left unset - long enough that any
# leaked/cached session cookie (see the Cache-Control note above) stays
# exploitable for a month. A week is still generous for "stay logged in."
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

# Hard cap on request body size (defends against giant uploads before
# they ever reach our own MAX_UPLOAD_BYTES check below).
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25 MB

# supports_credentials + an explicit origin (not a wildcard) is required
# for the session cookie to actually be sent/accepted cross-port in the
# browser. CLIENT_ORIGIN still needs updating to the real frontend domain
# once one exists - that part isn't code-solvable yet.
CORS(app, supports_credentials=True, origins=[CLIENT_ORIGIN])

# ---------------------------------------------------------------------------
# CSRF protection (double-submit cookie pattern)
# ---------------------------------------------------------------------------
# Why this approach specifically: this is a pure JSON API authenticated by a
# cookie (see the session config above), not server-rendered HTML forms, so
# Flask-WTF's form-field-based CSRF token doesn't fit naturally - there's no
# <form> for it to inject a hidden field into. The double-submit cookie
# pattern works cleanly with fetch()+CORS instead: the browser holds a
# csrf_token cookie (readable by JS, unlike the HttpOnly session cookie
# above) and the frontend echoes it back in an X-CSRF-Token header on every
# state-changing request. A cross-site attacker can trick a browser into
# *sending* a request with the ambient session cookie attached (the actual
# CSRF vulnerability), but can't read the csrf_token cookie themselves
# (blocked by the same-origin policy) to also set that header correctly -
# so a forged request is missing/wrong on the one thing that matters.
#
# This layers on top of, not instead of, SESSION_COOKIE_SAMESITE=Lax above -
# Lax alone already blocks the cookie on cross-site POSTs in modern
# browsers, but doesn't cover every historical/edge-case browser behavior,
# and defense-in-depth here is cheap.
CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"
# Reused by every route this app already treats as "not a normal browser
# request with our session cookie attached" - the two Stripe webhooks
# (server-to-server, authenticated by Stripe's own signature instead) plus
# any safe/read-only method, which by definition can't change state and so
# isn't a CSRF target in the first place.
CSRF_EXEMPT_PATHS = {"/api/donations/webhook", "/api/certifications/webhook"}


@app.before_request
def enforce_csrf():
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    if request.path in CSRF_EXEMPT_PATHS:
        return None

    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    header_token = request.headers.get(CSRF_HEADER_NAME)

    # compare_digest (constant-time) rather than == - not because the
    # token itself is secret (the whole point of this pattern is that it's
    # NOT secret, it's just something an attacker can't also read), but
    # because there's no reason to leak timing information about a
    # security comparison when a constant-time one costs nothing extra.
    if (
        not cookie_token
        or not header_token
        or not hmac.compare_digest(cookie_token, header_token)
    ):
        return jsonify({
            "error": "csrf_failed",
            "description": "Your session could not be verified. Please refresh the page and try again.",
        }), 403
    return None


@app.after_request
def ensure_csrf_cookie(response):
    """
    Issues a csrf_token cookie on any response that doesn't already have
    one - readable by JS (NOT HttpOnly, unlike the session cookie), since
    the frontend needs to read it back out to set the X-CSRF-Token header
    on its next request. SameSite/Secure mirror the session cookie's own
    settings (see app.config["SESSION_COOKIE_*"] above) for the same
    cross-origin reasoning.

    Checks the RESPONSE's own Set-Cookie headers, not request.cookies -
    request.cookies only reflects what the browser already sent on the
    way in, so checking that here would miss the case where a route
    (get_csrf_token() below) already called response.set_cookie() with a
    specific value earlier in the same response - checking request.cookies
    instead would then overwrite that value with a second, different
    random token, and the token this hook just set would silently not
    match the one get_csrf_token() had already returned in its JSON body.
    """
    already_setting_cookie = any(
        value.startswith(f"{CSRF_COOKIE_NAME}=") for value in response.headers.getlist("Set-Cookie")
    )
    if not request.cookies.get(CSRF_COOKIE_NAME) and not already_setting_cookie:
        response.set_cookie(
            CSRF_COOKIE_NAME,
            secrets.token_urlsafe(32),
            httponly=False,
            samesite=app.config["SESSION_COOKIE_SAMESITE"],
            secure=app.config["SESSION_COOKIE_SECURE"],
            max_age=int(timedelta(days=7).total_seconds()),
        )
    return response

# storage_uri="memory://" keeps each rate-limit counter in that worker
# process's own memory - fine at this app's current scale (no shared
# Redis/Memcached in app.yaml to point at instead), but worth knowing
# the tradeoffs given the 512MB instance:
#   - Not shared across gunicorn's 2 worker processes, so a client's
#     real effective limit is up to (this number) x 2 depending on
#     which worker handles each request, not a hard global cap.
#   - It's an unbounded-until-restart dict of per-key counters for the
#     life of the process. The Dockerfile's --max-requests/
#     --max-requests-jitter now recycle each worker periodically, which
#     also resets this - so it's not a long-term leak in practice, just
#     not a precise limiter. If this app ever adds a Redis instance for
#     other reasons, switching storage_uri to "redis://..." fixes both
#     points at once (flask-limiter supports it out of the box).
#
#   - The sharper problem: --workers 2 in the Dockerfile means two
#     separate processes, each with its own copy of this dict. Limits
#     aren't shared between them, so e.g. "10 per minute" on login is
#     really closer to "up to 20 per minute" in practice depending on
#     which worker a given request lands on - the configured numbers
#     read stricter than what's actually enforced. RATELIMIT_STORAGE_URI
#     lets this be pointed at a real shared store (e.g. redis://...)
#     without a code change once one exists; until then, this warns
#     loudly at startup in production rather than silently under-
#     enforcing brute-force protection with no visible sign anything is
#     off.
RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")
if IS_PRODUCTION and RATELIMIT_STORAGE_URI == "memory://":
    logger.warning(
        "RATELIMIT_STORAGE_URI is unset (defaulting to in-process memory://) while "
        "FLASK_ENV=production. Rate limits are per-worker, not global, with the "
        "Dockerfile's --workers 2 - actual enforcement is looser than the configured "
        "limits suggest. Set RATELIMIT_STORAGE_URI to a shared store (e.g. redis://...) "
        "to close this gap."
    )
limiter = Limiter(get_remote_address, app=app, storage_uri=RATELIMIT_STORAGE_URI, default_limits=[])

# Gzips responses (JSON compresses very well - typically 70-85% smaller)
# above COMPRESS_MIN_SIZE, for any client whose Accept-Encoding allows it.
# Registered before set_security_headers below deliberately: Flask runs
# after_request hooks in *reverse* registration order, so registering
# Compress's hook first means it actually runs LAST - the security/
# cache headers and ETag below get computed against the real,
# uncompressed response, and compression is applied as the final step
# on top, not interleaved with any of that.
app.config["COMPRESS_MIN_SIZE"] = 500  # bytes - skip compressing tiny responses, not worth the CPU
app.config["COMPRESS_MIMETYPES"] = ["application/json", "text/html", "text/css", "application/javascript"]
Compress(app)


@app.after_request
def set_security_headers(response):
    """Baseline hardening headers. This is a JSON API (not serving HTML
    pages), so CSP is locked down hard by default.

    Cache-Control: no-store is set on every response, not just the
    obviously session-dependent ones (/api/auth/me, /api/profile,
    etc.) - this API sits behind whatever proxy/CDN layer the hosting
    platform puts in front of it, and jsonify() alone sets no caching
    header at all. Without an explicit no-store, a shared cache that
    doesn't itself vary on the session cookie (many don't, by
    default) can serve one person's cached JSON body - which for an
    endpoint like /api/auth/me *is* "being logged into their
    account" from the frontend's point of view - to a completely
    different visitor who never presented that cookie at all. Vary:
    Cookie is defense-in-depth on top of that for any cache that
    ignores no-store but does respect Vary. The few truly public,
    identical-for-everyone payloads (world topology, aggregate globe
    data) are already cached at the application layer in this
    process's memory (see load_json_cached() below), so nothing here
    loses real caching benefit - it just stops relying on an
    HTTP-level cache to do it safely for personalized responses."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    # setdefault, not a blanket overwrite: a handful of routes below
    # (world topology, country data/profiles) explicitly set their own
    # long-lived, public Cache-Control before returning, since they're
    # identical for every visitor regardless of session and are hit on
    # every single page load. Everything else still gets the no-store
    # default this docstring describes - setdefault only fills in a
    # value if the route didn't already set one, it never clobbers an
    # explicit choice a route made.
    response.headers.setdefault("Cache-Control", "no-store, private")
    response.headers["Pragma"] = "no-cache"
    response.headers["Vary"] = "Cookie"
    if request.is_secure:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


@app.errorhandler(429)
def handle_rate_limit_exceeded(e):
    """
    Flask-Limiter's default description for a 429 is its internal rate
    spec string (e.g. "10 per 1 minute") - accurate but not a sentence
    a visitor should have to parse. Swaps in a plain-language message;
    the specific limit that was hit is logged instead, for whoever's
    debugging.
    """
    logger.info("Rate limit exceeded on %s %s", request.method, request.path)
    return jsonify({
        "error": "Too Many Requests",
        "description": "Too many attempts. Please wait a bit before trying again.",
    }), 429


@app.errorhandler(HTTPException)
def handle_http_exception(e):
    """
    Flask/Werkzeug's default behavior for abort(...) is an HTML error
    page, not JSON. Every fetch() caller on the frontend does
    res.json().catch(() => ({})), so without this handler every
    abort(status, description="...") in this file is invisible to the
    UI - the real message gets silently discarded and every component
    falls back to its own generic hardcoded string instead. This makes
    every abort() response JSON, so the description text set throughout
    this file actually reaches the person using the site.
    description is always a short, safe, hand-written string at every
    call site in this file - never raw exception text (see
    globe_data.WorkbookValidationError and validation.py for the
    pattern to follow when adding new checks).
    """
    return jsonify({"error": e.name, "description": e.description}), e.code


@app.errorhandler(Exception)
def handle_uncaught_exception(e):
    """
    Catches anything NOT already handled above or by a route's own
    try/except - a real bug, a DB hiccup, etc. Logs the full exception
    server-side and returns one generic message, regardless of debug
    mode. Without this, an uncaught exception under app.run(debug=True)
    serves Werkzeug's interactive debugger over HTTP: full stack trace,
    source snippets, local variable values, and a remote code execution
    console, to anyone who triggers it.
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.path)
    return jsonify({"error": "internal server error", "description": "Something went wrong. Please try again."}), 500


# Local SQLite dev DB: auto-create tables so `python app.py` just works
# with zero setup on a brand new clone. Deliberately gated on the DB
# being completely empty (no tables at all yet) rather than just "is
# this sqlite" - a real deployment can also use sqlite (e.g. a small
# droplet with no Postgres), and unconditionally re-running create_all()
# on every restart is NOT safe there: create_all() only ever creates
# tables that don't exist yet, it never alters an existing table to add
# a newly-modeled column. That mismatch (new tables silently kept
# current, older tables silently left missing every column any
# migration added after their first creation) is exactly what caused
# `reports` to end up missing resubmission_note/review_status/version/
# category/updated_at for months on the ittiglobal.org droplet, invisible
# until GET /api/reports finally hit one of the missing columns - see
# server/fix_reports_schema.py for the one-time repair, and
# docs/DEPLOYMENT.md.
#
# Once ANY tables exist - whether from this running once, or from
# `alembic upgrade head` - alembic owns schema changes from then on;
# this block gets out of the way and never fires again for that DB.
if DATABASE_URL.startswith("sqlite") and not inspect(engine).get_table_names():
    Base.metadata.create_all(engine)

storage = get_storage(UPLOAD_DIR)
REPORTS_UPLOAD_DIR = os.path.join(BASE_DIR, "report_uploads")
report_storage = get_storage(REPORTS_UPLOAD_DIR, s3_prefix="reports")
FELLOWS_UPLOAD_DIR = os.path.join(BASE_DIR, "fellow_uploads")
fellow_storage = get_storage(FELLOWS_UPLOAD_DIR, s3_prefix="fellows")
email_backend = get_email_backend()

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB per file
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".csv", ".txt", ".png", ".jpg", ".jpeg"}

# Fellow photos: source format doesn't actually matter beyond "Pillow
# can open it" - image_processing.normalize_photo() re-encodes
# everything to JPEG regardless, so this is a broad allow-list of
# common formats rather than a strict content check.
ALLOWED_FELLOW_PHOTO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
MAX_FELLOW_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB per file, pre-normalization

# Reports only accept a PDF or Word doc as the report itself, and a
# real image (if provided at all) as the cover picture - narrower than
# the general document upload above, since these are the two specific
# file roles the Reports page actually renders.
ALLOWED_REPORT_FILE_EXTENSIONS = {".pdf", ".doc", ".docx"}
ALLOWED_REPORT_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_REPORT_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB per cover image, individually

# The binding limit in practice for a report upload: report file +
# cover image TOGETHER, checked before either is written to storage.
# MAX_UPLOAD_BYTES/MAX_REPORT_IMAGE_BYTES above still apply as a
# per-file backstop, but at 2.5MB combined this is always the tighter,
# actually-enforced constraint for reports specifically - see
# _save_report_upload().
MAX_REPORT_COMBINED_BYTES = int(2.5 * 1024 * 1024)  # 2.5 MB, file + image together

# GTBI/ETTI workbooks: same shape the data_scripts/{kind}_extract.py CLI
# scripts already expect (a multi-sheet .xlsx workbook, not a flat CSV -
# etti_extract.py reads named sheets like "EVS"/"Final ETTI" and
# gtbi_extract.py reads a "GTBI Panel" sheet, which a CSV export can't
# represent). Generous size cap since the real workbooks are ~100-200KB.
ALLOWED_GLOBE_DATA_EXTENSIONS = {".xlsx"}
MAX_GLOBE_DATA_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB per file

# Country-profile source documents: the real ones in
# data_scripts/country_profiles_source/ are 60-70KB each, so this cap
# is generous headroom rather than a reflection of expected size.
ALLOWED_COUNTRY_PROFILE_EXTENSIONS = {".docx"}
MAX_COUNTRY_PROFILE_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB per file


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# In-process cache for the three read-mostly JSON data files, keyed by
# path. Each of these used to be re-opened and re-parsed from disk on
# every single request to the endpoints below - harmless in isolation
# given how small the files are (~1MB combined), but needless
# allocation/GC churn under concurrent load, especially on the 512MB
# instance app.yaml deploys to. world-110m.json and country_profiles.json
# are never written by the running app (only ever regenerated offline
# and redeployed), so they're cached for the process's whole lifetime.
# country_data.json IS written at runtime, by
# globe_data.apply_workbook_to_country_data() via POST
# /api/globe-data/upload - that route calls _invalidate_json_cache()
# right after a successful write so the next read picks up the change,
# same as if the process had just restarted.
_json_cache = {}


def load_json_cached(path):
    if path not in _json_cache:
        _json_cache[path] = load_json(path)
    return _json_cache[path]


def _invalidate_json_cache(path):
    _json_cache.pop(path, None)


def cacheable_json_response(data, max_age):
    """jsonify() a payload that's identical for every visitor (no
    session/auth involvement) with real HTTP caching, instead of the
    no-store default set_security_headers() applies to everything else.

    Adds an ETag and honors conditional GETs (If-None-Match) via
    make_conditional() - a repeat request within max_age never reaches
    this process at all (served from the browser/CDN cache), and one
    past max_age but for unchanged data gets a tiny 304 with no body
    rather than re-sending the full payload. public is safe here
    specifically because these responses don't vary by cookie/session -
    see the docstring on set_security_headers() for why everything else
    stays no-store.

    max_age is deliberately short (minutes, not hours/days) for data
    that CAN change at runtime via an admin upload (country_data.json),
    longer for data that's only ever regenerated offline and redeployed
    (world topology, country_profiles.json) - see load_json_cached()'s
    comment above. Either way it bounds how stale a cached response can
    be, rather than caching indefinitely.
    """
    response = jsonify(data)
    response.headers["Cache-Control"] = f"public, max-age={max_age}, stale-while-revalidate=60"
    response.add_etag()
    return response.make_conditional(request)


@app.get("/api/world-data")
def get_world_data():
    """Raw TopoJSON topology used to draw the globe. Never changes at
    runtime (see load_json_cached()'s comment) - safe to cache longer."""
    return cacheable_json_response(load_json_cached(WORLD_DATA_PATH), max_age=3600)


@app.get("/api/countries")
def get_countries():
    """All country metric records, keyed by zero-padded ISO numeric code.
    Can change at runtime via POST /api/globe-data/upload - shorter
    max_age so an admin's update propagates reasonably promptly."""
    return cacheable_json_response(load_json_cached(COUNTRY_DATA_PATH), max_age=300)


@app.get("/api/countries/<code>")
def get_country(code):
    """A single country's metric record."""
    data = load_json_cached(COUNTRY_DATA_PATH)
    record = data.get(code.zfill(3)) or data.get(code)
    if record is None:
        abort(404, description=f"No data for country code '{code}'")
    return cacheable_json_response(record, max_age=300)


@app.get("/api/country-profiles")
def get_country_profiles():
    """
    All narrative country profiles (historical trauma overview + APA
    reference, plus an Observatory dashboard note for the subset of
    countries with GTBI/ETTI data), keyed by the same zero-padded ISO
    numeric code as /api/countries. Not every code in /api/countries has
    an entry here - see data_scripts/country_profiles_extract.py's
    docstring for which countries are covered and why a couple aren't
    (most notably Kosovo, which has no ISO 3166-1 numeric code at all).
    Never changes at runtime (only ever regenerated offline and
    redeployed, like world topology) - safe to cache longer.
    """
    return cacheable_json_response(load_json_cached(COUNTRY_PROFILES_PATH), max_age=3600)


@app.get("/api/country-profiles/<code>")
def get_country_profile(code):
    """A single country's narrative profile, if one exists."""
    data = load_json_cached(COUNTRY_PROFILES_PATH)
    record = data.get(code.zfill(3)) or data.get(code)
    if record is None:
        abort(404, description=f"No profile for country code '{code}'")
    return cacheable_json_response(record, max_age=3600)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/csrf-token")
def get_csrf_token():
    """
    A GET, so it's never itself subject to the CSRF check above (and
    doesn't need to be, since it doesn't change any state). The frontend
    calls this once on app load (see AuthContext.jsx) specifically so a
    csrf_token cookie is guaranteed to exist before the very first
    state-changing request (login, signup, etc.) - without this, that
    first POST would arrive with no cookie yet to compare against and
    get rejected by enforce_csrf(), a chicken-and-egg problem the plain
    after_request hook alone can't solve for a request that never has a
    prior GET.

    Reuses the existing cookie if the browser already sent one (request.
    cookies reflects what was already set - most calls to this route
    after the first will already have it), otherwise generates a fresh
    one directly here rather than relying on ensure_csrf_cookie() to
    notice it's missing: that hook runs on the RESPONSE and has no way to
    also report the value back in this response's JSON body, since by
    the time it runs this view function has already returned. Returning
    it in the body (not just the cookie) lets the frontend read it
    immediately from this call's result rather than needing to parse
    document.cookie in a separate step right after.
    """
    token = request.cookies.get(CSRF_COOKIE_NAME) or secrets.token_urlsafe(32)
    response = jsonify({"csrf_token": token})
    response.set_cookie(
        CSRF_COOKIE_NAME,
        token,
        httponly=False,
        samesite=app.config["SESSION_COOKIE_SAMESITE"],
        secure=app.config["SESSION_COOKIE_SECURE"],
        max_age=int(timedelta(days=7).total_seconds()),
    )
    return response


# ---------------------------------------------------------------------------
# Auth (Google Sign-In + email/password)
# ---------------------------------------------------------------------------

@app.post("/api/auth/google")
@limiter.limit("20 per minute")
def auth_google():
    """
    Body: { "credential": "<Google ID token JWT from the frontend button>" }
    Verifies the token with Google, creates the user if new (always at
    ROLE_BASIC), and starts a Flask session (cookie-based).

    Rate limited same as the reasoning for every other auth route here -
    even though a valid credential requires an actual Google account (this
    isn't guessable the way a password is), the route still does real work
    per request (a network call to Google to verify the JWT, a DB lookup/
    write) with no cost to an attacker submitting garbage tokens just to
    burn server time, and no rate limit at all was a gap relative to every
    other route in this file that touches auth/session state.
    """
    body = request.get_json(silent=True) or {}
    credential = body.get("credential")
    if not credential:
        abort(400, description="Missing 'credential' in request body")

    if not GOOGLE_CLIENT_ID:
        abort(500, description="Server is missing GOOGLE_CLIENT_ID configuration")

    try:
        claims = id_token.verify_oauth2_token(
            credential, google_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError:
        abort(401, description="Invalid Google credential")

    google_sub = claims["sub"]
    # Normalize the same way /api/auth/signup and /api/auth/login do. Google
    # claims are almost always already lowercase, but that's not guaranteed
    # (e.g. some Workspace/custom-domain accounts) - without this, a casing
    # mismatch would bypass the email lookup below and silently create a
    # second account instead of linking to the existing one.
    email = (claims.get("email") or "").strip().lower()
    name = claims.get("name")
    picture_url = claims.get("picture")

    # include_hidden=True on both lookups: a soft-deleted account (google_sub
    # or email) would otherwise be invisible here, and create_user() below
    # would then crash on the unique google_sub/email constraint instead of
    # reactivating the existing row.
    linked_existing_account = False
    user = get_user_by_google_sub(google_sub, include_hidden=True)
    if user is None:
        # An account with this email may already exist from an email/password
        # sign-up. Link the Google identity to it rather than erroring, since
        # email is unique and it's the same person.
        user = get_user_by_email(email, include_hidden=True)
        if user is not None:
            # Only "linking" if this account didn't already have Google
            # attached - a pure reactivation of an already-Google-linked
            # soft-deleted account shouldn't say "your account was updated
            # with the existing account," since nothing is actually being
            # merged here (see the has_password check on the frontend for
            # why this specifically means "was this a password account they
            # hadn't used Google with before").
            linked_existing_account = user.google_sub is None and user.password_hash is not None
            # email_verified=True unconditionally here too, even if they
            # were already verified - Google just independently proved
            # ownership of this exact email address, which is at least as
            # strong a guarantee as the emailed-code flow this account
            # may or may not have completed.
            update_user(user.id, google_sub=google_sub, name=user.name or name,
                        picture_url=user.picture_url or picture_url, email_verified=True)
        else:
            user = create_user(google_sub=google_sub, email=email, name=name, picture_url=picture_url)

    if user.status == STATUS_HIDDEN:
        # They previously deleted this account; signing back in (Google or
        # password) is treated as an intentional reactivation rather than a
        # dead end.
        restore_user(user.id)
        logger.info("google login reactivated soft-deleted user_id=%s", user.id)

    user = get_user(user.id)

    session.clear()
    session["user_id"] = user.id
    session.permanent = True

    if linked_existing_account:
        logger.info("google login linked to existing password account user_id=%s", user.id)

    logger.info("google login user_id=%s", user.id)
    response = user.to_public_dict()
    # Sibling key, not folded into to_public_dict() itself - that method's
    # shape is shared by every auth/profile endpoint (login, signup,
    # /auth/me, update-profile, etc.), and this flag is only meaningful
    # for this one response, describing what just happened in this
    # request rather than being a persistent property of the user.
    response["linked_existing_account"] = linked_existing_account
    return jsonify(response)


@app.post("/api/auth/signup")
@limiter.limit("5 per hour")
def auth_signup():
    """
    Body: { "email": "...", "password": "...", "name": "..." (optional) }
    Creates a new email/password account, always at ROLE_BASIC (see
    models/user.py) - nothing in this request can set a different role.
    Returns 409 if the email belongs to an active account. If the email
    belongs to a previously soft-deleted account instead, reactivates it
    with the new name/password rather than erroring - their old
    documents/event history come back with it.

    Does NOT log the user in - unlike before email verification existed,
    a fresh signup starts unverified (email_verified=False - see that
    column's own comment in models/user.py) and /api/auth/login refuses
    to authenticate an unverified account. Instead, this sends a 6-digit
    code and the response tells the frontend to route to the "enter your
    code" screen (see /api/auth/verify-email below), the same pattern
    already used for password reset.
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    name = (body.get("name") or "").strip() or None

    if not email or not EMAIL_RE.match(email):
        abort(400, description="A valid email is required")
    if len(password) < 8:
        abort(400, description="Password must be at least 8 characters")

    # include_hidden=True: a previously-deleted account with this email
    # still holds the row (soft delete never removes it), and the unique
    # constraint on email means a plain create_user() call below would
    # otherwise crash with an IntegrityError instead of a clean response.
    existing = get_user_by_email(email, include_hidden=True)
    if existing is not None:
        if existing.status != STATUS_HIDDEN:
            abort(409, description="An account with this email already exists")

        # They previously deleted this account. Treat signing up again with
        # the same email as reactivating it (with the new password/name)
        # rather than a dead end - their old documents/event history are
        # still attached to this same row and come back with it. Their
        # prior verification status is intentionally NOT reset to False -
        # if they'd verified this email before, Google-linked it, or this
        # is a re-signup after a failed verification attempt on a still-
        # unverified row, either way falling through to the same
        # send-a-code path below is correct and harmless either way.
        password_hash = generate_password_hash(password)
        update_user(existing.id, password_hash=password_hash, name=name or existing.name)
        restore_user(existing.id)
        user = get_user(existing.id)
        logger.info("signup reactivated soft-deleted user_id=%s", user.id)
    else:
        password_hash = generate_password_hash(password)
        user = create_user(email=email, password_hash=password_hash, name=name)
        logger.info("signup user_id=%s", user.id)

    if user.email_verified:
        # Already verified (e.g. reactivating a previously-verified
        # account) - log them in immediately, same as before email
        # verification existed, since there's nothing left to prove.
        session.clear()
        session["user_id"] = user.id
        session.permanent = True
        return jsonify(user.to_public_dict()), 201

    try:
        raw_code = create_verification_code(user.id)
        send_email_verification_code_email(email_backend, user.email, raw_code)
        logger.info("signup verification code sent user_id=%s", user.id)
    except Exception:
        # Unlike forgot_password()'s deliberate silence (see that route's
        # own comment on why a send failure there must be invisible to
        # the caller) - here the account genuinely isn't usable without a
        # code, so the person needs to know sending failed rather than
        # being left staring at a "check your email" screen for an email
        # that never arrived. Logged for operators either way.
        logger.exception("signup verification code email failed to send user_id=%s", user.id)
        abort(500, description="Your account was created, but we couldn't send the verification email. Please try resending it.")

    return jsonify({"id": user.id, "email": user.email, "needs_verification": True}), 201


@app.post("/api/auth/verify-email")
@limiter.limit("10 per hour")
def verify_email_route():
    """
    Body: { "email": "...", "code": "..." }
    Marks the account verified and logs the user in - entering the
    correct code proves email ownership, same reasoning as
    /api/auth/forgot-password/verify logging the user in on a correct
    reset code.
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()

    generic_invalid = jsonify({"error": "invalid_email_or_code", "description": "That code doesn't match."})

    if not email or not EMAIL_RE.match(email) or not code:
        return generic_invalid, 400

    user = get_user_by_email(email)
    if user is None:
        return generic_invalid, 400

    result = verify_email_code(user.id, code)

    if result == "ok":
        update_user(user.id, email_verified=True)
        user = get_user(user.id)
        session.clear()
        session["user_id"] = user.id
        session.permanent = True
        logger.info("email verified user_id=%s", user.id)
        return jsonify(user.to_public_dict())

    if result == "too_many_attempts":
        abort(429, description="Too many incorrect attempts. Please request a new code.")
    if result == "expired":
        abort(400, description="This code has expired. Please request a new one.")
    abort(400, description="That code doesn't match. Please check it and try again.")


@app.post("/api/auth/resend-verification")
@limiter.limit("5 per hour")
def resend_verification_route():
    """
    Body: { "email": "..." }
    Same generic-response shape as /api/auth/forgot-password/resend, for
    the same email-enumeration reason - but this one intentionally DOES
    let the caller know if the account is already verified (nothing to
    resend) or doesn't exist, unlike the password-reset flow. Signup
    already told this exact person their own account's email a moment
    ago (the 201 response includes it) - there's no new information
    being leaked to a stranger that they couldn't already get by simply
    trying to sign up with that email and seeing the 409.
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()

    if not email or not EMAIL_RE.match(email):
        abort(400, description="A valid email is required")

    user = get_user_by_email(email)
    if user is None:
        abort(404, description="No account found for that email")
    if user.email_verified:
        return jsonify({"message": "This account is already verified - you can log in."})

    try:
        raw_code = create_verification_code(user.id)
    except RuntimeError as e:
        return jsonify({"message": str(e)})

    try:
        send_email_verification_code_email(email_backend, user.email, raw_code)
        logger.info("verification code resent user_id=%s", user.id)
    except Exception:
        logger.exception("resend verification code email failed to send user_id=%s", user.id)
        abort(500, description="Could not send the verification email. Please try again in a moment.")

    return jsonify({"message": "A new verification code has been sent."})


@app.post("/api/auth/login")
@limiter.limit("8 per minute")
@limiter.limit("30 per hour")
def auth_login():
    """
    Body: { "email": "...", "password": "..." }
    Logs in with an email/password account created via /api/auth/signup.
    If the account was previously soft-deleted, a correct password
    reactivates it rather than being rejected.

    Refuses to log in an unverified account (email_verified=False - see
    that column's own comment in models/user.py) even with the correct
    password - returns 403 with needs_verification so the frontend can
    route straight to the code-entry screen instead of a generic error.

    Two limits, not one: "8 per minute" alone would still allow 480
    attempts/hour if spread out evenly, which is a meaningful budget for
    guessing a weak password against one known email - this app has no
    account-level lockout (soft-deleted accounts already reactivate on a
    correct password, so a per-account failed-attempt counter would need
    to interact with that), so this IP-based limit is the only real
    defense against credential-guessing on login. The per-minute limit
    alone still absorbs a real user mistyping their password a few times
    in a row without being blocked.
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    # include_hidden=True: without this a soft-deleted account can never log
    # back in at all (get_user_by_email would silently act as if no account
    # existed), even with the correct password and no way to recover it.
    user = get_user_by_email(email, include_hidden=True)
    if user is None or not user.password_hash or not check_password_hash(user.password_hash, password):
        abort(401, description="Invalid email or password")

    if not user.email_verified:
        # Correct password, but the email was never confirmed - a
        # different failure mode than "wrong credentials", so it gets its
        # own status code and payload rather than the generic 401 above,
        # which would otherwise leave the frontend no way to distinguish
        # "wrong password" from "right password, unverified account."
        # Returned directly (not abort()) since the extra "email" field
        # needs to reach the frontend - the shared HTTPException handler
        # only forwards error/description, not arbitrary extra keys.
        return jsonify({
            "error": "email_not_verified",
            "description": "Please verify your email before logging in.",
            "email": user.email,
        }), 403

    if user.status == STATUS_HIDDEN:
        # Correct password proves ownership, so treat this as an intentional
        # reactivation rather than leaving the account permanently locked
        # out - same behavior as signing up again or via Google (see those
        # handlers). Their documents/event history are still attached to
        # this same row and come back with it.
        restore_user(user.id)
        user = get_user(user.id)
        logger.info("login reactivated soft-deleted user_id=%s", user.id)

    session.clear()
    session["user_id"] = user.id
    session.permanent = True

    return jsonify(user.to_public_dict())


def _send_reset_code_or_none(user):
    """
    Shared by forgot_password and resend_reset_code: creates+sends a
    fresh code for a user, swallowing send failures the same way (see
    the comment in forgot_password below for why). Returns True if a
    code was actually created (even if the email send itself failed),
    False if create_reset_code() refused due to the resend cooldown -
    callers use that to distinguish "silently did nothing" from "hit
    the resend-too-fast guard," which resend_reset_code needs to expose
    to the user (it's not an email-enumeration risk, since the caller
    already has an active session en route to entering a code).
    """
    try:
        raw_code = create_reset_code(user.id)
    except RuntimeError:
        return False

    try:
        send_password_reset_code_email(email_backend, user.email, raw_code)
        logger.info("password reset code sent user_id=%s", user.id)
    except Exception:
        # Deliberately NOT re-raised - see forgot_password()'s docstring
        # for why a send failure here must look identical, from the
        # outside, to "nothing was wrong to begin with."
        logger.exception("password reset code email failed to send user_id=%s", user.id)
    return True


@app.post("/api/auth/forgot-password")
@limiter.limit("5 per hour")
def forgot_password():
    """
    Body: { "email": "..." }
    Always returns the same generic response regardless of whether the
    email is registered - this deliberately doesn't reveal which emails
    have accounts. If the account exists, a 6-digit verification code is
    emailed via the configured backend (console-logged in dev by
    default, see email_backend.py). The frontend always advances to the
    "enter your code" screen next, since revealing "no code was sent"
    would itself leak account existence.
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()

    generic_response = jsonify({
        "message": "If an account exists for that email, a verification code has been sent."
    })

    if not email or not EMAIL_RE.match(email):
        return generic_response

    user = get_user_by_email(email)
    if user is not None:
        # A broken SMTP config (bad credentials, an unverified Brevo
        # sender, a transient outage) should look identical from the
        # outside to a correctly-working one that just happened to email
        # someone who doesn't recognize the request - a send failure is
        # still a real problem worth fixing (logged above), just not one
        # the requester should see or be able to distinguish from
        # "nothing was wrong to begin with." This is also why this
        # route's own exceptions must never propagate to the generic
        # @app.errorhandler(Exception) below: that would 500 only when
        # the email IS registered, which is exactly the account-
        # existence oracle the generic response is designed to prevent.
        _send_reset_code_or_none(user)

    return generic_response


@app.post("/api/auth/forgot-password/resend")
@limiter.limit("5 per hour")
def resend_reset_code():
    """
    Body: { "email": "..." }
    Same generic-response shape and email-enumeration protection as
    forgot-password above (a resend request is just another code
    request) - but additionally invalidates whatever code was
    outstanding, per create_reset_code()'s own invalidate-previous
    behavior, and surfaces the resend cooldown as a distinct message
    when it's hit, since "you just requested one, hang on" is useful
    feedback that doesn't leak whether the account exists (the same
    generic wording is shown either way if the email isn't registered).
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()

    generic_response = jsonify({
        "message": "If an account exists for that email, a new verification code has been sent."
    })

    if not email or not EMAIL_RE.match(email):
        return generic_response

    user = get_user_by_email(email)
    if user is not None:
        sent = _send_reset_code_or_none(user)
        if not sent:
            return jsonify({
                "message": "A code was already sent recently - please wait a moment before requesting another."
            })

    return generic_response


@app.post("/api/auth/forgot-password/back")
@limiter.limit("20 per hour")
def forgot_password_back():
    """
    Body: { "email": "..." }
    Called when the user backs out of the "enter your code" screen to
    re-enter their email (e.g. they mistyped it). Invalidates any
    outstanding code for that email so it can't still be used after the
    user has indicated it's the wrong address. No-ops silently (same
    generic response) if the email isn't registered - nothing to
    invalidate, and this must not become an email-enumeration oracle
    either. Rate limited mainly so this can't be used to grief someone
    else's in-progress reset by repeatedly invalidating their codes
    faster than they can act on one.
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()

    if email and EMAIL_RE.match(email):
        user = get_user_by_email(email)
        if user is not None:
            invalidate_active_codes(user.id)

    return jsonify({"message": "ok"})


@app.post("/api/auth/forgot-password/verify")
@limiter.limit("10 per hour")
def verify_reset_code():
    """
    Body: { "email": "...", "code": "..." }
    Checks a 6-digit code against the most recent one issued for that
    email. On success, logs the user in immediately (same as the old
    link-based reset_password did) - entering the correct code proves
    account ownership just as clicking a unique emailed link did, and
    this lets the frontend land directly on the Profile page's Settings
    tab to actually change the password, fully authenticated, rather
    than needing a separate one-off "set new password" form/token.
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()

    generic_invalid = jsonify({"error": "invalid_email_or_code", "description": "That code doesn't match."})

    if not email or not EMAIL_RE.match(email) or not code:
        return generic_invalid, 400

    user = get_user_by_email(email)
    if user is None:
        # Same wording as a real mismatch below - doesn't reveal whether
        # the email itself is registered.
        return generic_invalid, 400

    result = verify_code(user.id, code)

    if result == "ok":
        session.clear()
        session["user_id"] = user.id
        session.permanent = True
        logger.info("password reset code verified user_id=%s", user.id)
        return jsonify(user.to_public_dict())

    if result == "too_many_attempts":
        abort(429, description="Too many incorrect attempts. Please request a new code.")

    if result == "expired":
        abort(400, description="This code has expired. Please request a new one.")

    # "mismatch"
    abort(400, description="That code doesn't match. Please check it and try again.")


@app.post("/api/auth/reset-password")
@limiter.limit("10 per hour")
def reset_password():
    """
    Body: { "token": "...", "password": "..." }
    Legacy link-based redemption path, kept only so any reset link
    already emailed before this deploy (1-hour TTL - see
    models/password_reset_token.py) still works rather than 400ing
    outright. The forgot-password flow itself no longer generates these
    tokens or links (see forgot_password() above, which now sends a
    6-digit code instead) - new requests go through
    /api/auth/forgot-password/verify.
    """
    body = request.get_json(silent=True) or {}
    token = body.get("token") or ""
    password = body.get("password") or ""

    if len(password) < 8:
        abort(400, description="Password must be at least 8 characters")

    record = get_valid_token(token)
    if record is None:
        abort(400, description="This reset link is invalid or has expired")

    update_user(record.user_id, password_hash=generate_password_hash(password))
    mark_token_used(record.id)

    user = get_user(record.user_id)
    if user is None:
        abort(404, description="User not found")

    # Log them in immediately - they just proved account ownership via email.
    session.clear()
    session["user_id"] = user.id
    session.permanent = True

    logger.info("password reset completed user_id=%s", user.id)
    return jsonify(user.to_public_dict())


@app.get("/api/auth/me")
@login_required
def auth_me():
    """Returns the logged-in user, or 401 if no session."""
    user = get_current_user()
    if user is None:
        # login_required above already returned 401 for an expired/missing
        # session before this line could even run - reaching here with
        # user is None specifically means the session's user_id no longer
        # corresponds to a real account (e.g. the account was hard-deleted
        # between requests), a different, rarer situation from a timed-out
        # session.
        session.clear()
        abort(404, description="User not found")
    return jsonify(user.to_public_dict())


@app.post("/api/auth/update-profile")
@login_required
@limiter.limit("20 per hour")
def update_profile():
    """
    Body: { "name"?: str, "current_password"?: str, "new_password"?: str }
    Each field is independent - send just "name" to rename, or both
    password fields together to change password. Sending a password
    field without the other is a 400. Google-only accounts (no
    password_hash yet) can set an initial password by sending just
    "new_password" with no "current_password".

    Rate limited - this checks current_password against the stored hash
    when changing password, which is otherwise brute-forceable by anyone
    who has (or has stolen/fixated) a valid session, same as any other
    password-verification endpoint in this file.
    """
    user = get_current_user()
    body = request.get_json(silent=True) or {}

    updates = {}

    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            abort(400, description="Name cannot be empty")
        if len(name) > 100:
            abort(400, description="Name is too long")
        updates["name"] = name

    current_password = body.get("current_password")
    new_password = body.get("new_password")
    if current_password is not None or new_password is not None:
        if not new_password:
            abort(400, description="new_password is required to change your password")
        if len(new_password) < 8:
            abort(400, description="Password must be at least 8 characters")
        if user.password_hash:
            # Existing password on file - must confirm it first.
            if not current_password or not check_password_hash(user.password_hash, current_password):
                abort(401, description="Current password is incorrect")
        # else: Google-only account with no password yet - setting an
        # initial password doesn't require confirming a nonexistent one.
        updates["password_hash"] = generate_password_hash(new_password)

    if not updates:
        abort(400, description="Nothing to update")

    updated = update_user(user.id, **updates)
    logger.info("user_id=%s updated profile fields=%s", user.id, list(updates.keys()))
    return jsonify(updated.to_public_dict())


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"status": "logged out"})


@app.delete("/api/auth/me")
@login_required
@limiter.limit("10 per hour")
def delete_account():
    """
    Soft-deletes the logged-in user's account: sets status to 0
    (hidden) rather than removing the row. Their documents and event
    history stay intact. Logs the deletion as a DELETE event, then
    clears the session.

    Rate limited as defense-in-depth even though this doesn't check a
    password (there's nothing to brute-force) - a destructive action
    with no confirmation step beyond "are you logged in" is worth
    throttling against a buggy client retry-looping or a replayed
    request, same reasoning as everywhere else in this file.
    """
    user = get_current_user()
    delete_user(user.id)
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.DELETE)
    session.clear()
    return jsonify({"status": "account deleted"})


# ---------------------------------------------------------------------------
# Admin: user access-level management. Backs the "Manage Users" panel in
# Settings (admin-only). Role changes were previously CLI-only on purpose
# (see promote_user.py's docstring) - this adds an in-app path for the
# same action, still gated to admin and still logged as a UserEvent per
# change, same accountability the CLI script already had.
# ---------------------------------------------------------------------------

@app.get("/api/admin/users")
@roles_required("admin")
def list_all_users():
    """A page of visible (non-deleted) user accounts, for the admin
    role-management panel. Bounded by pagination.DEFAULT_PAGE_SIZE
    unless ?limit=&offset= are passed - see list_reports() above for
    why. ?search= filters to users whose name or email contains it
    (case-insensitive) - powers the Access Level panel's search bar."""
    limit, offset = parse_pagination_args()
    search = (request.args.get("search") or "").strip() or None
    users, total = get_all_users(limit=limit, offset=offset, search=search)
    return paginated_json_response([u.to_public_dict() for u in users], total, limit, offset)


@app.post("/api/admin/users/roles")
@roles_required("admin")
def update_user_roles():
    """
    Body: { "changes": [ { "user_id": 12, "role": "publisher" }, ... ] }
    Applies a batch of role changes in one request - the admin panel
    stages multiple dropdown edits client-side and sends them all at
    once on "Confirm", rather than one request per row.

    Validates every change BEFORE applying any of them, so a single bad
    entry (unknown user, invalid role) can't leave the batch half-applied.
    """
    body = request.get_json(silent=True) or {}
    changes = body.get("changes")
    if not isinstance(changes, list) or not changes:
        abort(400, description="'changes' must be a non-empty list of {user_id, role}")

    admin_user = get_current_user()
    resolved = []  # [(target_user, new_role), ...]
    for change in changes:
        user_id = change.get("user_id")
        role = (change.get("role") or "").strip().lower()
        if not isinstance(user_id, int):
            abort(400, description=f"Invalid user_id: {change.get('user_id')!r}")
        if role not in VALID_ROLES:
            abort(400, description=f"'{role}' is not a valid role. Choose from: {', '.join(sorted(VALID_ROLES))}")
        target = get_user(user_id)
        if target is None:
            abort(404, description=f"No user found with id {user_id}")
        resolved.append((target, role))

    updated = []
    for target, role in resolved:
        if target.role != role:
            old_role = target.role
            update_user(target.id, role=role)
            create_user_event(user_id=admin_user.id, document_id=None, action=CRUDAction.UPDATE)
            logger.info("admin_user_id=%s changed user_id=%s role: %s -> %s", admin_user.id, target.id, old_role, role)
        updated.append(get_user(target.id))

    return jsonify([u.to_public_dict() for u in updated])


# ---------------------------------------------------------------------------
# Globe data (GTBI/ETTI workbook uploads) - publisher/admin only. Wires
# together the pipeline already in server/data_scripts/ (etti_extract.py,
# gtbi_extract.py) and server/globe_data.py, so uploading through the
# Publish > Update Globe Data page does exactly what running those CLI
# scripts by hand would do, without anyone needing shell access.
# ---------------------------------------------------------------------------

@app.post("/api/globe-data/upload")
@roles_required("publisher", "admin")
@limiter.limit("20 per hour")
def upload_globe_data():
    """
    Body: multipart/form-data with:
      kind = "ETTI" | "GTBI"
      file = the replacement workbook (.xlsx - see globe_data.py's module
             docstring for why this has to be a multi-sheet workbook, not
             a flat CSV)

    Steps (each one backed by server/globe_data.py):
      1. Validate the upload actually extracts cleanly as `kind`, using
         the exact same extraction code data_scripts/{kind}_extract.py
         runs from the command line. Nothing on disk changes if this
         fails.
      2. Archive the raw upload into data_scripts/{kind}_storage/
         (timestamped) as a permanent record of every upload made.
      3. Rotate data_scripts/{kind_lower}_source/: whatever workbook is
         currently there moves into that folder's old/ subfolder
         (timestamped), and the new upload takes its place - so anyone
         re-running the CLI script by hand afterward reads the same file
         this endpoint just applied.
      4. Write the validated extraction to
         data_scripts/{kind_lower}_country_data.json, the same file the
         CLI script's own -o flag would produce.
      5. Merge that extraction into server/data/country_data.json -
         the file GET /api/countries actually serves - touching only
         this kind's section per country. A GTBI upload never touches
         ETTI data and vice versa.
    """
    kind = (request.form.get("kind") or "").strip().upper()
    if kind not in globe_data.VALID_KINDS:
        abort(400, description=f"'kind' must be one of {', '.join(globe_data.VALID_KINDS)}")

    upload = request.files.get("file")
    if upload is None or upload.filename == "":
        abort(400, description="Missing 'file' in request body")

    original_filename = secure_filename(upload.filename)
    if not original_filename:
        abort(400, description="Invalid filename")

    ext = os.path.splitext(original_filename)[1].lower()
    if ext not in ALLOWED_GLOBE_DATA_EXTENSIONS:
        abort(400, description=f"Only {', '.join(sorted(ALLOWED_GLOBE_DATA_EXTENSIONS))} workbooks are accepted")

    # Nothing under data_scripts/ is touched until the workbook is proven
    # to extract cleanly - it's saved to a scratch temp file first.
    tmp_dir = os.path.join(globe_data.DATA_SCRIPTS_DIR, "_uploads_tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=ext, dir=tmp_dir)
    os.close(tmp_fd)
    upload.save(tmp_path)

    size = os.path.getsize(tmp_path)
    if size > MAX_GLOBE_DATA_UPLOAD_BYTES:
        os.remove(tmp_path)
        abort(400, description=f"File exceeds the {MAX_GLOBE_DATA_UPLOAD_BYTES // (1024 * 1024)}MB limit")

    try:
        extracted = globe_data.validate_workbook(kind, tmp_path)
    except globe_data.WorkbookValidationError as e:
        os.remove(tmp_path)
        abort(400, description=str(e))

    # Archive a copy for history, then move the validated file itself into
    # the CLI-facing source folder (rotating whatever was there into old/).
    globe_data.archive_workbook(kind, tmp_path, original_filename)
    globe_data.rotate_source_file(kind, tmp_path, original_filename)
    globe_data.sync_cached_extraction(kind, extracted)
    result = globe_data.apply_workbook_to_country_data(kind, extracted)
    # This just wrote server/data/country_data.json on disk - drop the
    # in-memory cache so the next /api/countries* request re-reads it
    # instead of serving the pre-upload snapshot for the rest of this
    # worker's life.
    _invalidate_json_cache(COUNTRY_DATA_PATH)

    user = get_current_user()
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.UPDATE)
    logger.info(
        "globe data upload kind=%s user_id=%s countries_updated=%d unresolved=%d",
        kind, user.id, len(result["updated_codes"]), len(result["unresolved_country_names"]),
    )

    return jsonify({
        "kind": kind,
        "countries_updated": result["updated_codes"],
        "unresolved_country_names": result["unresolved_country_names"],
        "total_countries_in_file": result["total_countries_in_file"],
    })


# ---------------------------------------------------------------------------
# Country profile documents (the two source .docx files
# data_scripts/country_profiles.extract.py builds country_profiles.json
# from) - admin only, unlike globe-data uploads above which publishers
# can also do. Wires together country_profiles_upload.py the same way
# the globe-data route above wires together globe_data.py.
# ---------------------------------------------------------------------------

@app.post("/api/country-profiles/upload")
@roles_required("admin")
@limiter.limit("20 per hour")
def upload_country_profile_docx():
    """
    Body: multipart/form-data with:
      kind = "survey" | "dashboard" (see country_profiles_upload.py's
             module docstring for what each one is)
      file = the replacement document (.docx)

    Steps (each one backed by server/country_profiles_upload.py):
      1. Validate the upload actually parses as at least one country
         entry for `kind`, using the exact same parsing code
         data_scripts/country_profiles.extract.py runs from the
         command line. Nothing on disk changes if this fails.
      2. Archive the raw upload into
         data_scripts/country_profiles_storage/ (timestamped) as a
         permanent record of every upload made.
      3. Rotate data_scripts/country_profiles_source/: whatever
         document currently has this kind's canonical filename moves
         into that folder's old/ subfolder (timestamped), and the new
         upload takes its place under that same canonical name - so
         anyone re-running the CLI script by hand afterward reads the
         same file this endpoint just applied. The other kind's source
         document (not part of this upload) is left untouched.
      4. Re-run country_profiles.extract.py's own profile-building
         logic against both canonical source documents together and
         overwrite server/data/country_profiles.json - the file
         GET /api/country-profiles actually serves.
    """
    kind = (request.form.get("kind") or "").strip().lower()
    if kind not in country_profiles_upload.VALID_KINDS:
        abort(400, description=f"'kind' must be one of {', '.join(sorted(country_profiles_upload.VALID_KINDS))}")

    upload = request.files.get("file")
    if upload is None or upload.filename == "":
        abort(400, description="Missing 'file' in request body")

    original_filename = secure_filename(upload.filename)
    if not original_filename:
        abort(400, description="Invalid filename")

    ext = os.path.splitext(original_filename)[1].lower()
    if ext not in ALLOWED_COUNTRY_PROFILE_EXTENSIONS:
        abort(400, description=f"Only {', '.join(sorted(ALLOWED_COUNTRY_PROFILE_EXTENSIONS))} documents are accepted")

    # Nothing under data_scripts/ is touched until the document is proven
    # to parse cleanly - it's saved to a scratch temp file first.
    tmp_dir = os.path.join(country_profiles_upload.DATA_SCRIPTS_DIR, "_uploads_tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=ext, dir=tmp_dir)
    os.close(tmp_fd)
    upload.save(tmp_path)

    size = os.path.getsize(tmp_path)
    if size > MAX_COUNTRY_PROFILE_UPLOAD_BYTES:
        os.remove(tmp_path)
        abort(400, description=f"File exceeds the {MAX_COUNTRY_PROFILE_UPLOAD_BYTES // (1024 * 1024)}MB limit")

    try:
        country_profiles_upload.validate_docx(kind, tmp_path)
    except country_profiles_upload.DocxValidationError as e:
        os.remove(tmp_path)
        abort(400, description=str(e))

    # Archive a copy for history, then move the validated file itself into
    # the CLI-facing source folder (rotating whatever was there into old/).
    country_profiles_upload.archive_docx(kind, tmp_path, original_filename)
    country_profiles_upload.rotate_source_docx(kind, tmp_path, original_filename)

    try:
        result = country_profiles_upload.regenerate_profiles()
    except FileNotFoundError as e:
        # Only reachable on a brand-new deploy where the OTHER kind has
        # never been uploaded (or placed by hand) at all yet - this
        # kind's file is already installed above and will regenerate
        # cleanly once the other one arrives.
        abort(400, description=str(e))

    # This just wrote server/data/country_profiles.json on disk - drop
    # the in-memory cache so the next /api/country-profiles* request
    # re-reads it instead of serving the pre-upload snapshot for the
    # rest of this worker's life.
    _invalidate_json_cache(COUNTRY_PROFILES_PATH)

    user = get_current_user()
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.UPDATE)
    logger.info(
        "country profile docx upload kind=%s user_id=%s profile_count=%d with_dashboard_note=%d skipped=%d",
        kind, user.id, result["profile_count"], result["with_dashboard_note_count"], len(result["skipped"]),
    )

    return jsonify({
        "kind": kind,
        "profile_count": result["profile_count"],
        "with_dashboard_note_count": result["with_dashboard_note_count"],
        "skipped": result["skipped"],
    })


# ---------------------------------------------------------------------------
# Version history + restore, for both upload types above. Admin-only -
# unlike the uploads themselves (globe-data uploads are also open to
# publishers via /publish/globe-data), picking an old version back into
# place from the Control panel's dropdown is an admin-only action.
# ---------------------------------------------------------------------------

@app.get("/api/globe-data/uploads")
@roles_required("admin")
def list_globe_data_uploads():
    """
    Every archived GTBI/ETTI workbook upload, newest first - powers the
    Control panel's "restore a previous version" dropdown. Optional
    ?kind=GTBI|ETTI filters to one kind (the dropdown only ever shows
    one kind at a time, matching whichever upload section it's under).
    """
    kind = (request.args.get("kind") or "").strip().upper()
    uploads = globe_data.list_uploads()
    if kind:
        if kind not in globe_data.VALID_KINDS:
            abort(400, description=f"'kind' must be one of {', '.join(globe_data.VALID_KINDS)}")
        uploads = [u for u in uploads if u["kind"] == kind]
    return jsonify(uploads)


@app.post("/api/globe-data/restore")
@roles_required("admin")
@limiter.limit("20 per hour")
def restore_globe_data():
    """
    Body: { "kind": "ETTI"|"GTBI", "filename": "<one of the filenames
    GET /api/globe-data/uploads just listed for this kind>" }

    Re-applies that archived workbook as the current canonical version
    - same validate/archive/rotate/merge pipeline as a fresh upload
    (globe_data.restore_upload()), just sourced from the archive
    instead of a new file on the wire.
    """
    body = request.get_json(silent=True) or {}
    kind = (body.get("kind") or "").strip().upper()
    filename = body.get("filename")
    if kind not in globe_data.VALID_KINDS:
        abort(400, description=f"'kind' must be one of {', '.join(globe_data.VALID_KINDS)}")
    if not filename:
        abort(400, description="'filename' is required")

    try:
        result = globe_data.restore_upload(kind, filename)
    except FileNotFoundError as e:
        abort(404, description=str(e))
    except globe_data.WorkbookValidationError as e:
        abort(400, description=str(e))

    _invalidate_json_cache(COUNTRY_DATA_PATH)

    user = get_current_user()
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.UPDATE)
    logger.info(
        "globe data restore kind=%s user_id=%s filename=%s countries_updated=%d",
        kind, user.id, filename, len(result["updated_codes"]),
    )

    return jsonify({
        "kind": kind,
        "countries_updated": result["updated_codes"],
        "unresolved_country_names": result["unresolved_country_names"],
        "total_countries_in_file": result["total_countries_in_file"],
    })


@app.get("/api/country-profiles/uploads")
@roles_required("admin")
def list_country_profile_uploads():
    """
    Every archived country-profile docx upload, newest first - powers
    the Control panel's "restore a previous version" dropdown. Optional
    ?kind=survey|dashboard filters to one kind.
    """
    kind = (request.args.get("kind") or "").strip().lower()
    uploads = country_profiles_upload.list_uploads()
    if kind:
        if kind not in country_profiles_upload.VALID_KINDS:
            abort(400, description=f"'kind' must be one of {', '.join(sorted(country_profiles_upload.VALID_KINDS))}")
        uploads = [u for u in uploads if u["kind"] == kind]
    return jsonify(uploads)


@app.post("/api/country-profiles/restore")
@roles_required("admin")
@limiter.limit("20 per hour")
def restore_country_profile_docx():
    """
    Body: { "kind": "survey"|"dashboard", "filename": "<one of the
    filenames GET /api/country-profiles/uploads just listed for this
    kind>" }

    Re-applies that archived document as the current canonical version
    - same validate/archive/rotate/regenerate pipeline as a fresh
    upload (country_profiles_upload.restore_docx()), just sourced from
    the archive instead of a new file on the wire.
    """
    body = request.get_json(silent=True) or {}
    kind = (body.get("kind") or "").strip().lower()
    filename = body.get("filename")
    if kind not in country_profiles_upload.VALID_KINDS:
        abort(400, description=f"'kind' must be one of {', '.join(sorted(country_profiles_upload.VALID_KINDS))}")
    if not filename:
        abort(400, description="'filename' is required")

    try:
        result = country_profiles_upload.restore_docx(kind, filename)
    except FileNotFoundError as e:
        abort(404, description=str(e))
    except country_profiles_upload.DocxValidationError as e:
        abort(400, description=str(e))

    _invalidate_json_cache(COUNTRY_PROFILES_PATH)

    user = get_current_user()
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.UPDATE)
    logger.info(
        "country profile docx restore kind=%s user_id=%s filename=%s profile_count=%d",
        kind, user.id, filename, result["profile_count"],
    )

    return jsonify({
        "kind": kind,
        "profile_count": result["profile_count"],
        "with_dashboard_note_count": result["with_dashboard_note_count"],
        "skipped": result["skipped"],
    })


# ---------------------------------------------------------------------------
# Fellows (the Fellowship page's roster). Reads are public; writes are
# admin only, via the Control panel's "Fellows" section.
# ---------------------------------------------------------------------------

def _save_fellow_photo(upload):
    """
    Shared by create/update below: validates the upload's extension and
    size, normalizes it through image_processing.normalize_photo() (see
    that module for what "normalize" means - always a fixed-size JPEG
    regardless of the source format), and saves the *normalized* bytes
    via fellow_storage. Returns the storage path. Raises a Werkzeug
    HTTPException (via abort()) on any validation failure, so callers
    can just call this and trust they get a valid path back.
    """
    original_filename = secure_filename(upload.filename or "")
    ext = os.path.splitext(original_filename)[1].lower()
    if ext not in ALLOWED_FELLOW_PHOTO_EXTENSIONS:
        abort(400, description=f"Photo must be one of {', '.join(sorted(ALLOWED_FELLOW_PHOTO_EXTENSIONS))}")

    upload.stream.seek(0, os.SEEK_END)
    size = upload.stream.tell()
    upload.stream.seek(0)
    if size > MAX_FELLOW_PHOTO_UPLOAD_BYTES:
        abort(400, description=f"Photo exceeds the {MAX_FELLOW_PHOTO_UPLOAD_BYTES // (1024 * 1024)}MB limit")

    try:
        normalized_bytes, mimetype = image_processing.normalize_photo(upload.stream)
    except image_processing.UnsupportedImageError as e:
        abort(400, description=str(e))

    # normalize_photo() always produces a JPEG, so the file handed to
    # storage is wrapped fresh here rather than reusing `upload` (which
    # is still whatever format/bytes was originally uploaded).
    normalized_file = FileStorage(
        stream=io.BytesIO(normalized_bytes), filename="photo.jpg", content_type=mimetype,
    )
    photo_path, _size_bytes = fellow_storage.save("fellows", normalized_file.filename, normalized_file)
    return photo_path


@app.get("/api/fellows")
def list_fellows():
    """Public roster for the Fellowship page - replaces the old hardcoded FELLOWS array in fellowship.js."""
    fellows = get_all_fellows()
    return jsonify([f.to_public_dict() for f in fellows])


@app.get("/api/fellows/<int:fellow_id>/photo")
def get_fellow_photo(fellow_id):
    """Serves a fellow's normalized photo. All fellow photos are JPEGs - see image_processing.py."""
    fellow = get_fellow(fellow_id)
    if fellow is None or not fellow.photo_path:
        abort(404, description="No photo for this fellow")
    return fellow_storage.get_file_response(fellow.photo_path, download_name=f"{fellow.id}.jpg", mimetype="image/jpeg")


@app.post("/api/fellows")
@roles_required("admin")
def create_fellow_route():
    """
    Body: multipart/form-data with name, level (one of
    models.fellow.FELLOW_LEVEL_CODES), bio, and an optional photo file.
    """
    name = (request.form.get("name") or "").strip()
    level = (request.form.get("level") or "").strip().upper()
    bio = request.form.get("bio") or ""

    if not name:
        abort(400, description="'name' is required")
    if level not in FELLOW_LEVEL_CODES:
        abort(400, description=f"'level' must be one of {', '.join(FELLOW_LEVEL_CODES)}")

    photo_path = None
    photo = request.files.get("photo")
    if photo is not None and photo.filename:
        photo_path = _save_fellow_photo(photo)

    fellow = create_fellow(name=name, level=level, bio=bio, photo_path=photo_path)

    user = get_current_user()
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.CREATE)
    logger.info("fellow created id=%s name=%r level=%s user_id=%s", fellow.id, fellow.name, fellow.level, user.id)

    return jsonify(fellow.to_public_dict()), 201


@app.put("/api/fellows/<int:fellow_id>")
@roles_required("admin")
def update_fellow_route(fellow_id):
    """
    Body: multipart/form-data. name/level/bio are optional - omit a
    field to leave it unchanged. A new photo file replaces the current
    one; remove_photo=true (with no photo file) clears it back to no
    photo instead.
    """
    if get_fellow(fellow_id) is None:
        abort(404, description=f"No fellow with id {fellow_id}")

    name = request.form.get("name")
    if name is not None:
        name = name.strip()
        if not name:
            abort(400, description="'name' cannot be blank")

    level = request.form.get("level")
    if level is not None:
        level = level.strip().upper()
        if level not in FELLOW_LEVEL_CODES:
            abort(400, description=f"'level' must be one of {', '.join(FELLOW_LEVEL_CODES)}")

    bio = request.form.get("bio")  # None = unchanged; "" is a valid intentional value

    photo_path = None  # None = unchanged, unless remove_photo below overrides it
    photo = request.files.get("photo")
    if photo is not None and photo.filename:
        photo_path = _save_fellow_photo(photo)
    elif (request.form.get("remove_photo") or "").strip().lower() in ("1", "true", "yes"):
        photo_path = False  # see update_fellow()'s docstring for this sentinel

    fellow = update_fellow(fellow_id, name=name, level=level, bio=bio, photo_path=photo_path)

    user = get_current_user()
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.UPDATE)
    logger.info("fellow updated id=%s user_id=%s", fellow.id, user.id)

    return jsonify(fellow.to_public_dict())


@app.delete("/api/fellows/<int:fellow_id>")
@roles_required("admin")
def delete_fellow_route(fellow_id):
    fellow = get_fellow(fellow_id)
    if fellow is None:
        abort(404, description=f"No fellow with id {fellow_id}")

    if fellow.photo_path:
        fellow_storage.delete(fellow.photo_path)

    deleted = delete_fellow(fellow_id)

    user = get_current_user()
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.DELETE)
    logger.info("fellow deleted id=%s user_id=%s", fellow_id, user.id)

    return jsonify({"deleted": deleted})


# ---------------------------------------------------------------------------
# Documents (upload / list / delete), with CRUD events logged for each action
# ---------------------------------------------------------------------------

@app.post("/api/documents")
@roles_required("publisher", "admin")
def upload_document():
    """Uploads a file for the logged-in publisher and logs a CREATE event."""
    user = get_current_user()

    if "file" not in request.files:
        abort(400, description="No file part in request")
    file = request.files["file"]
    if file.filename == "":
        abort(400, description="No file selected")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        abort(400, description=f"File type '{ext or 'unknown'}' is not allowed")

    # Measure size without loading the whole file into memory.
    file.stream.seek(0, os.SEEK_END)
    size = file.stream.tell()
    file.stream.seek(0)
    if size > MAX_UPLOAD_BYTES:
        abort(400, description=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit")
    if size == 0:
        abort(400, description="File is empty")

    file_path, size_bytes = storage.save(user.id, file.filename, file)

    doc = create_document(
        user_id=user.id,
        filename=file.filename,
        file_path=file_path,
        mime_type=file.mimetype,
        size_bytes=size_bytes,
    )
    create_user_event(user_id=user.id, document_id=doc.id, action=CRUDAction.CREATE)

    return jsonify({
        "id": doc.id,
        "filename": doc.filename,
        "mime_type": doc.mime_type,
        "size_bytes": doc.size_bytes,
    }), 201


@app.get("/api/documents")
@login_required
def list_documents():
    """Lists the logged-in user's documents and logs a READ event."""
    user = get_current_user()
    docs = get_documents_by_user(user.id)
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.READ)
    return jsonify([
        {
            "id": d.id,
            "filename": d.filename,
            "mime_type": d.mime_type,
            "size_bytes": d.size_bytes,
            "created_at": d.created_at.isoformat(),
        }
        for d in docs
    ])


@app.delete("/api/documents/<int:document_id>")
@roles_required("publisher", "admin")
def remove_document(document_id):
    """
    Soft-deletes a document owned by the logged-in publisher: flips
    status to 0 (hidden) rather than removing the file or DB row.
    Logs a DELETE event. For permanent removal see
    DELETE /api/documents/<id>/permanent (admin-only).
    """
    user = get_current_user()
    doc = get_document(document_id)
    if doc is None or doc.user_id != user.id or doc.status == 0:
        abort(404, description="Document not found")

    delete_document(document_id)
    create_user_event(user_id=user.id, document_id=document_id, action=CRUDAction.DELETE)

    return jsonify({"status": "deleted", "id": document_id})


@app.delete("/api/documents/<int:document_id>/permanent")
@roles_required("admin")
def remove_document_permanently(document_id):
    """
    Admin-only. Permanently deletes a document: removes the DB row (and,
    via cascade, its events) AND the underlying file/object. This is
    the route that finally wires up models/document.py's
    hard_delete_document, previously unused - see remaining_work.docx.
    """
    doc = get_document(document_id)
    if doc is None:
        abort(404, description="Document not found")

    storage.delete(doc.file_path)
    hard_delete_document(document_id)

    logger.warning("hard delete document_id=%s by admin_id=%s", document_id, get_current_user().id)
    return jsonify({"status": "permanently deleted", "id": document_id})


# ---------------------------------------------------------------------------
# Reports (public content: title, description, a PDF/DOCX, an optional
# cover image) with a peer-review workflow gating what's public.
#
#   pending_review --(3 distinct approvals, not from the uploader)--> published
#   pending_review --(any single reject, with a required comment)--> changes_requested
#   changes_requested --(uploader resubmits)--> pending_review, version += 1
#
# Only PUBLISHED reports are visible to the general public. pending_review
# and changes_requested reports are only visible to their own uploader or
# to a publisher/admin (the reviewer pool) - see _can_view_report below.
# ---------------------------------------------------------------------------

def _can_view_report(report, user):
    """
    True if `user` (may be None, i.e. a guest) is allowed to see this
    report at all. Published+visible reports are public - so are
    deletion_requested reports (see REVIEW_STATUS_DELETION_REQUESTED's
    own comment in models/report.py: a report stays visible on the
    public Reports page throughout its deletion review, so it's public
    the same way a published report is). Anything else (pending_review,
    changes_requested, rejected, or soft-deleted) is only visible to
    the report's own uploader or to a publisher/reviewer/admin - i.e.
    the same pool of people who can act on it.
    """
    if report.status != 1:
        return user is not None and (user.role == ROLE_ADMIN)
    if report.review_status in ("published", "deletion_requested"):
        return True
    if user is None:
        return False
    return user.id == report.uploaded_by or user.role in (ROLE_PUBLISHER, ROLE_REVIEWER, ROLE_ADMIN)


@app.get("/api/reports")
def list_reports():
    """
    A page of PUBLISHED, visible reports, newest first. Public - no
    login required. Bounded by pagination.DEFAULT_PAGE_SIZE unless
    ?limit=&offset= are passed (see pagination.py) - this used to load
    every published report on every request with no cap, which grows
    unbounded with site content. The response body is still a plain
    array so existing clients are unaffected; total count is in the
    X-Total-Count header for any client that wants to page further.
    """
    limit, offset = parse_pagination_args()
    reports, total = get_published_reports(limit=limit, offset=offset)
    return paginated_json_response(reports_to_public_dicts(reports), total, limit, offset)


@app.get("/api/reports/search")
@limiter.limit("60 per minute")
def search_reports_route():
    """
    ?q=<query> - public, no login required. Backs the sitewide search
    bar (see SearchBar.jsx) - a small, fixed-size preview of matching
    PUBLISHED reports (title or description), not a paginated browse.
    Returns [] for a blank/missing query rather than 400ing, so a
    frontend that fires this on every keystroke doesn't need special-
    case handling for an empty search box.
    """
    query_text = (request.args.get("q") or "").strip()
    if not query_text:
        return jsonify([])
    reports = search_published_reports(query_text, limit=5)
    return jsonify(reports_to_public_dicts(reports))


@app.get("/api/reports/pending")
@roles_required("publisher", "reviewer", "admin")
def list_pending_reports_route():
    """Reports awaiting review, oldest first. Peer Review page - publisher/admin only."""
    limit, offset = parse_pagination_args()
    reports, total = get_pending_reports(limit=limit, offset=offset)
    return paginated_json_response(reports_to_public_dicts(reports), total, limit, offset)


@app.get("/api/reports/changes-requested")
@roles_required("publisher", "reviewer", "admin")
def list_changes_requested_reports_route():
    """
    Reports sent back to their uploader for changes, most recently
    updated first. Shown in a separate section of the Peer Review page
    per product decision - visible to reviewers, but not part of
    anyone's active review queue until the uploader resubmits.
    """
    limit, offset = parse_pagination_args()
    reports, total = get_changes_requested_reports(limit=limit, offset=offset)
    return paginated_json_response(reports_to_public_dicts(reports), total, limit, offset)


@app.get("/api/reports/all")
@roles_required("admin")
def list_all_reports_route():
    """
    Every report regardless of review_status (pending, changes_requested,
    published, or rejected) or hidden status, newest first. Admin-only -
    unlike every other /api/reports/* list route, which is scoped to
    one review stage for a specific page of the site, this backs the
    Control tab's "recategorize an existing report" tool (see
    ReportCategoryControl.jsx), where an admin needs to find any report
    regardless of what stage it's in.

    Query params:
      - "search": optional, case-insensitive substring match on title
      - "category": optional, exact match - one of REPORT_CATEGORIES
      - "limit"/"offset": standard pagination (see pagination.py)
    """
    search = (request.args.get("search") or "").strip() or None
    category = (request.args.get("category") or "").strip() or None
    limit, offset = parse_pagination_args()
    reports, total = get_all_reports(search=search, category=category, limit=limit, offset=offset)
    return paginated_json_response(reports_to_public_dicts(reports), total, limit, offset)


@app.patch("/api/reports/<int:report_id>/category")
@roles_required("admin")
def update_report_category_route(report_id):
    """
    Body: { "category": "..." }
    Admin-only correction tool - updates ONLY the category, regardless
    of the report's review_status or version. Deliberately does not
    touch review_status, version, or send the report back through peer
    review (unlike resubmit_report(), which is a content change from
    the uploader) - recategorizing an already-published report is a
    metadata fix, not new content needing re-approval. Exists because
    every report uploaded before upload_report()'s category-handling
    fix silently landed in the default "National Trauma Assessment"
    category regardless of what the uploader actually selected - see
    that route's own history for the root cause. This is how those
    are corrected after the fact.
    """
    body = request.get_json(silent=True) or {}
    category = (body.get("category") or "").strip()

    error = validation.run_check("report_category", category)
    if error:
        abort(400, description=error)

    report = set_report_category(report_id, category)
    if report is None:
        abort(404, description="Report not found")

    user = get_current_user()
    logger.info("report category updated id=%s to=%r by admin_user_id=%s", report_id, category, user.id)

    return jsonify(report.to_public_dict())


@app.get("/api/reports/<int:report_id>")
def get_report_route(report_id):
    """A single report's metadata. Public only once published; otherwise
    restricted to the uploader or a publisher/admin - see _can_view_report."""
    report = get_report(report_id)
    if report is None:
        abort(404, description="Report not found")
    user = get_current_user()
    if not _can_view_report(report, user):
        abort(404, description="Report not found")
    return jsonify(report.to_public_dict())


@app.get("/api/reports/<int:report_id>/file")
def download_report_file(report_id):
    """Streams/redirects to the report's actual PDF/DOCX. Same visibility rule as get_report_route."""
    report = get_report(report_id)
    if report is None:
        abort(404, description="Report not found")
    user = get_current_user()
    if not _can_view_report(report, user):
        abort(404, description="Report not found")
    return report_storage.get_file_response(report.file_path, download_name=report.original_filename)


@app.get("/api/reports/<int:report_id>/image")
def get_report_image(report_id):
    """Streams/redirects to the report's cover image, if one was provided. Same visibility rule as get_report_route."""
    report = get_report(report_id)
    if report is None or report.image_path is None:
        abort(404, description="No image for this report")
    user = get_current_user()
    if not _can_view_report(report, user):
        abort(404, description="No image for this report")
    return report_storage.get_file_response(
        report.image_path, download_name=f"report-{report.id}-cover", mimetype=report.image_mime_type
    )


def _save_report_upload(user_id, file, image):
    """
    Shared file-handling logic for both a first upload and a
    resubmission: validates extensions/sizes, saves via report_storage,
    and cleans up the report file if the image is rejected afterward.
    Returns (file_path, file_type, file_size_bytes, original_filename,
    image_path, image_mime_type) - image fields are None if no image
    was provided.
    """
    if file is None or file.filename == "":
        abort(400, description="No file selected")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_REPORT_FILE_EXTENSIONS:
        abort(400, description="Reports must be a PDF or Word document (.pdf, .doc, .docx)")

    file.stream.seek(0, os.SEEK_END)
    size = file.stream.tell()
    file.stream.seek(0)
    if size > MAX_UPLOAD_BYTES:
        abort(400, description=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit")
    if size == 0:
        abort(400, description="File is empty")

    image_ext = None
    image_size = 0
    if image is not None and image.filename != "":
        image_ext = os.path.splitext(image.filename)[1].lower()
        if image_ext not in ALLOWED_REPORT_IMAGE_EXTENSIONS:
            abort(400, description="Cover image must be a PNG, JPG, or WEBP file")

        image.stream.seek(0, os.SEEK_END)
        image_size = image.stream.tell()
        image.stream.seek(0)
        if image_size > MAX_REPORT_IMAGE_BYTES:
            abort(400, description=f"Cover image exceeds the {MAX_REPORT_IMAGE_BYTES // (1024 * 1024)}MB limit")

    # Checked before either file is written to storage, not after - no
    # point saving (and then immediately deleting) bytes for an upload
    # that's already known to be too big.
    if size + image_size > MAX_REPORT_COMBINED_BYTES:
        combined_mb = MAX_REPORT_COMBINED_BYTES / (1024 * 1024)
        abort(
            400,
            description=(
                f"Report file and cover image together must be under {combined_mb:.1f}MB "
                f"(currently {(size + image_size) / (1024 * 1024):.1f}MB combined)."
            ),
        )

    file_path, file_size_bytes = report_storage.save(user_id, file.filename, file)
    file_type = ext.lstrip(".")

    image_path = None
    image_mime_type = None
    if image is not None and image.filename != "":
        # Verify the upload is genuinely a readable image, not just a
        # file with an allowed extension - an attacker can freely set
        # the extension and the browser-reported Content-Type
        # (image.mimetype below) to anything they like, and the latter
        # is what image_mime_type ends up serving back verbatim in
        # get_report_image's response headers. For the local storage
        # backend that's caught by this app's own X-Content-Type-Options:
        # nosniff (set in after_request), but the S3 backend - required
        # in production, see the startup check above - serves the file
        # via a redirect straight to a presigned S3 URL, entirely
        # outside this app's own response headers, so nosniff never
        # applies there. Confirming Pillow can actually decode it here
        # closes that gap regardless of storage backend, by rejecting
        # non-image content (e.g. HTML/SVG-with-script renamed to
        # .png) before it's ever stored or served at all.
        try:
            Image.open(image.stream).verify()
        except Exception:
            report_storage.delete(file_path)
            abort(400, description="Cover image could not be read as a valid image file")
        image.stream.seek(0)

        image_path, _ = report_storage.save(user_id, image.filename, image)
        image_mime_type = image.mimetype

    return file_path, file_type, file_size_bytes, file.filename, image_path, image_mime_type


def _save_report_edit_uploads(user_id, existing_file_size_bytes, file, image):
    """
    Like _save_report_upload above, but both `file` and `image` are
    optional - used by the "edit while pending_review" flow (POST
    /api/reports/<id>/edit), where a publisher may be changing only
    the text fields, only the cover image, only the report file, or
    any combination, unlike a first upload or a changes_requested
    resubmission, both of which always bring a new file.

    Returns a dict of resubmit_report() kwargs covering only whatever
    was actually replaced - e.g. {} if neither file nor image was
    given, or just {"image_path": ..., "image_mime_type": ...} if only
    the image changed. resubmit_report() leaves any field not present
    in this dict untouched, so the caller can pass it straight through
    as **kwargs.

    Combined-size validation (MAX_REPORT_COMBINED_BYTES) is checked
    against whichever of file/image are actually being replaced,
    using existing_file_size_bytes as the file side of that check when
    the file itself isn't being replaced - so swapping in a large
    cover image on a report that already has a large file is still
    caught, without re-validating a file that isn't changing.
    """
    has_new_file = file is not None and file.filename != ""
    has_new_image = image is not None and image.filename != ""

    result = {}
    new_file_size = existing_file_size_bytes or 0
    new_image_size = 0
    ext = None

    if has_new_file:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_REPORT_FILE_EXTENSIONS:
            abort(400, description="Reports must be a PDF or Word document (.pdf, .doc, .docx)")
        file.stream.seek(0, os.SEEK_END)
        new_file_size = file.stream.tell()
        file.stream.seek(0)
        if new_file_size > MAX_UPLOAD_BYTES:
            abort(400, description=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit")
        if new_file_size == 0:
            abort(400, description="File is empty")

    if has_new_image:
        image_ext = os.path.splitext(image.filename)[1].lower()
        if image_ext not in ALLOWED_REPORT_IMAGE_EXTENSIONS:
            abort(400, description="Cover image must be a PNG, JPG, or WEBP file")
        image.stream.seek(0, os.SEEK_END)
        new_image_size = image.stream.tell()
        image.stream.seek(0)
        if new_image_size > MAX_REPORT_IMAGE_BYTES:
            abort(400, description=f"Cover image exceeds the {MAX_REPORT_IMAGE_BYTES // (1024 * 1024)}MB limit")

    if new_file_size + new_image_size > MAX_REPORT_COMBINED_BYTES:
        combined_mb = MAX_REPORT_COMBINED_BYTES / (1024 * 1024)
        abort(
            400,
            description=(
                f"Report file and cover image together must be under {combined_mb:.1f}MB "
                f"(currently {(new_file_size + new_image_size) / (1024 * 1024):.1f}MB combined)."
            ),
        )

    if has_new_file:
        file_path, file_size_bytes = report_storage.save(user_id, file.filename, file)
        result["file_path"] = file_path
        result["file_type"] = ext.lstrip(".")
        result["file_size_bytes"] = file_size_bytes
        result["original_filename"] = file.filename

    if has_new_image:
        try:
            Image.open(image.stream).verify()
        except Exception:
            if has_new_file:
                report_storage.delete(result["file_path"])
            abort(400, description="Cover image could not be read as a valid image file")
        image.stream.seek(0)

        image_path, _ = report_storage.save(user_id, image.filename, image)
        result["image_path"] = image_path
        result["image_mime_type"] = image.mimetype

    return result


@app.post("/api/reports")
@roles_required("publisher", "reviewer", "admin")
@limiter.limit("20 per hour")
def upload_report():
    """
    Multipart form fields:
      - "title": string, required
      - "description": string, required
      - "file": the report itself, .pdf/.doc/.docx, required
      - "image": an optional cover image (.png/.jpg/.jpeg/.webp)

    Lands as review_status=pending_review - it appears on the Peer
    Review page, not the public Reports page, until it clears review.
    """
    user = get_current_user()

    title = (request.form.get("title") or "").strip()
    description = (request.form.get("description") or "").strip()
    category = (request.form.get("category") or "").strip()

    error = validation.validate_all([
        ("report_title", title),
        ("report_description", description),
        ("report_category", category),
    ])
    if error:
        abort(400, description=error)

    if "file" not in request.files:
        abort(400, description="No file part in request")

    file_path, file_type, file_size_bytes, original_filename, image_path, image_mime_type = (
        _save_report_upload(user.id, request.files["file"], request.files.get("image"))
    )

    report = create_report(
        uploaded_by=user.id,
        title=title,
        description=description,
        category=category,
        file_path=file_path,
        file_type=file_type,
        original_filename=original_filename,
        file_size_bytes=file_size_bytes,
        image_path=image_path,
        image_mime_type=image_mime_type,
    )
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.CREATE)
    logger.info("report uploaded id=%s by user_id=%s", report.id, user.id)

    return jsonify(report.to_public_dict()), 201


@app.post("/api/reports/<int:report_id>/resubmit")
@login_required
@limiter.limit("20 per hour")
def resubmit_report_route(report_id):
    """
    Multipart form fields (title/description/resubmission_note
    optional; file required - a resubmission always brings a file,
    even if unchanged):
      - "title", "description": string
      - "resubmission_note": string, optional note to reviewers about
        what changed, addressing their rejection comment
      - "file": a new .pdf/.doc/.docx, required
      - "image": an optional new cover image

    Only usable by the report's own uploader, and only while it's in
    changes_requested. Deliberately gated on identity (report.uploaded_by
    == user.id, checked below) rather than @roles_required("publisher",
    "admin") - a report can only ever have been uploaded by a publisher
    or admin in the first place (see upload_report's own decorator),
    but role isn't permanent: an admin can demote a publisher back to
    basic (see manage_users.py) without touching their existing
    reports, and someone in that position still needs to be able to
    resubmit a report already stuck in changes_requested. Bumps
    version and resets to pending_review.
    """
    user = get_current_user()
    report = get_report(report_id)
    if report is None or report.uploaded_by != user.id:
        abort(404, description="Report not found")
    if report.review_status != "changes_requested":
        abort(400, description="This report isn't awaiting a resubmission.")

    title = request.form.get("title")
    description = request.form.get("description")
    resubmission_note = request.form.get("resubmission_note")

    if title is not None:
        error = validation.run_check("report_title", title.strip())
        if error:
            abort(400, description=error)
        title = title.strip()
    if description is not None:
        error = validation.run_check("report_description", description.strip())
        if error:
            abort(400, description=error)
        description = description.strip()
    if resubmission_note is not None:
        error = validation.run_check("resubmission_note", resubmission_note.strip())
        if error:
            abort(400, description=error)
        resubmission_note = resubmission_note.strip() or None

    if "file" not in request.files:
        abort(400, description="No file part in request")

    file_path, file_type, file_size_bytes, original_filename, image_path, image_mime_type = (
        _save_report_upload(user.id, request.files["file"], request.files.get("image"))
    )

    updated = resubmit_report(
        report_id,
        title=title,
        description=description,
        resubmission_note=resubmission_note,
        file_path=file_path,
        file_type=file_type,
        original_filename=original_filename,
        file_size_bytes=file_size_bytes,
        image_path=image_path,
        image_mime_type=image_mime_type,
    )
    logger.info("report resubmitted id=%s by user_id=%s new_version=%s", report_id, user.id, updated.version)

    return jsonify(updated.to_public_dict())


@app.post("/api/reports/<int:report_id>/edit")
@login_required
@limiter.limit("20 per hour")
def edit_report_route(report_id):
    """
    Multipart form fields:
      - "title", "description", "category": string, required - this
        route is meant to feel like resubmitting the same form used to
        publish the report in the first place, prefilled, not a
        partial patch, so all three are always sent.
      - "file": optional new .pdf/.doc/.docx - omit to keep the
        current file.
      - "image": optional new cover image - omit to keep the current
        one (or the lack of one).

    Only usable by the report's own uploader, and only while it's
    still pending_review - i.e. sitting in the peer review queue with
    no decision made yet. A report already in changes_requested has
    its own dedicated flow at POST /api/reports/<id>/resubmit (which
    also carries a note back to the reviewer who requested changes);
    a published, rejected, or deletion_requested report is past the
    point where "editing" like this makes sense.

    Like resubmit_report_route, this bumps version and resets
    review_status to pending_review - since approvals/rejections in
    report_review.py are scoped to `version`, that clears the current
    approve/reject vote count for the new version without touching the
    old version's review history. Category is applied via
    set_report_category() as a separate call, since resubmit_report()
    deliberately doesn't touch category (see its own docstring) - it's
    not a peer-reviewable content field anywhere else in this app, and
    keeping it out of resubmit_report() means this route is the only
    place category changes are tied to a version bump/review reset.
    """
    user = get_current_user()
    report = get_report(report_id)
    if report is None or report.uploaded_by != user.id:
        abort(404, description="Report not found")
    if report.review_status != REVIEW_STATUS_PENDING:
        abort(400, description="This report can only be edited while it's awaiting review.")

    title = (request.form.get("title") or "").strip()
    description = (request.form.get("description") or "").strip()
    category = (request.form.get("category") or "").strip()

    error = validation.validate_all([
        ("report_title", title),
        ("report_description", description),
        ("report_category", category),
    ])
    if error:
        abort(400, description=error)

    upload_fields = _save_report_edit_uploads(
        user.id, report.file_size_bytes, request.files.get("file"), request.files.get("image")
    )

    # resubmit_report() unconditionally overwrites resubmission_note
    # (unlike title/description, which it only touches if not None) -
    # pass the report's current value through rather than clearing it,
    # since a plain edit here shouldn't erase a genuine note left over
    # from an earlier changes_requested -> pending_review resubmission.
    resubmit_report(
        report_id, title=title, description=description,
        resubmission_note=report.resubmission_note, **upload_fields
    )
    updated = set_report_category(report_id, category)

    logger.info("report edited id=%s by user_id=%s new_version=%s", report_id, user.id, updated.version)

    return jsonify(updated.to_public_dict())


@app.post("/api/reports/<int:report_id>/review")
@roles_required("publisher", "reviewer", "admin")
@limiter.limit("60 per hour")
def review_report_route(report_id):
    """
    Body: { "decision": "approve" | "reject", "comment": "..." }
    comment is required when decision is "reject", optional otherwise.
    All the actual rules (can't review your own report, report must be
    pending_review, REQUIRED_APPROVALS-th approval publishes,
    REQUIRED_REJECTIONS-th reject removes it from review, an admin's
    decision is decisive on its own either way) are enforced in
    models/report_review.record_review() - this route just translates
    its ReviewError into a 400 and tells it whether this reviewer is
    an admin.
    """
    user = get_current_user()
    body = request.get_json(silent=True) or {}
    decision = (body.get("decision") or "").strip().lower()
    comment = (body.get("comment") or "").strip() or None

    if comment is not None:
        error = validation.run_check("review_comment", comment)
        if error:
            abort(400, description=error)

    try:
        updated_report = record_review(report_id, user.id, decision, comment, is_admin=(user.role == "admin"))
    except ReviewError as e:
        abort(400, description=str(e))

    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.UPDATE)
    logger.info("report review id=%s reviewer_id=%s decision=%s -> review_status=%s",
                report_id, user.id, decision, updated_report.review_status)

    return jsonify(updated_report.to_public_dict())


# ---------------------------------------------------------------------------
# Notifications (Profile page's Notifications tab). Currently only
# produced by models.report_review.record_review() - see its own
# docstring - but every route here is generic over `type`.
# ---------------------------------------------------------------------------

@app.get("/api/notifications")
@login_required
def list_notifications():
    """
    A page of the logged-in user's own notifications, newest first.
    Bounded by pagination.DEFAULT_PAGE_SIZE unless ?limit=&offset= are
    passed - see list_reports() earlier in this file for why.
    """
    user = get_current_user()
    limit, offset = parse_pagination_args()
    notifications, total = get_notifications_for_user(user.id, limit=limit, offset=offset)
    return paginated_json_response([n.to_public_dict() for n in notifications], total, limit, offset)


@app.get("/api/notifications/unread-count")
@login_required
def notifications_unread_count():
    """Just the count, for a badge - cheaper than fetching the full list to find out."""
    user = get_current_user()
    return jsonify({"unread_count": get_unread_count(user.id)})


@app.post("/api/notifications/<int:notification_id>/read")
@login_required
def mark_notification_read_route(notification_id):
    """Marks one notification read. Scoped to the logged-in user - mark_notification_read() 404s on anyone else's id."""
    user = get_current_user()
    notification = mark_notification_read(notification_id, user.id)
    if notification is None:
        abort(404, description="Notification not found")
    return jsonify(notification.to_public_dict())


@app.post("/api/notifications/read-all")
@login_required
def mark_all_notifications_read_route():
    """Marks every unread notification for the logged-in user read - e.g. an "Mark all as read" button."""
    user = get_current_user()
    updated = mark_all_read(user.id)
    return jsonify({"updated": updated})


@app.post("/api/notifications/read")
@login_required
def mark_selected_notifications_read_route():
    """
    Marks a client-selected set of notifications read - body:
    {"ids": [1, 2, 3]}. Backs the Notifications tab's checkbox
    selection + "Mark as read" action, as distinct from read-all above
    (everything) and the single-notification route (one, via a click).
    """
    user = get_current_user()
    body = request.get_json(silent=True) or {}
    ids = body.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        abort(400, description="ids must be a list of notification ids")
    updated = mark_notifications_read(ids, user.id)
    return jsonify({"updated": updated})


@app.post("/api/notifications/delete")
@login_required
def delete_selected_notifications_route():
    """
    Deletes a client-selected set of notifications - body:
    {"ids": [1, 2, 3]}. Backs the Notifications tab's checkbox
    selection + "Delete" action.
    """
    user = get_current_user()
    body = request.get_json(silent=True) or {}
    ids = body.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        abort(400, description="ids must be a list of notification ids")
    deleted = delete_notifications(ids, user.id)
    return jsonify({"deleted": deleted})


@app.get("/api/reports/<int:report_id>/reviews")
@roles_required("publisher", "reviewer", "admin")
def list_report_reviews_route(report_id):
    """All review decisions for a report (every version, newest first). Publisher/admin only."""
    report = get_report(report_id)
    if report is None:
        abort(404, description="Report not found")
    reviews = get_reviews_for_report(report_id)
    return jsonify(reviews_to_public_dicts(reviews))


@app.delete("/api/reports/<int:report_id>")
@roles_required("publisher", "reviewer", "admin")
def remove_report(report_id):
    """
    Soft-deletes a report: flips status to 0 (hidden) rather than
    removing the files or DB row. Admins may remove any report,
    instantly, same as always (deleted_via="admin" is recorded for the
    Deleted Reports page).

    Publishers/reviewers may only remove their own reports, and ONLY
    while still pending_review/changes_requested/rejected - i.e. a
    report that's never been public, so there's nothing for anyone
    else to weigh in on. A PUBLISHED report is a 409 here: use
    POST /api/reports/<id>/request-deletion instead, which starts the
    reviewer-approval watching period (see that route and
    request_report_deletion() in report.py) rather than deleting
    outright. This is the one behavior change from the old version of
    this route, which let a publisher instantly delete anything of
    their own, published or not.
    """
    user = get_current_user()
    report = get_report(report_id)
    if report is None or report.status == 0:
        abort(404, description="Report not found")
    if report.uploaded_by != user.id and user.role != ROLE_ADMIN:
        abort(404, description="Report not found")  # same as "not found" - don't reveal it exists but isn't theirs

    if user.role != ROLE_ADMIN and report.review_status == "published":
        abort(409, description=(
            "This report is already published - request its deletion instead, which needs a reviewer's approval."
        ))

    delete_report(report_id, via=("admin" if user.role == ROLE_ADMIN else None))
    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.DELETE)
    return jsonify({"status": "deleted", "id": report_id})


@app.post("/api/reports/<int:report_id>/request-deletion")
@roles_required("publisher", "admin")
@limiter.limit("30 per hour")
def request_report_deletion_route(report_id):
    """
    Body: { "reason": "..." }
    A publisher asking to delete their own PUBLISHED report. Unlike the
    instant DELETE above, this starts a watching period: the report
    stays visible on the public Reports page (see
    REVIEW_STATUS_DELETION_REQUESTED's own comment in report.py) until
    a reviewer/admin decides via POST .../deletion-review below. An
    admin CAN call this too (e.g. to formally document a reason before
    still deciding it themselves as the reviewer), but has no real need
    to - the plain instant DELETE above already skips this entirely for
    admins.
    """
    user = get_current_user()
    report = get_report(report_id)
    if report is None or report.status == 0:
        abort(404, description="Report not found")
    if report.uploaded_by != user.id and user.role != ROLE_ADMIN:
        abort(404, description="Report not found")

    body = request.get_json(silent=True) or {}
    reason = (body.get("reason") or "").strip()

    error = validation.run_check("deletion_reason", reason)
    if error:
        abort(400, description=error)

    try:
        updated = request_report_deletion(report_id, reason)
    except ValueError as e:
        abort(400, description=str(e))

    logger.info("report deletion requested id=%s by user_id=%s", report_id, user.id)
    return jsonify(updated.to_public_dict())


@app.post("/api/reports/<int:report_id>/deletion-review")
@roles_required("reviewer", "admin")
@limiter.limit("60 per hour")
def review_deletion_request_route(report_id):
    """
    Body: { "decision": "approve" | "deny" }
    Reviewer/admin-only. A single decision is final immediately (no
    vote counting, unlike the publish workflow's review_report_route) -
    see record_deletion_review() in report_review.py for the full
    reasoning. "approve" soft-deletes the report (deleted_via=
    "deletion_review"); "deny" puts it back to review_status=published
    (it was visible the whole time either way).
    """
    user = get_current_user()
    body = request.get_json(silent=True) or {}
    decision = (body.get("decision") or "").strip().lower()

    try:
        updated_report = record_deletion_review(report_id, user.id, decision)
    except DeletionReviewError as e:
        abort(400, description=str(e))

    create_user_event(user_id=user.id, document_id=None, action=CRUDAction.UPDATE)
    logger.info("report deletion review id=%s reviewer_id=%s decision=%s -> review_status=%s",
                report_id, user.id, decision, updated_report.review_status)

    return jsonify(updated_report.to_public_dict())


@app.get("/api/reports/deletion-requests")
@roles_required("reviewer", "admin")
def list_deletion_requested_reports_route():
    """
    Reports currently awaiting a reviewer's deletion decision, oldest
    request first. Backs the Peer Review page's Deletion Requests tab.
    """
    limit, offset = parse_pagination_args()
    reports, total = get_deletion_requested_reports(limit=limit, offset=offset)
    return paginated_json_response(reports_to_public_dicts(reports), total, limit, offset)


@app.get("/api/reports/deleted")
@roles_required("admin")
def list_deleted_reports_route():
    """
    Admin-only. Every soft-deleted report that was published at some
    point (deleted_via is set - see get_deleted_reports()'s own
    docstring for exactly what that includes/excludes), searchable and
    filterable by category same as GET /api/reports/all. Backs the
    admin-only Deleted Reports page.
    """
    search = (request.args.get("search") or "").strip() or None
    category = (request.args.get("category") or "").strip() or None
    limit, offset = parse_pagination_args()
    reports, total = get_deleted_reports(search=search, category=category, limit=limit, offset=offset)
    return paginated_json_response(reports_to_public_dicts(reports), total, limit, offset)


@app.post("/api/reports/<int:report_id>/repost")
@roles_required("admin")
def repost_report_route(report_id):
    """
    Admin-only. Un-deletes a report from the Deleted Reports page: just
    restore_report() (status back to visible) - deliberately does NOT
    touch review_status, category, file, or any other field, so
    "repost" really does mean "bring back exactly what was there
    before", not a fresh resubmission through peer review again. Only
    valid for a report currently on the Deleted Reports page (status
    hidden AND deleted_via set) - reposting a report that was never
    actually published doesn't mean anything.
    """
    report = get_report(report_id)
    if report is None or report.status != 0 or report.deleted_via is None:
        abort(404, description="Report not found in Deleted Reports")

    restore_report(report_id)
    logger.info("report reposted id=%s by admin_id=%s", report_id, get_current_user().id)
    return jsonify({"status": "reposted", "id": report_id})


@app.delete("/api/reports/<int:report_id>/permanent")
@roles_required("admin")
def remove_report_permanently(report_id):
    """Admin-only. Permanently deletes a report: removes the DB row and both underlying files."""
    report = get_report(report_id)
    if report is None:
        abort(404, description="Report not found")

    report_storage.delete(report.file_path)
    if report.image_path:
        report_storage.delete(report.image_path)
    hard_delete_report(report_id)

    logger.warning("hard delete report_id=%s by admin_id=%s", report_id, get_current_user().id)
    return jsonify({"status": "permanently deleted", "id": report_id})


# ---------------------------------------------------------------------------
# Report favorites - a logged-in user bookmarking a report for their
# Profile page. Unlike soft/hard delete above, favoriting has no role
# gate: any authenticated user can favorite any report they can already
# see (there's nothing to protect - it's the user's own bookmark list).
# ---------------------------------------------------------------------------

@app.get("/api/reports/mine")
@login_required
def list_my_reports():
    """
    The logged-in user's own uploaded reports, any review_status,
    newest first - what the Profile page's Publications section shows.
    Unlike /api/reports (public, published-only), this deliberately
    includes pending_review and changes_requested so an uploader can see
    where their own submissions stand.
    """
    user = get_current_user()
    reports = get_reports_by_uploader(user.id)
    return jsonify(reports_to_public_dicts(reports))


@app.get("/api/reports/favorites")
@login_required
def list_favorite_reports():
    """The logged-in user's favorited reports, most-recently-favorited first."""
    user = get_current_user()
    reports = get_favorite_reports_by_user(user.id)
    return jsonify(reports_to_public_dicts(reports))


@app.get("/api/reports/favorites/ids")
@login_required
def list_favorite_report_ids():
    """
    Just the id set, for pages like /reports that list many report cards
    and only need to know which ones to show as already-favorited -
    cheaper than fetching full report bodies for every card.
    """
    user = get_current_user()
    return jsonify(sorted(get_favorite_report_ids(user.id)))


@app.post("/api/reports/<int:report_id>/favorite")
@login_required
def favorite_report_route(report_id):
    user = get_current_user()
    report = get_report(report_id)
    if report is None or report.status == 0:
        abort(404, description="Report not found")

    add_favorite_report(user.id, report_id)
    return jsonify({"status": "favorited", "report_id": report_id}), 201


@app.delete("/api/reports/<int:report_id>/favorite")
@login_required
def unfavorite_report_route(report_id):
    user = get_current_user()
    remove_favorite_report(user.id, report_id)
    return jsonify({"status": "unfavorited", "report_id": report_id})


@app.get("/api/events")
@login_required
def list_events():
    """Lists the logged-in user's event history."""
    user = get_current_user()
    events = get_events_by_user(user.id)
    return jsonify([
        {
            "id": e.id,
            "document_id": e.document_id,
            "action": e.action.value,
            "created_at": e.created_at.isoformat(),
        }
        for e in events
    ])


# ---------------------------------------------------------------------------
# Observatory saved charts - lets a logged-in user save a chart built in the
# Observatory's data query tool to their profile, and re-list it later. Only
# the chart's config (indicator/variable/chart type/which country-year
# panels) is stored; the actual figures are re-read from /api/countries at
# render time, so a saved chart always reflects the latest published data.
# ---------------------------------------------------------------------------

MAX_SAVED_CHARTS_PER_USER = 200


@app.post("/api/observatory/saved-charts")
@login_required
def save_observatory_chart():
    user = get_current_user()
    body = request.get_json(silent=True) or {}

    title = (body.get("title") or "").strip()
    indicator = (body.get("indicator") or "").strip()
    config = body.get("config")

    if not title:
        abort(400, description="A chart title is required")
    if indicator not in {"ETTI", "GTBI", "mixed"}:
        abort(400, description="indicator must be 'ETTI', 'GTBI', or 'mixed'")
    if not isinstance(config, dict):
        abort(400, description="config must be an object")

    existing = get_saved_charts_by_user(user.id)
    if len(existing) >= MAX_SAVED_CHARTS_PER_USER:
        abort(400, description=f"You can save at most {MAX_SAVED_CHARTS_PER_USER} charts")

    chart = create_saved_chart(
        user_id=user.id,
        title=title,
        indicator=indicator,
        config_json=json.dumps(config),
    )
    return jsonify(chart.to_dict()), 201


@app.get("/api/observatory/saved-charts")
@login_required
def list_observatory_charts():
    user = get_current_user()
    charts = get_saved_charts_by_user(user.id)
    return jsonify([c.to_dict() for c in charts])


@app.delete("/api/observatory/saved-charts/<int:chart_id>")
@login_required
def remove_observatory_chart(chart_id):
    user = get_current_user()
    chart = get_saved_chart(chart_id)
    if chart is None or chart.user_id != user.id:
        abort(404, description="Saved chart not found")

    delete_saved_chart(chart_id)
    return jsonify({"status": "deleted", "id": chart_id})


# ---------------------------------------------------------------------------
# Donations - embedded Stripe Payment Element. Open to anyone, logged in or
# not.
#
# Flow:
#   1. POST /api/donations/payment-intent creates a "pending" Donation row
#      (so a confirmation_code exists up front) and a Stripe PaymentIntent
#      with automatic_payment_methods enabled - Stripe itself decides which
#      methods to actually offer (card, Cash App Pay, Link, US bank debit,
#      etc.) based on the amount, currency, and what's turned on in the
#      Stripe Dashboard, so nothing here has to hardcode a payment method
#      list. Returns the PaymentIntent's client_secret, which the frontend
#      uses to mount Stripe's own <PaymentElement> directly on /donate -
#      card details are entered there and never touch this app's code or
#      servers.
#   2. stripe.confirmPayment() (frontend) submits the charge and redirects
#      the browser back to /donate/thank-you?payment_intent=...&redirect_
#      status=... on completion (Stripe.js appends these itself).
#   3. Two independent paths both funnel through the same
#      finalize_succeeded_donation() (models/donation.py), which is safe
#      to call twice for one donation:
#        a. POST /api/donations/webhook - Stripe's own server-to-server
#           notification (listens for payment_intent.succeeded), the
#           authoritative path in production.
#        b. GET /api/donations/payment-intent/<id> - called by the
#           thank-you page itself, so the flow still works end-to-end in
#           local dev with no public webhook URL configured at all.
#      Whichever one gets there first sends the confirmation email
#      (guarded by finalize_succeeded_donation's just_finalized flag) -
#      the other is a no-op.
# ---------------------------------------------------------------------------

DONATION_PRESETS_CENTS = [2500, 5000, 10000, 25000]  # $25 / $50 / $100 / $250
DONATION_CURRENCY = "usd"


@app.get("/api/donations/config")
def get_donation_config():
    """Preset amounts + the publishable key, so the frontend never hardcodes either separately from this server-side source of truth."""
    return jsonify({
        "presets_cents": DONATION_PRESETS_CENTS,
        "currency": DONATION_CURRENCY,
        "publishable_key": STRIPE_PUBLISHABLE_KEY,
    })


@app.post("/api/donations/payment-intent")
@limiter.limit("20 per hour")
def create_donation_payment_intent():
    if not STRIPE_SECRET_KEY:
        abort(503, description="Donations aren't configured on this server yet. Please try again later.")

    body = request.get_json(silent=True) or {}
    first_name = (body.get("first_name") or "").strip()
    last_name = (body.get("last_name") or "").strip()
    email = (body.get("email") or "").strip()
    amount_cents = body.get("amount_cents")

    error = (
        validation.check_donor_name(first_name, "First name")
        or validation.check_donor_name(last_name, "Last name")
        or validation.run_check("email", email)
        or validation.check_donation_amount(amount_cents)
    )
    if error:
        abort(400, description=error)

    donation = create_donation(first_name, last_name, email, amount_cents, currency=DONATION_CURRENCY)

    try:
        payment_intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=DONATION_CURRENCY,
            automatic_payment_methods={"enabled": True},
            receipt_email=email,
            description=f"Donation to the International Truth & Trauma Institute - Confirmation {donation.confirmation_code}",
            metadata={
                "donation_id": str(donation.id),
                "confirmation_code": donation.confirmation_code,
            },
        )
    except stripe.StripeError as e:
        logger.warning("Stripe PaymentIntent creation failed for donation_id=%s: %s", donation.id, e)
        mark_donation_failed(donation.id)
        abort(502, description="We couldn't reach our payment processor. Please try again in a moment.")

    attach_payment_intent(donation.id, payment_intent.id)

    return jsonify({
        "client_secret": payment_intent.client_secret,
        "confirmation_code": donation.confirmation_code,
    }), 201


def _finalize_donation_from_payment_intent(stripe_payment_intent):
    """
    Shared by the webhook and the thank-you page's status check: given a
    Stripe PaymentIntent object that's already known to have succeeded,
    looks up the matching Donation by its metadata and finalizes it.
    Sends the confirmation email exactly once (only on the call that
    actually transitions the row from pending -> succeeded).
    """
    donation_id = (stripe_payment_intent.get("metadata") or {}).get("donation_id")
    if not donation_id:
        logger.warning("Stripe PaymentIntent %s has no donation_id in metadata", stripe_payment_intent.get("id"))
        return None

    charges = (stripe_payment_intent.get("charges") or {}).get("data") or []
    payment_method_types = stripe_payment_intent.get("payment_method_types")
    if not payment_method_types and charges:
        pm_details = charges[0].get("payment_method_details") or {}
        if pm_details.get("type"):
            payment_method_types = [pm_details["type"]]

    donation, just_finalized = finalize_succeeded_donation(
        int(donation_id),
        stripe_payment_intent_id=stripe_payment_intent.get("id"),
        payment_method_types=payment_method_types,
    )
    if donation and just_finalized:
        try:
            send_donation_confirmation_email(email_backend, donation)
        except Exception:
            # The donation itself is already recorded as succeeded either
            # way - a failed email send shouldn't look like a failed
            # donation to the donor, so this is logged, not raised.
            logger.exception("Failed to send donation confirmation email for donation_id=%s", donation.id)
    return donation


@app.post("/api/donations/webhook")
def stripe_donation_webhook():
    """
    Stripe's server-to-server notification - NOT a browser request, so it
    intentionally isn't behind login/CORS/session logic. Authenticity is
    verified via Stripe's signature scheme instead (STRIPE_WEBHOOK_SECRET),
    which is why this reads the raw body rather than request.get_json().
    """
    if not STRIPE_WEBHOOK_SECRET:
        abort(503, description="Webhook not configured")

    payload = request.get_data()
    sig_header = request.headers.get("Stripe-Signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError):
        logger.warning("Rejected donation webhook: invalid payload or signature")
        abort(400, description="Invalid signature")

    if event["type"] == "payment_intent.succeeded":
        _finalize_donation_from_payment_intent(event["data"]["object"])

    return jsonify({"received": True})


@app.get("/api/donations/payment-intent/<payment_intent_id>")
@limiter.limit("60 per hour")
def get_donation_by_payment_intent_id(payment_intent_id):
    """
    Called by the thank-you page right after Stripe redirects back from
    confirmPayment(). Re-checks the PaymentIntent with Stripe directly and
    finalizes the donation if it's already succeeded but the webhook
    hasn't landed yet (or isn't configured at all, e.g. local dev) - see
    _finalize_donation_from_payment_intent for why this is safe to run
    alongside the webhook rather than in place of it.
    """
    if not STRIPE_SECRET_KEY:
        abort(503, description="Donations aren't configured on this server yet.")

    try:
        payment_intent = stripe.PaymentIntent.retrieve(payment_intent_id)
    except stripe.StripeError:
        abort(404, description="Payment not found")

    if payment_intent.get("status") == "succeeded":
        donation = _finalize_donation_from_payment_intent(payment_intent)
    else:
        donation = get_donation_by_payment_intent(payment_intent_id)
        if donation and payment_intent.get("status") in ("canceled",):
            mark_donation_failed(donation.id)
            donation = get_donation(donation.id)

    if donation is None:
        abort(404, description="Donation not found")

    return jsonify(donation.to_dict())


# ---------------------------------------------------------------------------
# Certification enrollment - embedded Stripe Payment Element, same pattern
# as donations above, but with two key differences:
#   1. Requires login (tuition payments are tied to a user's account, not
#      a one-off guest purchase) - the confirmation email and receipt use
#      the logged-in user's name/email rather than collecting them again.
#   2. The price is NEVER taken from the client. CERTIFICATION_CATALOG
#      below is the server-side source of truth for cert_code -> name/
#      tuition_cents; the client only ever sends a cert_code, and the
#      amount charged always comes from this dict. Keep it in sync with
#      client/src/data/certifications.js if a certification's name or
#      tuition changes there.
#
# Refund policy (also shown to the user before checkout - see
# CertificationEnrollModal.jsx): enrollments canceled within 7 days of
# purchase are eligible for a 50% refund; no refunds after 7 days.
# refund_enrollment() below enforces this from the server side rather
# than trusting a client-supplied refund amount.
# ---------------------------------------------------------------------------

CERTIFICATION_CATALOG = {
    "CTICP": {"name": "Certified Trauma-Informed Care Practitioner", "tuition_cents": 34900},
    "CWMHRP": {"name": "Certified Workplace Mental Health & Resilience Practitioner", "tuition_cents": 49900},
    "CTISP": {"name": "Certified Trauma-Informed Systems Practitioner", "tuition_cents": 49900},
    "CGPCRP": {"name": "Certified Global Peace & Conflict Resolution Practitioner", "tuition_cents": 49900},
    "CEOPTA": {"name": "Certified Election Observation & Political Trauma Analyst", "tuition_cents": 49900},
    "CGTEA": {"name": "Certified Global Trauma Epidemiology Analyst", "tuition_cents": 69900},
    "CGTBA": {"name": "Certified Global Trauma Burden Analyst", "tuition_cents": 79900},
    "CCTNHS": {"name": "Certified Collective Trauma & National Healing Specialist", "tuition_cents": 99700},
    "CTODAF": {"name": "Certified Trauma Observatory & Data Analytics Fellow", "tuition_cents": 125000},
    "EFTLIT": {"name": "Executive Fellow in Trauma Leadership & Institutional Transformation", "tuition_cents": 250000},
    "GTBSF": {"name": "Global Trauma Burden Scientist Fellow", "tuition_cents": 250000},
}
ENROLLMENT_CURRENCY = "usd"

# Refund policy thresholds, in days since enrollment. Matches the copy
# shown on the enroll modal and in the confirmation email - change all
# three together if this policy ever changes.
REFUND_FULL_WINDOW_DAYS = 0  # no full-refund window; see REFUND_PARTIAL_WINDOW_DAYS
REFUND_PARTIAL_WINDOW_DAYS = 7
REFUND_PARTIAL_FRACTION = 0.5


@app.get("/api/certifications/config")
def get_certification_config():
    """Cert code -> name/tuition, plus the publishable key - mirrors get_donation_config above."""
    return jsonify({
        "certifications": [
            {"cert_code": code, "name": info["name"], "tuition_cents": info["tuition_cents"]}
            for code, info in CERTIFICATION_CATALOG.items()
        ],
        "currency": ENROLLMENT_CURRENCY,
        "publishable_key": STRIPE_PUBLISHABLE_KEY,
    })


@app.post("/api/certifications/payment-intent")
@login_required
@limiter.limit("20 per hour")
def create_enrollment_payment_intent():
    if not STRIPE_SECRET_KEY:
        abort(503, description="Enrollment isn't configured on this server yet. Please try again later.")

    body = request.get_json(silent=True) or {}
    cert_code = (body.get("cert_code") or "").strip().upper()
    catalog_entry = CERTIFICATION_CATALOG.get(cert_code)
    if catalog_entry is None:
        abort(400, description="Unknown certification code")

    user = get_current_user()
    enrollment = create_enrollment(
        user.id, cert_code, catalog_entry["name"], catalog_entry["tuition_cents"], currency=ENROLLMENT_CURRENCY
    )

    try:
        payment_intent = stripe.PaymentIntent.create(
            amount=catalog_entry["tuition_cents"],
            currency=ENROLLMENT_CURRENCY,
            automatic_payment_methods={"enabled": True},
            receipt_email=user.email,
            description=f"{catalog_entry['name']} ({cert_code}\u2122) \u2014 ITTI Certification - Confirmation {enrollment.confirmation_code}",
            metadata={
                "enrollment_id": str(enrollment.id),
                "confirmation_code": enrollment.confirmation_code,
                "cert_code": cert_code,
            },
        )
    except stripe.StripeError as e:
        logger.warning("Stripe PaymentIntent creation failed for enrollment_id=%s: %s", enrollment.id, e)
        mark_enrollment_failed(enrollment.id)
        abort(502, description="We couldn't reach our payment processor. Please try again in a moment.")

    attach_enrollment_payment_intent(enrollment.id, payment_intent.id)

    return jsonify({
        "client_secret": payment_intent.client_secret,
        "confirmation_code": enrollment.confirmation_code,
    }), 201


def _finalize_enrollment_from_payment_intent(stripe_payment_intent):
    """Mirrors _finalize_donation_from_payment_intent above, for enrollments instead of donations."""
    enrollment_id = (stripe_payment_intent.get("metadata") or {}).get("enrollment_id")
    if not enrollment_id:
        logger.warning("Stripe PaymentIntent %s has no enrollment_id in metadata", stripe_payment_intent.get("id"))
        return None

    charges = (stripe_payment_intent.get("charges") or {}).get("data") or []
    payment_method_types = stripe_payment_intent.get("payment_method_types")
    if not payment_method_types and charges:
        pm_details = charges[0].get("payment_method_details") or {}
        if pm_details.get("type"):
            payment_method_types = [pm_details["type"]]

    enrollment, just_finalized = finalize_succeeded_enrollment(
        int(enrollment_id),
        stripe_payment_intent_id=stripe_payment_intent.get("id"),
        payment_method_types=payment_method_types,
    )
    if enrollment and just_finalized:
        # enrollment.user (a lazy-loaded relationship) is not usable here -
        # finalize_succeeded_enrollment() above already closed the session
        # that loaded it, so accessing enrollment.user would raise
        # DetachedInstanceError. Fetch the user with its own fresh,
        # short-lived lookup instead, the same way batched/individual
        # author-name lookups elsewhere in this codebase avoid touching a
        # relationship on a detached instance.
        recipient = get_user(enrollment.user_id)
        if recipient is None:
            logger.warning(
                "Enrollment %s finalized but user_id=%s no longer exists - skipping confirmation email",
                enrollment.id, enrollment.user_id,
            )
        else:
            try:
                send_enrollment_confirmation_email(
                    email_backend, enrollment, recipient.email, recipient.name or recipient.email,
                )
            except Exception:
                logger.exception("Failed to send enrollment confirmation email for enrollment_id=%s", enrollment.id)
    return enrollment


@app.post("/api/certifications/webhook")
def stripe_enrollment_webhook():
    """Stripe's server-to-server notification for enrollment payments - see stripe_donation_webhook's docstring, same reasoning applies here."""
    if not STRIPE_WEBHOOK_SECRET:
        abort(503, description="Webhook not configured")

    payload = request.get_data()
    sig_header = request.headers.get("Stripe-Signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError):
        logger.warning("Rejected enrollment webhook: invalid payload or signature")
        abort(400, description="Invalid signature")

    if event["type"] == "payment_intent.succeeded":
        _finalize_enrollment_from_payment_intent(event["data"]["object"])

    return jsonify({"received": True})


@app.get("/api/certifications/enrollments/payment-intent/<payment_intent_id>")
@limiter.limit("60 per hour")
def get_enrollment_by_payment_intent_id(payment_intent_id):
    """Called by the enrollment thank-you page right after a Stripe redirect - see get_donation_by_payment_intent_id's docstring, same reasoning applies here."""
    if not STRIPE_SECRET_KEY:
        abort(503, description="Enrollment isn't configured on this server yet.")

    try:
        payment_intent = stripe.PaymentIntent.retrieve(payment_intent_id)
    except stripe.StripeError:
        abort(404, description="Payment not found")

    if payment_intent.get("status") == "succeeded":
        enrollment = _finalize_enrollment_from_payment_intent(payment_intent)
    else:
        enrollment = get_enrollment_by_payment_intent(payment_intent_id)
        if enrollment and payment_intent.get("status") in ("canceled",):
            mark_enrollment_failed(enrollment.id)
            enrollment = get_enrollment(enrollment.id)

    if enrollment is None:
        abort(404, description="Enrollment not found")

    return jsonify(enrollment.to_dict())


@app.get("/api/certifications/enrollments/me")
@login_required
def get_my_enrollments():
    """The logged-in user's own enrollment history (successful, pending, refunded, etc.) - shown on their Profile page."""
    user = get_current_user()
    enrollments = get_enrollments_for_user(user.id)
    return jsonify([e.to_dict() for e in enrollments])


@app.post("/api/certifications/enrollments/<int:enrollment_id>/refund")
@roles_required("admin")
def refund_enrollment(enrollment_id):
    """
    Issues a refund through Stripe for a succeeded enrollment, following
    the stated policy rather than an amount supplied in the request:
      - Within REFUND_PARTIAL_WINDOW_DAYS (7) of purchase: 50% refund.
      - After that: no refund (this route 400s rather than issuing $0).
    Admin-only since this moves real money - not self-service for the
    enrolled user (they contact ITTI, per the confirmation email, and an
    admin processes it here).
    """
    if not STRIPE_SECRET_KEY:
        abort(503, description="Enrollment isn't configured on this server yet.")

    enrollment = get_enrollment(enrollment_id)
    if enrollment is None:
        abort(404, description="Enrollment not found")
    if enrollment.status != ENROLLMENT_STATUS_SUCCEEDED:
        abort(400, description=f"Only a succeeded enrollment can be refunded (current status: {enrollment.status})")
    if not enrollment.stripe_payment_intent_id:
        abort(400, description="This enrollment has no associated payment to refund")

    days_since_purchase = (datetime.utcnow() - enrollment.created_at).days
    if days_since_purchase > REFUND_PARTIAL_WINDOW_DAYS:
        abort(400, description=(
            f"This enrollment is {days_since_purchase} days old. Per policy, refunds are only available "
            f"within {REFUND_PARTIAL_WINDOW_DAYS} days of purchase."
        ))
    refund_cents = round(enrollment.tuition_cents * REFUND_PARTIAL_FRACTION)

    try:
        stripe_refund = stripe.Refund.create(
            payment_intent=enrollment.stripe_payment_intent_id,
            amount=refund_cents,
        )
    except stripe.StripeError as e:
        logger.warning("Stripe refund failed for enrollment_id=%s: %s", enrollment.id, e)
        abort(502, description="We couldn't reach our payment processor. Please try again in a moment.")

    updated = record_refund(enrollment.id, refund_cents, stripe_refund.id, full=(refund_cents >= enrollment.tuition_cents))
    logger.info("Refunded enrollment_id=%s amount_cents=%d admin_user_id=%s", enrollment.id, refund_cents, get_current_user().id)
    return jsonify(updated.to_dict())


if __name__ == "__main__":
    app.run(debug=not IS_PRODUCTION, port=5000)