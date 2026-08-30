"""
Route-level access control.

This app authenticates via a server-side session (a signed cookie set in
/api/auth/google or /api/auth/login — see app.py), not a bearer token, so
these decorators read from `flask.session` rather than a JWT.

Usage:

    @app.get("/api/documents")
    @login_required
    def list_documents():
        ...

    @app.post("/api/documents")
    @roles_required("publisher")
    def upload_document():
        ...
"""
from datetime import datetime, timezone
from functools import wraps

from flask import jsonify, session

from models.user import get_user

# 30 minutes of inactivity - see docs/ACCESS_LEVELS.md's "Session
# inactivity timeout" section for why this specific value: OWASP
# classifies an app like this one (accounts hold real permissions -
# publish/delete content, admin/reviewer roles - but nothing
# financial/health-record-level sensitive) as "medium risk," for which
# 15-30 minutes is the consistent recommendation across OWASP, NIST
# 800-63B, and PCI-DSS-adjacent guidance. Chosen at the permissive end
# of that range to favor usability given this isn't a high-risk app.
SESSION_INACTIVITY_TIMEOUT = 30 * 60  # seconds


def get_current_user():
    """
    Return the logged-in User, or None. Safe to call from any route.
    Only ever returns a status=visible user — get_user() already filters
    out soft-deleted accounts by default.

    Also enforces the inactivity timeout: if the session's own
    last_active timestamp is older than SESSION_INACTIVITY_TIMEOUT, the
    session is cleared here and this returns None - the same as if the
    person had never logged in - rather than as a separate check
    elsewhere, so every caller (login_required, roles_required,
    anything that calls this directly) automatically gets this behavior
    for free without needing to remember to check it themselves.

    On every call that DOES find a valid, non-expired session, last_active
    is stamped to now - this is what makes the timeout inactivity-based
    (resets on any authenticated request) rather than a fixed session
    lifetime from login (that's PERMANENT_SESSION_LIFETIME in app.py,
    a separate, much longer absolute ceiling - see that setting's own
    comment for why both exist together).
    """
    user_id = session.get("user_id")
    if not user_id:
        return None

    last_active = session.get("last_active")
    if last_active is not None:
        elapsed = datetime.now(timezone.utc).timestamp() - last_active
        if elapsed > SESSION_INACTIVITY_TIMEOUT:
            session.clear()
            return None

    user = get_user(user_id)
    if user is None:
        return None

    session["last_active"] = datetime.now(timezone.utc).timestamp()
    return user


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if get_current_user() is None:
            return jsonify({"error": "authentication required", "reason": "session_expired"}), 401
        return fn(*args, **kwargs)

    return wrapper


def roles_required(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = get_current_user()
            if user is None:
                return jsonify({"error": "authentication required", "reason": "session_expired"}), 401
            if user.role not in roles:
                return jsonify({"error": "insufficient permissions"}), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator