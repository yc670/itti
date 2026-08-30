"""
EmailVerificationCode model and CRUD functions.

Deliberately a near-exact mirror of models/password_reset_code.py's
design (same hashing, same TTL/attempt/cooldown shape) rather than a
shared abstraction - the two flows serve different purposes (proving
account ownership to reset a password vs. proving email ownership to
activate a brand-new account) and are used at different points in the
auth lifecycle, so keeping them as separate, independently-readable
modules seemed clearer than a generic "OTP" abstraction both would have
to route through. See that file's own module docstring for the
reasoning behind each design choice (hash-only storage, 10-minute TTL,
attempt cap, resend cooldown) - it all applies identically here.
"""
import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from .database import Base, Session

DEFAULT_CODE_TTL = timedelta(minutes=10)
MAX_VERIFY_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=30)


def _hash_code(raw_code):
    return hashlib.sha256(raw_code.encode("utf-8")).hexdigest()


def _generate_code():
    return f"{secrets.randbelow(1_000_000):06d}"


class EmailVerificationCode(Base):
    __tablename__ = "email_verification_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    code_hash = Column(String, nullable=False, index=True)
    attempts = Column(Integer, default=0, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User")

    def __repr__(self):
        return f"<EmailVerificationCode id={self.id} user_id={self.user_id} used={self.used_at is not None}>"


def create_verification_code(user_id, ttl=DEFAULT_CODE_TTL):
    """
    New 6-digit verification code for a user, invalidating any previous
    unused one. Returns the RAW code (only time available in plaintext)
    for the caller to email - never log it. Raises RuntimeError if
    called again within RESEND_COOLDOWN of the last one.
    """
    session = Session()
    try:
        latest = (
            session.query(EmailVerificationCode)
            .filter(
                EmailVerificationCode.user_id == user_id,
                EmailVerificationCode.used_at.is_(None),
            )
            .order_by(EmailVerificationCode.created_at.desc())
            .first()
        )
        if latest is not None and datetime.utcnow() - latest.created_at < RESEND_COOLDOWN:
            raise RuntimeError("Please wait before requesting another code.")

        session.query(EmailVerificationCode).filter(
            EmailVerificationCode.user_id == user_id,
            EmailVerificationCode.used_at.is_(None),
        ).update({"used_at": datetime.utcnow()})

        raw_code = _generate_code()
        record = EmailVerificationCode(
            user_id=user_id,
            code_hash=_hash_code(raw_code),
            expires_at=datetime.utcnow() + ttl,
        )
        session.add(record)
        session.commit()
        return raw_code
    finally:
        session.close()


def verify_code(user_id, raw_code):
    """
    Checks a guessed code against the user's current active code.
    Returns "ok", "mismatch", "expired", or "too_many_attempts" - same
    contract as password_reset_code.py's verify_code(). Does NOT mark
    the user's account verified itself - the route does that (see
    /api/auth/verify-email in app.py), since this module only knows
    about codes, not what a correct one is used for.
    """
    session = Session()
    try:
        record = (
            session.query(EmailVerificationCode)
            .filter(
                EmailVerificationCode.user_id == user_id,
                EmailVerificationCode.used_at.is_(None),
            )
            .order_by(EmailVerificationCode.created_at.desc())
            .first()
        )
        if record is None:
            return "expired"
        if record.expires_at < datetime.utcnow():
            return "expired"
        if record.attempts >= MAX_VERIFY_ATTEMPTS:
            return "too_many_attempts"

        record.attempts += 1

        if record.code_hash != _hash_code(raw_code):
            session.commit()
            return "mismatch"

        record.used_at = datetime.utcnow()
        session.commit()
        return "ok"
    finally:
        session.close()
