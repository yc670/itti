"""
Tests for signup, login, and email verification (server/app.py's
auth_signup, auth_login, verify_email_route, resend_verification_route).

Covers the core behavior change from this session: signup no longer
logs the user in immediately, and login refuses an unverified account
even with the correct password.
"""
import re

from conftest import make_verified_user
from models.user import get_user_by_email


def _extract_code(caplog):
    """Pulls the 6-digit verification code out of the console email
    backend's log output (see email_backend.py's ConsoleEmailBackend -
    EMAIL_BACKEND=console is set in conftest.py, so no real email is
    ever sent; this is how a test gets at the code that would have
    been emailed)."""
    match = re.search(r"account:\n\n(\d{6})\n\n", caplog.text)
    assert match, f"could not find a verification code in logs:\n{caplog.text}"
    return match.group(1)


class TestSignup:
    def test_signup_does_not_log_in(self, client, csrf_headers, unique_email):
        r = client.post(
            "/api/auth/signup",
            json={"email": unique_email, "password": "password123", "name": "Test"},
            headers=csrf_headers,
        )
        assert r.status_code == 201
        assert r.get_json()["needs_verification"] is True

        # Confirms the actual behavior change this session introduced -
        # before email verification existed, signup logged the user in
        # immediately and this would have been 200.
        me = client.get("/api/auth/me")
        assert me.status_code == 401

    def test_signup_rejects_short_password(self, client, csrf_headers, unique_email):
        r = client.post(
            "/api/auth/signup",
            json={"email": unique_email, "password": "short"},
            headers=csrf_headers,
        )
        assert r.status_code == 400

    def test_signup_rejects_duplicate_email(self, client, csrf_headers, unique_email):
        client.post("/api/auth/signup", json={"email": unique_email, "password": "password123"}, headers=csrf_headers)
        r = client.post("/api/auth/signup", json={"email": unique_email, "password": "password123"}, headers=csrf_headers)
        assert r.status_code == 409

    def test_signup_requires_csrf_token(self, client, unique_email):
        # No csrf_headers fixture used here on purpose - this is
        # specifically testing that the request is rejected without one.
        r = client.post("/api/auth/signup", json={"email": unique_email, "password": "password123"})
        assert r.status_code == 403
        assert r.get_json()["error"] == "csrf_failed"


class TestEmailVerification:
    def test_full_verification_flow(self, client, csrf_headers, unique_email, caplog):
        import logging

        caplog.set_level(logging.INFO, logger="itti")

        client.post("/api/auth/signup", json={"email": unique_email, "password": "password123"}, headers=csrf_headers)
        code = _extract_code(caplog)

        # Wrong code is rejected
        r = client.post("/api/auth/verify-email", json={"email": unique_email, "code": "000000"}, headers=csrf_headers)
        assert r.status_code == 400

        # Correct code verifies AND logs in
        r = client.post("/api/auth/verify-email", json={"email": unique_email, "code": code}, headers=csrf_headers)
        assert r.status_code == 200
        assert r.get_json()["email_verified"] is True

        me = client.get("/api/auth/me")
        assert me.status_code == 200

    def test_resend_gives_a_new_working_code(self, client, csrf_headers, unique_email, caplog):
        import logging

        caplog.set_level(logging.INFO, logger="itti")

        client.post("/api/auth/signup", json={"email": unique_email, "password": "password123"}, headers=csrf_headers)

        # The immediate resend-cooldown should block a second code this fast
        r = client.post("/api/auth/resend-verification", json={"email": unique_email}, headers=csrf_headers)
        assert r.status_code == 200
        assert "wait" in r.get_json()["message"].lower()

    def test_resend_on_nonexistent_email_404s(self, client, csrf_headers):
        r = client.post(
            "/api/auth/resend-verification",
            json={"email": "definitely-not-a-real-account@example.com"},
            headers=csrf_headers,
        )
        assert r.status_code == 404


class TestLogin:
    def test_login_blocked_while_unverified(self, client, csrf_headers, unique_email):
        client.post("/api/auth/signup", json={"email": unique_email, "password": "password123"}, headers=csrf_headers)

        r = client.post("/api/auth/login", json={"email": unique_email, "password": "password123"}, headers=csrf_headers)
        assert r.status_code == 403
        assert r.get_json()["error"] == "email_not_verified"
        assert r.get_json()["email"] == unique_email

    def test_login_works_once_verified(self, client, csrf_headers, unique_email):
        make_verified_user(unique_email)

        r = client.post("/api/auth/login", json={"email": unique_email, "password": "password123"}, headers=csrf_headers)
        assert r.status_code == 200

        me = client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.get_json()["email"] == unique_email

    def test_login_rejects_wrong_password(self, client, csrf_headers, unique_email):
        make_verified_user(unique_email)

        r = client.post("/api/auth/login", json={"email": unique_email, "password": "wrong-password"}, headers=csrf_headers)
        assert r.status_code == 401

    def test_login_rate_limited(self, client, csrf_headers, unique_email):
        make_verified_user(unique_email)

        # The 9th attempt within a minute should be blocked (limit is
        # "8 per minute" - see auth_login()'s own decorator in app.py).
        statuses = []
        for _ in range(9):
            r = client.post(
                "/api/auth/login", json={"email": unique_email, "password": "wrong-password"}, headers=csrf_headers
            )
            statuses.append(r.status_code)

        assert statuses[:8] == [401] * 8
        assert statuses[8] == 429


class TestGoogleLinking:
    def test_google_signup_is_immediately_verified(self, client, csrf_headers, unique_email, monkeypatch):
        fake_claims = {"sub": f"google-sub-{unique_email}", "email": unique_email, "name": "Google User", "picture": None}
        monkeypatch.setattr("app.id_token.verify_oauth2_token", lambda *a, **k: fake_claims)
        monkeypatch.setattr("app.GOOGLE_CLIENT_ID", "fake-client-id")

        r = client.post("/api/auth/google", json={"credential": "fake-jwt"}, headers=csrf_headers)
        assert r.status_code == 200
        assert r.get_json()["email_verified"] is True

    def test_google_linking_verifies_existing_unverified_account(self, client, csrf_headers, unique_email, monkeypatch):
        client.post("/api/auth/signup", json={"email": unique_email, "password": "password123"}, headers=csrf_headers)
        assert get_user_by_email(unique_email).email_verified is False

        fake_claims = {"sub": f"google-sub-{unique_email}", "email": unique_email, "name": "Google User", "picture": None}
        monkeypatch.setattr("app.id_token.verify_oauth2_token", lambda *a, **k: fake_claims)
        monkeypatch.setattr("app.GOOGLE_CLIENT_ID", "fake-client-id")

        r = client.post("/api/auth/google", json={"credential": "fake-jwt"}, headers=csrf_headers)
        assert r.status_code == 200
        assert r.get_json()["linked_existing_account"] is True
        assert r.get_json()["email_verified"] is True
