"""
Pluggable email sending.

EMAIL_BACKEND controls how outgoing email actually gets sent:
  - "console"  (default) -> logs the email instead of sending it. Zero
                             setup, works completely offline, and is what
                             makes the forgot-password flow fully testable
                             right now with no email provider at all.
                             THIS IS WHY, if EMAIL_BACKEND was never
                             actually set in production, a user reports
                             "I never got the email" - the code was
                             generated and is valid, just never left the
                             server (only logged). Check the deployed
                             environment's EMAIL_BACKEND value first if
                             that's reported.
  - "brevo_api"           -> sends via Brevo's transactional email HTTP
                             API (api.brevo.com). This is the recommended
                             option when using Brevo - see
                             BrevoAPIEmailBackend below and
                             docs/DEPLOYMENT.md's Brevo section.
  - "smtp"                -> sends via a real SMTP server (SendGrid,
                              Postmark, Mailgun, plain SMTP, Brevo's SMTP
                              relay, etc - anything that speaks SMTP).
                              Kept as a fallback/alternative to
                              "brevo_api" for providers that don't offer
                              an HTTP API, or a preference for SMTP.

Same shape as storage.py: pick a backend via env var, nothing else in
the codebase needs to change when you're ready to send real email.
"""
import logging
import os
import smtplib
from email.message import EmailMessage

import requests

logger = logging.getLogger("itti")


class ConsoleEmailBackend:
    """Logs the email instead of sending it. This is the dev default -
    the forgot-password flow is fully exercisable locally without any
    email provider: the reset link just shows up in the server log."""

    def send(self, to, subject, body):
        logger.info("=== EMAIL (console backend, not actually sent) ===")
        logger.info("To: %s", to)
        logger.info("Subject: %s", subject)
        logger.info("Body:\n%s", body)
        logger.info("=== end email ===")


class BrevoAPIEmailBackend:
    """
    Sends real email via Brevo's transactional email HTTP API
    (POST https://api.brevo.com/v3/smtp/email) rather than SMTP. Configure
    with BREVO_API_KEY, BREVO_FROM_EMAIL, and optionally BREVO_FROM_NAME
    (see docs/DEPLOYMENT.md's Brevo section for where to get the API key
    and how to verify a sender).

    Preferred over SMTPEmailBackend when using Brevo specifically: the
    API call returns Brevo's own error detail synchronously (bad/expired
    key, unverified sender, etc. come back as a clear HTTP error instead
    of a generic SMTP auth failure), and avoids opening an outbound SMTP
    connection at all, which some hosts throttle or block by default.
    """

    API_URL = "https://api.brevo.com/v3/smtp/email"

    def __init__(self):
        self.api_key = os.environ.get("BREVO_API_KEY")
        self.from_email = os.environ.get("BREVO_FROM_EMAIL")
        self.from_name = os.environ.get("BREVO_FROM_NAME", "International Truth & Trauma Institute")

        if not self.api_key or not self.from_email:
            raise RuntimeError(
                "EMAIL_BACKEND=brevo_api requires BREVO_API_KEY and BREVO_FROM_EMAIL "
                "to be set (BREVO_FROM_NAME is optional)"
            )

    def send(self, to, subject, body):
        response = requests.post(
            self.API_URL,
            headers={
                "accept": "application/json",
                "api-key": self.api_key,
                "content-type": "application/json",
            },
            json={
                "sender": {"email": self.from_email, "name": self.from_name},
                "to": [{"email": to}],
                "subject": subject,
                "textContent": body,
            },
            timeout=10,
        )
        if response.status_code >= 400:
            # Surface Brevo's own error body (e.g. "sender not verified",
            # "invalid api-key") rather than just the status code - this
            # is what shows up in the caller's try/except logging (see
            # forgot_password()'s docstring in app.py for why the reset
            # request itself still returns success either way).
            raise RuntimeError(
                f"Brevo API send failed ({response.status_code}): {response.text}"
            )


class SMTPEmailBackend:
    """Sends real email via SMTP. Configure with SMTP_HOST, SMTP_PORT,
    SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL (see .env.example)."""

    def __init__(self):
        self.host = os.environ.get("SMTP_HOST")
        self.port = int(os.environ.get("SMTP_PORT", "587"))
        self.username = os.environ.get("SMTP_USERNAME")
        self.password = os.environ.get("SMTP_PASSWORD")
        self.from_email = os.environ.get("SMTP_FROM_EMAIL", self.username)

        if not self.host or not self.from_email:
            raise RuntimeError(
                "EMAIL_BACKEND=smtp requires SMTP_HOST and SMTP_FROM_EMAIL "
                "(and usually SMTP_USERNAME/SMTP_PASSWORD) to be set"
            )

    def send(self, to, subject, body):
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = self.from_email
        msg["To"] = to
        msg.set_content(body)

        with smtplib.SMTP(self.host, self.port) as server:
            server.starttls()
            if self.username and self.password:
                server.login(self.username, self.password)
            server.send_message(msg)


