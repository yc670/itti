"""
Tests for CSRF protection (server/app.py's enforce_csrf/ensure_csrf_cookie
before/after_request hooks and the GET /api/csrf-token bootstrap route).
"""


def test_get_requests_never_need_a_csrf_token(client):
    r = client.get("/api/health")
    assert r.status_code == 200


def test_post_without_csrf_token_is_rejected(client, unique_email):
    r = client.post("/api/auth/signup", json={"email": unique_email, "password": "password123"})
    assert r.status_code == 403
    assert r.get_json()["error"] == "csrf_failed"


def test_post_with_correct_csrf_token_succeeds(client, csrf_headers, unique_email):
    r = client.post("/api/auth/signup", json={"email": unique_email, "password": "password123"}, headers=csrf_headers)
    assert r.status_code == 201


def test_post_with_wrong_csrf_token_is_rejected(client, unique_email):
    r = client.post(
        "/api/auth/signup",
        json={"email": unique_email, "password": "password123"},
        headers={"X-CSRF-Token": "totally-made-up-value"},
    )
    assert r.status_code == 403


def test_csrf_token_endpoint_sets_a_cookie(client):
    r = client.get("/api/csrf-token")
    assert r.status_code == 200
    assert r.get_json()["csrf_token"]
    set_cookie_headers = r.headers.getlist("Set-Cookie")
    assert any(h.startswith("csrf_token=") for h in set_cookie_headers)


def test_webhooks_are_exempt_from_csrf(client):
    # Stripe's webhooks are server-to-server (no browser, no CSRF token
    # to attach) - authenticated by Stripe's own signature instead (see
    # CSRF_EXEMPT_PATHS in app.py). This should NOT 403 with csrf_failed -
    # it may still fail for other reasons (missing/invalid Stripe
    # signature, no Stripe config in the test environment), which is
    # fine; this test only asserts CSRF specifically isn't why.
    r = client.post("/api/donations/webhook", data=b"{}", content_type="application/json")
    assert r.status_code != 403 or r.get_json().get("error") != "csrf_failed"
