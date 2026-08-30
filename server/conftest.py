"""
Shared pytest fixtures for the whole test suite.

CRITICAL: DATABASE_URL must be set to a fresh temp file BEFORE `app` (or
any `models.*` module) is ever imported - models/database.py reads
DATABASE_URL at import time to build its engine, so setting it after
import has no effect and tests would silently run against whatever
database was already configured (i.e. the real server/app.db in local
dev, or a real production Postgres if DATABASE_URL happened to be set
in the test environment). This is why the os.environ assignment below
happens at module level, before the `import app` statement - pytest
imports conftest.py before collecting/importing any test file, so this
runs first as long as no test file does its own top-level `import app`
before this file has had a chance to run (none should, in a well-formed
suite - tests should only ever get `app` via the `client` fixture below).
"""
import os
import tempfile

import pytest

# A real temp FILE, not sqlite:///:memory: - Flask's test client can
# exercise the app across what SQLAlchemy sees as separate connections/
# threads, and in-memory SQLite databases don't reliably share state
# across connections (each :memory: connection gets its own separate
# database) - see models/database.py's own comment on check_same_thread
# for the multi-threading context this needs to hold up under.
_TEST_DB_FD, _TEST_DB_PATH = tempfile.mkstemp(suffix=".db")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH}"
os.environ.setdefault("EMAIL_BACKEND", "console")  # never actually send email in tests

import app as app_module  # noqa: E402  (must come after the DATABASE_URL assignment above)


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """
    Flask-Limiter's storage (in-memory - see RATELIMIT_STORAGE_URI's own
    comment in app.py) persists across the whole pytest process, not per
    test. Without resetting it, every test's requests count against the
    same per-IP budget (the Flask test client's remote address is always
    127.0.0.1) as every other test - a handful of tests each calling
    /api/auth/signup once would collectively exhaust its "5 per hour"
    limit well before any single test meant to test that limit
    specifically. autouse=True so every test gets a clean rate-limit
    slate without needing to remember to request this fixture.
    """
    app_module.limiter.storage.reset()
    yield


@pytest.fixture()
def client():
    """
    A fresh Flask test client for a single test. The database itself is
    NOT reset between tests within a session (schema is created once,
    at import time, by app.py's own startup check - see that file's
    `if DATABASE_URL.startswith("sqlite") and not inspect(engine)...`
    logic) - each test is responsible for creating whatever data it
    needs with unique-enough values (see the `unique_email` fixture
    below) rather than assuming a clean slate, since re-creating the
    schema per-test would be slow and most tests don't actually need
    isolation from each other's leftover rows.
    """
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as test_client:
        yield test_client


@pytest.fixture()
def csrf_headers(client):
    """
    Fetches a real CSRF token the way a browser would (GET
    /api/csrf-token) and returns the header dict to pass to any
    mutating request - every POST/PATCH/DELETE test needs this since
    app.py's enforce_csrf() before_request hook rejects any unsafe
    method without a matching X-CSRF-Token header (see that function's
    own docstring for the double-submit-cookie reasoning).
    """
    response = client.get("/api/csrf-token")
    token = response.get_json()["csrf_token"]
    return {"X-CSRF-Token": token}


@pytest.fixture()
def unique_email():
    """
    A guaranteed-unique email per test call - since the test database
    isn't reset between tests (see the `client` fixture's own docstring
    above), reusing a fixed email like "test@example.com" across
    multiple tests would collide with the unique constraint on
    User.email the moment more than one test tried to sign it up.
    """
    import uuid

    return f"test-{uuid.uuid4().hex}@example.com"


def make_verified_user(email, password="password123", role="basic"):
    """
    Shared helper (not a fixture - takes an email, so different tests
    can create as many of these as they need) that creates a fully
    usable account: signed up AND already email_verified, at a given
    role - bypasses the actual signup+code-entry flow for tests that
    need a ready-to-use account and are testing something else
    entirely (e.g. the deletion workflow), while
    test_auth.py/test_email_verification.py separately test that flow
    itself end-to-end rather than skip past it.
    """
    from models.user import create_user, update_user
    from werkzeug.security import generate_password_hash

    user = create_user(email=email, password_hash=generate_password_hash(password), name=email)
    update_user(user.id, role=role, email_verified=True)
    return user
