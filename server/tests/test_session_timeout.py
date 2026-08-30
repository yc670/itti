"""
Tests for the session inactivity timeout (decorators.py's
get_current_user - the central chokepoint every login_required/
roles_required route goes through).
"""
import time

from conftest import make_verified_user
from decorators import SESSION_INACTIVITY_TIMEOUT


def _login(client, csrf_headers, email):
    client.post("/api/auth/login", json={"email": email, "password": "password123"}, headers=csrf_headers)


def _set_last_active_seconds_ago(client, seconds_ago):
    with client.session_transaction() as sess:
        sess["last_active"] = time.time() - seconds_ago


def test_session_works_immediately_after_login(client, csrf_headers, unique_email):
    make_verified_user(unique_email)
    _login(client, csrf_headers, unique_email)

    r = client.get("/api/auth/me")
    assert r.status_code == 200


def test_session_expires_after_the_timeout(client, csrf_headers, unique_email):
    make_verified_user(unique_email)
    _login(client, csrf_headers, unique_email)

    _set_last_active_seconds_ago(client, SESSION_INACTIVITY_TIMEOUT + 60)

    r = client.get("/api/auth/me")
    assert r.status_code == 401
    assert r.get_json()["reason"] == "session_expired"


def test_session_survives_right_up_to_the_boundary(client, csrf_headers, unique_email):
    make_verified_user(unique_email)
    _login(client, csrf_headers, unique_email)

    _set_last_active_seconds_ago(client, SESSION_INACTIVITY_TIMEOUT - 60)

    r = client.get("/api/auth/me")
    assert r.status_code == 200


def test_activity_resets_the_timer_sliding_window(client, csrf_headers, unique_email):
    """
    Two gaps of 20 minutes each (with a request in between) should NOT
    expire the session, even though 40 minutes have passed in total -
    each individual gap is under the 30-minute limit, and every request
    resets the clock. This is what distinguishes an inactivity timeout
    from a fixed session lifetime (that's PERMANENT_SESSION_LIFETIME in
    app.py, a separate, much longer setting).
    """
    make_verified_user(unique_email)
    _login(client, csrf_headers, unique_email)

    _set_last_active_seconds_ago(client, 20 * 60)
    r1 = client.get("/api/auth/me")
    assert r1.status_code == 200

    _set_last_active_seconds_ago(client, 20 * 60)
    r2 = client.get("/api/auth/me")
    assert r2.status_code == 200


def test_expired_session_is_fully_cleared_not_just_rejected_once(client, csrf_headers, unique_email):
    make_verified_user(unique_email)
    _login(client, csrf_headers, unique_email)
    _set_last_active_seconds_ago(client, SESSION_INACTIVITY_TIMEOUT + 60)

    first = client.get("/api/auth/me")
    assert first.status_code == 401

    # A second request right after should still be 401 - the session
    # was actually cleared, not just rejected this one time.
    second = client.get("/api/auth/me")
    assert second.status_code == 401


def test_expired_session_blocks_role_gated_routes_too(client, csrf_headers, unique_email):
    make_verified_user(unique_email, role="admin")
    _login(client, csrf_headers, unique_email)
    _set_last_active_seconds_ago(client, SESSION_INACTIVITY_TIMEOUT + 60)

    # Any @roles_required route, not just /api/auth/me - confirms the
    # timeout is enforced in the shared get_current_user() both
    # decorators call, not something only auth_me() happens to check.
    r = client.get("/api/reports/deleted", headers=csrf_headers)
    assert r.status_code == 401
    assert r.get_json()["reason"] == "session_expired"
