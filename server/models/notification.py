"""
Notification model and CRUD functions.

Backs the Profile page's Notifications tab. Right now the only
producer is models/report_review.record_review() - a report's uploader
gets one of these when their submission is either published (the
REQUIRED_APPROVALS-th distinct approval, or a single admin approval)
or sent back for changes (any reject), so they don't have to keep
checking their own Publications list to find out.
Written generically enough (type + arbitrary report_id) that other
producers can reuse it later without a schema change.

report_id is nullable and ON DELETE is intentionally not set to
cascade - a notification is a historical record ("this happened at
time T"), so it should keep existing (with a dead link) even if the
report it refers to were ever hard-deleted, rather than disappearing
along with it.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean

from .database import Base, Session
from pagination import DEFAULT_PAGE_SIZE, clamp_limit, clamp_offset

# What record_review() currently sends. Not an exhaustive enum -
# to_public_dict() passes `type` straight through, so a future
# producer can introduce a new one without a migration.
TYPE_REPORT_PUBLISHED = "report_published"
TYPE_REPORT_CHANGES_REQUESTED = "report_changes_requested"
TYPE_REPORT_REJECTED = "report_rejected"
# Sent to the uploader when a reviewer/admin decides their deletion
# request - see record_deletion_review() in report_review.py.
TYPE_REPORT_DELETION_APPROVED = "report_deletion_approved"
TYPE_REPORT_DELETION_DENIED = "report_deletion_denied"


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=True, index=True)
    type = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_public_dict(self):
        return {
            "id": self.id,
            "report_id": self.report_id,
            "type": self.type,
            "message": self.message,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


def create_notification(user_id, message, type, report_id=None):
    session = Session()
    try:
        notification = Notification(
            user_id=user_id, report_id=report_id, type=type, message=message, is_read=False,
        )
        session.add(notification)
        session.commit()
        session.refresh(notification)
        return notification
    finally:
        session.close()


def get_notifications_for_user(user_id, limit=DEFAULT_PAGE_SIZE, offset=0):
    """
    A page of a user's own notifications, newest first. limit is
    clamped to [1, MAX_PAGE_SIZE] here (not just at the route layer),
    matching every other paginated list function in this codebase -
    see pagination.py. Returns (notifications, total).
    """
    limit = clamp_limit(limit)
    offset = clamp_offset(offset)
    session = Session()
    try:
        query = session.query(Notification).filter(Notification.user_id == user_id)
        total = query.count()
        notifications = query.order_by(Notification.created_at.desc()).offset(offset).limit(limit).all()
        return notifications, total
    finally:
        session.close()


def get_unread_count(user_id):
    session = Session()
    try:
        return (
            session.query(Notification)
            .filter(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
            .count()
        )
    finally:
        session.close()


def mark_notification_read(notification_id, user_id):
    """
    Marks one notification read - scoped to user_id so a user can only
    ever mark their own as read, not guess another user's notification
    id. Returns the updated Notification, or None if it doesn't exist
    or isn't this user's.
    """
    session = Session()
    try:
        notification = (
            session.query(Notification)
            .filter(Notification.id == notification_id, Notification.user_id == user_id)
            .first()
        )
        if notification is None:
            return None
        notification.is_read = True
        session.commit()
        session.refresh(notification)
        return notification
    finally:
        session.close()


def mark_all_read(user_id):
    """Marks every unread notification for a user as read. Returns the count updated."""
    session = Session()
    try:
        updated = (
            session.query(Notification)
            .filter(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
            .update({"is_read": True})
        )
        session.commit()
        return updated
    finally:
        session.close()


def mark_notifications_read(notification_ids, user_id):
    """
    Marks a specific set of notifications read - scoped to user_id so a
    user can only ever mark their own as read, mirroring
    mark_notification_read() above but for a bulk selection (e.g. the
    Notifications tab's "select some, then Mark as read" flow). Returns
    the count updated - ids that don't exist or aren't this user's are
    silently ignored rather than erroring, since the client's selection
    could theoretically be stale (e.g. another tab already deleted one).
    """
    if not notification_ids:
        return 0
    session = Session()
    try:
        updated = (
            session.query(Notification)
            .filter(Notification.id.in_(notification_ids), Notification.user_id == user_id)
            .update({"is_read": True}, synchronize_session=False)
        )
        session.commit()
        return updated
    finally:
        session.close()


def delete_notifications(notification_ids, user_id):
    """
    Deletes a specific set of notifications - scoped to user_id, same
    reasoning as mark_notifications_read() above. Returns the count
    deleted.
    """
    if not notification_ids:
        return 0
    session = Session()
    try:
        deleted = (
            session.query(Notification)
            .filter(Notification.id.in_(notification_ids), Notification.user_id == user_id)
            .delete(synchronize_session=False)
        )
        session.commit()
        return deleted
    finally:
        session.close()