def get_email_backend():
    backend = os.environ.get("EMAIL_BACKEND", "console").lower()
    if backend == "brevo_api":
        return BrevoAPIEmailBackend()
    if backend == "smtp":
        return SMTPEmailBackend()
    return ConsoleEmailBackend()


def send_password_reset_code_email(backend, to_email, code):
    """
    code is the raw 6-digit code (see models/password_reset_code.py) -
    the user types this into the Verify Reset Code page rather than
    clicking a link. Sent for both the initial request and every resend.
    """
    backend.send(
        to=to_email,
        subject="Your ITTI password reset code",
        body=(
            "Someone (hopefully you) requested a password reset for your ITTI account.\n\n"
            f"Your verification code is: {code}\n\n"
            "Enter this code on the page where you requested the reset. This code "
            "expires in 10 minutes. If you didn't request this, you can safely ignore "
            "this email - your password will not be changed."
        ),
    )


def send_email_verification_code_email(backend, to_email, code):
    """
    code is the raw 6-digit code (see
    models/email_verification_code.py) - sent right after signup and
    on every resend. Unlike the password-reset email above, there's no
    "if you didn't request this, ignore it" framing - creating the
    account IS the request, so silence isn't a safe interpretation.
    """
    backend.send(
        to=to_email,
        subject="Verify your ITTI account",
        body=(
            "Welcome to ITTI. Enter this code to verify your email and activate your account:\n\n"
            f"{code}\n\n"
            "This code expires in 10 minutes. If you didn't create an account with this "
            "email, no account has been activated and you can disregard this message."
        ),
    )


def send_enrollment_confirmation_email(backend, enrollment, to_email, to_name):
    """
    enrollment is a models.enrollment.Enrollment row already marked
    succeeded - mirrors send_donation_confirmation_email above (compose
    + send only, doesn't touch status itself). to_email/to_name come from
    the logged-in user's account since Enrollment doesn't store its own
    copy of either (see enrollment.py's docstring).
    """
    enrolled_on = enrollment.created_at.strftime("%B %d, %Y") if enrollment.created_at else ""
    backend.send(
        to=to_email,
        subject=f"You're enrolled in {enrollment.cert_code}™ — {enrollment.confirmation_code}",
        body=(
            f"Dear {to_name},\n\n"
            f"Thank you for enrolling in {enrollment.cert_name} ({enrollment.cert_code}™) "
            "through the International Truth & Trauma Institute. Your enrollment is "
            "confirmed - watch your email for program access details.\n\n"
            "Enrollment receipt\n"
            "-------------------\n"
            f"Confirmation number: {enrollment.confirmation_code}\n"
            f"Certification: {enrollment.cert_name} ({enrollment.cert_code}™)\n"
            f"Tuition paid: {enrollment.tuition_display} ({enrollment.currency.upper()})\n"
            f"Date: {enrolled_on}\n\n"
            "Refund policy: enrollments canceled within 7 days of purchase are eligible "
            "for a 50% refund of tuition paid. No refunds are issued more than 7 days "
            "after purchase. To request a refund, contact us with your confirmation "
            "number.\n\n"
            "Please keep this email for your records - your confirmation number is also "
            "stored on file with us and can be used as a reference in any correspondence "
            "about this enrollment.\n\n"
            "With gratitude,\n"
            "The International Truth & Trauma Institute"
        ),
    )


def send_donation_confirmation_email(backend, donation):
    """
    donation is a models.donation.Donation row that has already been
    marked succeeded - this only composes and sends the receipt, it
    doesn't check or change status itself (see
    finalize_succeeded_donation's just_finalized return value, which is
    what callers use to decide whether to call this at all, so a
    donor is never emailed twice for the same donation).
    """
    donated_on = donation.created_at.strftime("%B %d, %Y") if donation.created_at else ""
    backend.send(
        to=donation.email,
        subject=f"Thank you for your donation to ITTI — {donation.confirmation_code}",
        body=(
            f"Dear {donation.first_name},\n\n"
            "Thank you for your generous gift to the International Truth & Trauma "
            "Institute. Your support directly funds our work documenting and "
            "responding to election- and conflict-related trauma around the world.\n\n"
            "Donation receipt\n"
            "-----------------\n"
            f"Confirmation number: {donation.confirmation_code}\n"
            f"Donor: {donation.full_name}\n"
            f"Amount: {donation.amount_display} ({donation.currency.upper()})\n"
            f"Date: {donated_on}\n\n"
            "Please keep this email for your records - your confirmation number is "
            "also stored on file with us and can be used as a reference in any "
            "correspondence about this gift.\n\n"
            "With gratitude,\n"
            "The International Truth & Trauma Institute"
        ),
    )