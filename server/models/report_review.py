"""
ReportReview model and the peer-review decision workflow.

One row per (report, reviewer, version) - a reviewer can cast exactly
one decision per version of a report, but a NEW version (after the
uploader resubmits following changes_requested) can be reviewed again
from scratch, since the file/description actually changed.

record_review() is the single entry point that enforces every rule in
one place:
  - the uploader cannot review their own report, admin included -
    self-review isn't a "faster path", it's just not allowed
  - a reviewer cannot submit twice for the same version (they can
    change their mind by calling record_review() again, which updates
    their existing row rather than creating a duplicate)
  - a reject requires a comment
  - an approve recount happens after every non-admin approval; the
    REQUIRED_APPROVALS-th distinct approval at the current version
    auto-publishes the report
  - a reject recount happens after every non-admin reject; the
    REQUIRED_REJECTIONS-th distinct reject at the current version
    pulls the report from review entirely (review_status = rejected) -
    it disappears from every peer-review queue for good. A single
    reject alone just adds a comment and leaves the report pending,
    so a second reviewer still needs to weigh in before anything
    changes.
  - an admin's decision is decisive on its own - is_admin=True
    publishes on approve or rejects on reject, immediately, without
    needing a second vote either way
  - every outcome (published or rejected) notifies the report's
    uploader via models.notification, so they don't have to keep
    re-checking their own Publications list
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint

from .database import Base, Session
from .report import (
    Report, REQUIRED_APPROVALS, REQUIRED_REJECTIONS, get_author_name,
    REVIEW_STATUS_PUBLISHED, REVIEW_STATUS_REJECTED, REVIEW_STATUS_PENDING,
    REVIEW_STATUS_DELETION_REQUESTED, delete_report, cancel_deletion_request,
)
from .notification import (
    create_notification, TYPE_REPORT_PUBLISHED, TYPE_REPORT_REJECTED,
    TYPE_REPORT_DELETION_APPROVED, TYPE_REPORT_DELETION_DENIED,
)

DECISION_APPROVE = "approve"
DECISION_REJECT = "reject"


class ReportReview(Base):
    __tablename__ = "report_reviews"
    __table_args__ = (
        UniqueConstraint("report_id", "reviewer_id", "version", name="uq_report_reviewer_version"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=False, index=True)
    reviewer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)

    decision = Column(String, nullable=False)
    comment = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_public_dict(self, reviewer_name=None):
        """
        reviewer_name: pass this in to skip the get_author_name() lookup
        entirely - see reviews_to_public_dicts() below, which batches
        that lookup once for a whole list instead of once per review
        (same pattern/reasoning as Report.to_public_dict() and
        reports_to_public_dicts() in report.py). Leave it unset for a
        single review; the per-call query is harmless at that point.
        """
        return {
            "id": self.id,
            "report_id": self.report_id,
            "reviewer_id": self.reviewer_id,
            "reviewer_name": reviewer_name if reviewer_name is not None else get_author_name(self.reviewer_id),
            "version": self.version,
            "decision": self.decision,
            "comment": self.comment,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


def reviews_to_public_dicts(reviews):
    """
    Same output as [r.to_public_dict() for r in reviews], but resolves
    every review's reviewer name with one batched query instead of one
    query per review - a report accumulates one review row per version
    it goes through, so GET /api/reports/<id>/reviews was paying for N
    extra round-trip queries just to render reviewer names for a
    report's review history.
    """
    from .user import User  # local import: avoids a user.py <-> report_review.py circular import at module load time

    reviewer_ids = {r.reviewer_id for r in reviews if r.reviewer_id is not None}
    names_by_id = {}
    if reviewer_ids:
        session = Session()
        try:
            rows = session.query(User.id, User.name).filter(User.id.in_(reviewer_ids)).all()
            names_by_id = {row.id: row.name for row in rows}
        finally:
            session.close()

    return [
        r.to_public_dict(reviewer_name=names_by_id.get(r.reviewer_id, "Unknown") if r.reviewer_id is not None else "Unknown")
        for r in reviews
    ]


class ReviewError(ValueError):
    """Raised for any rule violation in record_review() - message is always safe to show the reviewer."""


def record_review(report_id, reviewer_id, decision, comment=None, is_admin=False):
    """
    Records a reviewer's decision on a report's CURRENT version, then
    applies the resulting workflow transition:
      - reject, is_admin=True -> review_status = rejected immediately,
        bypassing the distinct-rejection count entirely
      - reject, is_admin=False -> if this is now the
        REQUIRED_REJECTIONS-th distinct reject at the current version,
        review_status = rejected; otherwise the report stays pending
        (the comment is recorded and visible, but nothing else changes
        yet - a second reviewer still needs to weigh in)
      - approve, is_admin=True -> review_status = published
        immediately, bypassing the distinct-approval count entirely
      - approve, is_admin=False -> if this is now the
        REQUIRED_APPROVALS-th distinct approval at the current
        version, review_status = published

    Reaching either terminal state (published or rejected) creates a
    Notification for the report's uploader (models.notification) -
    this is the only place that happens, so every path there notifies
    them, whether it took one admin decision or several publisher ones.

    Raises ReviewError (safe, user-facing message) on any rule
    violation. Returns the updated Report.
    """
    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            raise ReviewError("Report not found.")

        if report.review_status != REVIEW_STATUS_PENDING:
            raise ReviewError("This report isn't currently awaiting review.")

        if report.uploaded_by == reviewer_id:
            raise ReviewError("You cannot review your own submission.")

        if decision not in (DECISION_APPROVE, DECISION_REJECT):
            raise ReviewError("Decision must be 'approve' or 'reject'.")

        if decision == DECISION_REJECT and not (comment and comment.strip()):
            raise ReviewError("A comment is required when requesting changes.")

        existing = (
            session.query(ReportReview)
            .filter(
                ReportReview.report_id == report_id,
                ReportReview.reviewer_id == reviewer_id,
                ReportReview.version == report.version,
            )
            .first()
        )
        if existing is not None:
            existing.decision = decision
            existing.comment = comment
            existing.created_at = datetime.utcnow()
        else:
            session.add(ReportReview(
                report_id=report_id,
                reviewer_id=reviewer_id,
                version=report.version,
                decision=decision,
                comment=comment,
            ))
        session.commit()

        title = report.title
        uploaded_by = report.uploaded_by

        if decision == DECISION_REJECT:
            reject_now = is_admin
            if not reject_now:
                reject_count = (
                    session.query(ReportReview)
                    .filter(
                        ReportReview.report_id == report_id,
                        ReportReview.version == report.version,
                        ReportReview.decision == DECISION_REJECT,
                    )
                    .count()
                )
                reject_now = reject_count >= REQUIRED_REJECTIONS

            if reject_now:
                report.review_status = REVIEW_STATUS_REJECTED
                session.commit()
                create_notification(
                    user_id=uploaded_by,
                    report_id=report_id,
                    type=TYPE_REPORT_REJECTED,
                    message=f'"{title}" was not approved by peer review and has been removed from the queue. '
                            f'See the reviewer comments on your Peer Review page.',
                )
        else:
            publish_now = is_admin
            if not publish_now:
                approval_count = (
                    session.query(ReportReview)
                    .filter(
                        ReportReview.report_id == report_id,
                        ReportReview.version == report.version,
                        ReportReview.decision == DECISION_APPROVE,
                    )
                    .count()
                )
                publish_now = approval_count >= REQUIRED_APPROVALS

            if publish_now:
                report.review_status = REVIEW_STATUS_PUBLISHED
                session.commit()
                create_notification(
                    user_id=uploaded_by,
                    report_id=report_id,
                    type=TYPE_REPORT_PUBLISHED,
                    message=f'"{title}" has been published.',
                )

        session.refresh(report)
        return report
    finally:
        session.close()


def get_reviews_for_report(report_id, version=None):
    """Returns all ReportReview rows for a report, newest first, optionally scoped to one version."""
    session = Session()
    try:
        query = session.query(ReportReview).filter(ReportReview.report_id == report_id)
        if version is not None:
            query = query.filter(ReportReview.version == version)
        return query.order_by(ReportReview.created_at.desc()).all()
    finally:
        session.close()


def get_approval_count(report_id, version):
    """Returns the number of distinct approvals for a report at a specific version."""
    session = Session()
    try:
        return (
            session.query(ReportReview)
            .filter(
                ReportReview.report_id == report_id,
                ReportReview.version == version,
                ReportReview.decision == DECISION_APPROVE,
            )
            .count()
        )
    finally:
        session.close()


def get_reject_count(report_id, version):
    """Returns the number of distinct rejects for a report at a specific version."""
    session = Session()
    try:
        return (
            session.query(ReportReview)
            .filter(
                ReportReview.report_id == report_id,
                ReportReview.version == version,
                ReportReview.decision == DECISION_REJECT,
            )
            .count()
        )
    finally:
        session.close()


def get_reviewer_decision(report_id, reviewer_id, version):
    """Returns this reviewer's existing decision for a report's current version, or None if they haven't reviewed it yet."""
    session = Session()
    try:
        review = (
            session.query(ReportReview)
            .filter(
                ReportReview.report_id == report_id,
                ReportReview.reviewer_id == reviewer_id,
                ReportReview.version == version,
            )
            .first()
        )
        return review.decision if review else None
    finally:
        session.close()


