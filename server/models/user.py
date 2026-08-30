"""
User model and CRUD functions.

Access tier lives on User.role, independent of status (which just tracks
soft-delete) and independent of how the user authenticated (Google or
email/password) — see docs/ACCESS_LEVELS.md for the full design.

  ROLE_BASIC     — default for every account, regardless of signup method.
  ROLE_PUBLISHER — fellows/staff who can upload/publish documents. Never
                   set by /api/auth/google or /api/auth/signup; granted
                   separately via promote_user.py.
  ROLE_REVIEWER  — a tier above publisher, below admin. Everything a
                   publisher can do, plus deciding a publisher's
                   deletion requests on their own published reports
                   (see record_deletion_review() in
                   models/report_review.py) - a single reviewer
                   decision is final either way (unlike the 3-approval/
                   2-rejection publish workflow), so this tier exists
                   to put that single point of decision in the hands of
                   someone other than the uploader's peers.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, Boolean, or_
from sqlalchemy.orm import relationship

from .database import Base, Session
from pagination import DEFAULT_PAGE_SIZE, clamp_limit, clamp_offset

STATUS_VISIBLE = 1
STATUS_HIDDEN = 0

ROLE_BASIC = "basic"
ROLE_PUBLISHER = "publisher"
ROLE_REVIEWER = "reviewer"
ROLE_ADMIN = "admin"
VALID_ROLES = {ROLE_BASIC, ROLE_PUBLISHER, ROLE_REVIEWER, ROLE_ADMIN}


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Nullable because a user may sign up with email/password instead of Google.
    google_sub = Column(String, unique=True, nullable=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    # Nullable because a user may sign up with Google instead of a password.
    password_hash = Column(String, nullable=True)
    name = Column(String, nullable=True)
    picture_url = Column(String, nullable=True)
    # Internal storage path/mimetype for a picture the user uploaded
    # themselves (mirrors Report.image_path) - null if picture_url is an
    # external URL (e.g. a Google avatar) rather than something this app
    # is serving from its own storage. See models/user.py's
    # to_public_dict() and app.py's /api/auth/update-picture.
    picture_path = Column(String, nullable=True)
    picture_mime_type = Column(String, nullable=True)
    role = Column(String(20), nullable=False, default=ROLE_BASIC, index=True)
    # 1 = visible/active (default), 0 = hidden (soft-deleted account).
    # The row is never removed; "deleting" an account just flips this to 0.
    status = Column(Integer, nullable=False, default=STATUS_VISIBLE, index=True)
    # True for every Google-authenticated account (google_sub is not
    # None) - Google's own OAuth verification of the email address is
    # itself proof of ownership, so re-verifying would be redundant.
    # False by default for a fresh email/password signup until they
    # complete the emailed-code flow (see models/email_verification_code.py
    # and /api/auth/verify-email in app.py) - /api/auth/login refuses to
    # log in an unverified account (see that route's own check).
    email_verified = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    documents = relationship("Document", back_populates="owner", cascade="all, delete-orphan")
    events = relationship("UserEvent", back_populates="user", cascade="all, delete-orphan")
    saved_charts = relationship("SavedChart", back_populates="owner", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User id={self.id} email={self.email} role={self.role} status={self.status}>"

    def to_public_dict(self):
        """Fields safe to send to the client. google_sub/password_hash are
        intentionally excluded (has_password/google_linked below expose
        just their presence, not the values themselves)."""
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "picture_url": self.picture_url,
            "role": self.role,
            "has_password": self.password_hash is not None,
            "google_linked": self.google_sub is not None,
            "email_verified": self.email_verified,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ---------- CRUD ----------

def create_user(email, google_sub=None, password_hash=None, name=None, picture_url=None, role=ROLE_BASIC):
    """
    Create and persist a new user with status=1 (visible) and, by
    default, role=ROLE_BASIC. Either google_sub (Google sign-in) or
    password_hash (email/password sign-up) should be provided, but this
    isn't enforced at the DB level so both auth methods can share a
    table. Returns the created User.

    `role` should stay at its default for anything reachable from a
    public sign-in/sign-up flow — app.py never passes it explicitly for
    exactly this reason.
    """
    session = Session()
    try:
        user = User(
            google_sub=google_sub,
            email=email,
            password_hash=password_hash,
            name=name,
            picture_url=picture_url,
            role=role,
            status=STATUS_VISIBLE,
            # Google's own OAuth flow already verified this email - see
            # this column's own comment above.
            email_verified=(google_sub is not None),
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user
    finally:
        session.close()


def get_user(user_id, include_hidden=False):
    """
    Fetch a single user by id. By default only a status=1 (visible)
    user is returned; pass include_hidden=True to also match status=0
    (hidden) users. Returns User or None.
    """
    session = Session()
    try:
        query = session.query(User).filter(User.id == user_id)
        if not include_hidden:
            query = query.filter(User.status == STATUS_VISIBLE)
        return query.first()
    finally:
        session.close()


def get_user_by_google_sub(google_sub, include_hidden=False):
    """
    Fetch a single user by their Google sub. By default only a status=1
    (visible) user is returned. Returns User or None.
    """
    session = Session()
    try:
        query = session.query(User).filter(User.google_sub == google_sub)
        if not include_hidden:
            query = query.filter(User.status == STATUS_VISIBLE)
        return query.first()
    finally:
        session.close()


def get_user_by_email(email, include_hidden=False):
    """
    Fetch a single user by email. By default only a status=1 (visible)
    user is returned. Returns User or None.
    """
    session = Session()
    try:
        query = session.query(User).filter(User.email == email)
        if not include_hidden:
            query = query.filter(User.status == STATUS_VISIBLE)
        return query.first()
    finally:
        session.close()


def get_all_users(include_hidden=False, limit=DEFAULT_PAGE_SIZE, offset=0, search=None):
    """
    Fetch a page of users, newest first. By default only status=1
    (visible) users are returned; pass include_hidden=True to also get
    status=0 (hidden) ones. limit is clamped to [1, MAX_PAGE_SIZE] here
    (not just at the route layer), so this can never return an
    unbounded result even if a future caller forgets to page.

    search, if given, filters to users whose name OR email contains it
    (case-insensitive substring match) - powers the admin Control
    panel's Access Level search bar. Applied before total is counted,
    so pagination reflects the filtered set, not every user.

    Returns (users, total) where total is the full matching count
    before paging.
    """
    limit = clamp_limit(limit)
    offset = clamp_offset(offset)
    session = Session()
    try:
        query = session.query(User)
        if not include_hidden:
            query = query.filter(User.status == STATUS_VISIBLE)
        if search:
            like = f"%{search.strip()}%"
            query = query.filter(or_(User.name.ilike(like), User.email.ilike(like)))
        total = query.count()
        users = query.order_by(User.id.desc()).offset(offset).limit(limit).all()
        return users, total
    finally:
        session.close()


def update_user(user_id, **fields):
    """
    Update fields on a user (e.g. update_user(1, name="New Name")).
    Returns the updated User, or None if not found.
    """
    session = Session()
    try:
        user = session.query(User).filter(User.id == user_id).first()
        if user is None:
            return None
        for key, value in fields.items():
            if hasattr(user, key):
                setattr(user, key, value)
        session.commit()
        session.refresh(user)
        return user
    finally:
        session.close()


def delete_user(user_id):
    """
    Soft-delete a user: sets status to 0 (hidden) rather than removing
    the row. Their documents and event history both stay intact.
    Returns True if found and hidden, False if not found.
    """
    session = Session()
    try:
        user = session.query(User).filter(User.id == user_id).first()
        if user is None:
            return False
        user.status = STATUS_HIDDEN
        session.commit()
        return True
    finally:
        session.close()


def restore_user(user_id):
    """
    Undo a soft delete: sets status back to 1 (visible).
    Returns True if found and restored, False if not found.
    """
    session = Session()
    try:
        user = session.query(User).filter(User.id == user_id).first()
        if user is None:
            return False
        user.status = STATUS_VISIBLE
        session.commit()
        return True
    finally:
        session.close()


def hard_delete_user(user_id):
    """
    Permanently removes a user row from the database (bypasses the
    soft-delete). Use sparingly, e.g. for admin cleanup or GDPR-style
    erasure requests. Returns True if deleted, False if not found.
    """
    session = Session()
    try:
        user = session.query(User).filter(User.id == user_id).first()
        if user is None:
            return False
        session.delete(user)
        session.commit()
        return True
    finally:
        session.close()