class DeletionReviewError(ValueError):
    """Raised for any rule violation in record_deletion_review() - message is always safe to show the reviewer."""


def record_deletion_review(report_id, reviewer_id, decision):
    """
    Records a reviewer/admin's decision on a PUBLISHER's request to
    delete their own published report (see request_report_deletion()
    in report.py). Unlike record_review() above, this is NOT a vote -
    a single decision, either way, is final immediately:
      - decision="approve" -> delete_report(report_id,
        via="deletion_review") - soft-deletes it, resets
        review_status back to "published" (see that function's own
        comment for why), notifies the uploader
      - decision="deny" -> cancel_deletion_request(report_id) - back to
        "published", stays visible (it never left), notifies the
        uploader

    This does not reuse the ReportReview table at all - that table is
    specifically approve/reject votes toward PUBLISHING a report
    (scoped by version, counted toward REQUIRED_APPROVALS/
    REQUIRED_REJECTIONS), a fundamentally different decision from
    "should this already-published report be taken down". No new table
    is needed for the (much simpler) one-decision-is-final deletion
    case - report.py's pending_deletion_reason /
    pending_deletion_requested_at already capture what's asked, and the
    outcome is just the review_status transition itself; there's no
    history of multiple reviewers' individual votes to preserve the way
    ReportReview preserves them for publishing.

    Raises DeletionReviewError (safe, user-facing message) if the
    report isn't currently deletion_requested, or if the requester is
    the report's own uploader (self-review isn't allowed here either,
    same rule as record_review() - the whole point of this tier is a
    second set of eyes). Returns the updated Report.
    """
    if decision not in (DECISION_APPROVE, "deny"):
        raise DeletionReviewError("Decision must be 'approve' or 'deny'.")

    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            raise DeletionReviewError("Report not found.")
        if report.review_status != REVIEW_STATUS_DELETION_REQUESTED:
            raise DeletionReviewError("This report isn't currently awaiting a deletion decision.")
        if report.uploaded_by == reviewer_id:
            raise DeletionReviewError("You cannot decide a deletion request on your own report.")

        title = report.title
        uploaded_by = report.uploaded_by
    finally:
        session.close()

    if decision == DECISION_APPROVE:
        delete_report(report_id, via="deletion_review")
        create_notification(
            user_id=uploaded_by,
            report_id=report_id,
            type=TYPE_REPORT_DELETION_APPROVED,
            message=f'Your request to delete "{title}" was approved. It has been removed from the public Reports page.',
        )
    else:
        cancel_deletion_request(report_id)
        create_notification(
            user_id=uploaded_by,
            report_id=report_id,
            type=TYPE_REPORT_DELETION_DENIED,
            message=f'Your request to delete "{title}" was denied. It remains published.',
        )

    session = Session()
    try:
        return session.query(Report).filter(Report.id == report_id).first()
    finally:
        session.close()