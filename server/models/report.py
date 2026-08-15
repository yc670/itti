"""
Report model and CRUD functions.

Reports are public site content (unlike Document, which is a user's
private uploaded files) - a publisher/admin uploads a title,
description, a PDF/DOCX file, and an optional cover image. Before a
report appears on the public Reports page, it must clear peer review:

  pending_review --(3 distinct approvals at the current version)--> published
  pending_review --(any single reject, with a required comment)--> changes_requested
  changes_requested --(uploader resubmits: new file/description and an
                        optional note addressing the reviewer's comment)--> pending_review, version += 1

A rejection does not delete the report or its review history - it just
sends it back to the uploader. Approvals are scoped to `version`, so a
resubmission automatically starts review over: the 3-approval count for
the new version excludes reviews cast against the old one, without
having to delete or overwrite that history (see models/report_review.py).

status (soft-delete, 1=visible/0=hidden) is a SEPARATE concern from
review_status - a report can be hidden at any point in either review
state, and hiding it never affects its review progress.
"""

from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, BigInteger
from sqlalchemy.orm import relationship

from .database import Base, Session
from pagination import DEFAULT_PAGE_SIZE, clamp_limit, clamp_offset

STATUS_VISIBLE = 1
STATUS_HIDDEN = 0

REVIEW_STATUS_PENDING = "pending_review"
REVIEW_STATUS_CHANGES_REQUESTED = "changes_requested"
REVIEW_STATUS_PUBLISHED = "published"
# Terminal state reached once REQUIRED_REJECTIONS distinct reviewers
# reject the current version (or a single admin rejects) - see
# record_review() in report_review.py. Distinct from
# REVIEW_STATUS_CHANGES_REQUESTED (legacy: a single reject sending a
# report back for resubmission) - REJECTED reports are pulled from
# every peer-review queue for good and are not resubmittable; the
# uploader can still see them (with reviewer comments) and delete them
# from their own Publications/personal peer-review list.
REVIEW_STATUS_REJECTED = "rejected"

REQUIRED_APPROVALS = 3
# Distinct reject decisions at the current version that pull a report
# from review entirely (see record_review()). Deliberately lower than
# REQUIRED_APPROVALS - publishing something is meant to be harder than
# stopping it.
REQUIRED_REJECTIONS = 2

# The 10 fixed sections the public Reports page is organized into. Order
# here is the display/navigation order (not alphabetical) - it's also
# the order the Reports page falls back to when a section has no
# reports yet, so reviewers/uploaders see them in a stable sequence.
# Stored on Report.category as plain text (not a DB enum) so adding an
# 11th section later is a constant change here, not a migration.
REPORT_CATEGORIES = [
    "National Trauma Assessment",
    "Truth & Reconciliation Proposal",
    "Conflict Mapping Report",
    "Policy White Paper",
    "Trauma Observatory Dashboard",
    "Institutional Reform Blueprint",
    "Research Publication",
    "Documentary/Media Project",
    "School Mental Health Model",
    "Refugee Intervention Framework",
]
DEFAULT_REPORT_CATEGORY = REPORT_CATEGORIES[0]


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    # Set only when resubmitting after changes_requested - the uploader's
    # note to reviewers about what they changed. Null on a first submission.
    resubmission_note = Column(Text, nullable=True)

    file_path = Column(String, nullable=False)
    file_type = Column(String, nullable=False)  # "pdf" or "docx", derived from the upload's extension
    file_size_bytes = Column(BigInteger, nullable=True)
    original_filename = Column(String, nullable=False)

    # All nullable: the cover image is optional at upload time.
    image_path = Column(String, nullable=True)
    image_mime_type = Column(String, nullable=True)

    # 1 = visible (default), 0 = hidden (soft-deleted). Independent of
    # review_status - see module docstring.
    status = Column(Integer, nullable=False, default=STATUS_VISIBLE, index=True)

    review_status = Column(String, nullable=False, default=REVIEW_STATUS_PENDING, index=True)
    # Bumped on every resubmission. Reviews are scoped to the version
    # they were cast against - see report_review.py's approval count.
    version = Column(Integer, nullable=False, default=1)

    # One of REPORT_CATEGORIES - which of the 10 fixed sections this
    # report belongs to on the public Reports page. Not a resubmission
    # field: unlike title/description, the category isn't something a
    # reviewer sends back for revision, so resubmit_report() doesn't
    # touch it.
    category = Column(String, nullable=False, default=DEFAULT_REPORT_CATEGORY, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    uploader = relationship("User")

    def __repr__(self):
        return f"<Report id={self.id} title={self.title!r} review_status={self.review_status} v{self.version}>"

    def to_public_dict(self, author_name=None):
        """
        Fields safe to send to the client for the Reports / Peer Review
        pages. "author" is the uploader's display name (never their raw
        id).

        Deliberately does NOT read self.uploader here: to_public_dict()
        is frequently called after the session that loaded this Report
        has already closed (e.g. right after create_report() returns),
        and a lazy-loaded relationship access at that point raises
        sqlalchemy.orm.exc.DetachedInstanceError. get_author_name()
        below opens its own short-lived session instead, so this method
        is always safe to call regardless of session state.

        author_name: pass this in to skip the get_author_name() lookup
        entirely - see reports_to_public_dicts() below, which batches
        that lookup once for a whole list instead of once per report.
        Leave it unset for a single report; the per-call query is
        harmless at that point.
        """
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "resubmission_note": self.resubmission_note,
            "file_type": self.file_type,
            "file_size_bytes": self.file_size_bytes,
            "original_filename": self.original_filename,
            "has_image": self.image_path is not None,
            "uploaded_by": self.uploaded_by,
            "author": author_name if author_name is not None else get_author_name(self.uploaded_by),
            "review_status": self.review_status,
            "version": self.version,
            "category": self.category,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


def get_author_name(user_id):
    """
    Resolves a user id to a display name via its own short-lived
    session, specifically so Report.to_public_dict() never depends on
    an already-loaded relationship staying attached to a session that
    may have since closed. Returns "Unknown" if the user can't be
    found (e.g. hard-deleted) rather than raising.
    """
    from .user import User  # local import: avoids a user.py <-> report.py circular import at module load time

    session = Session()
    try:
        user = session.query(User).filter(User.id == user_id).first()
        return user.name if user and user.name else "Unknown"
    finally:
        session.close()


def reports_to_public_dicts(reports):
    """
    Same output as [r.to_public_dict() for r in reports], but resolves
    every report's author name with one batched query instead of one
    query per report. to_public_dict() opening a fresh session per call
    is deliberate (see its docstring) and fine for a single report or a
    handful, but every list-returning route (GET /api/reports and
    friends) was paying for N extra round-trip queries just to render
    author names for a page of N reports. Use this wherever a *list* of
    reports gets serialized; to_public_dict() directly is still right
    for a single report.
    """
    from .user import User  # local import: avoids a user.py <-> report.py circular import at module load time

    user_ids = {r.uploaded_by for r in reports if r.uploaded_by is not None}
    names_by_id = {}
    if user_ids:
        session = Session()
        try:
            rows = session.query(User.id, User.name).filter(User.id.in_(user_ids)).all()
            names_by_id = {row.id: row.name for row in rows}
        finally:
            session.close()

    return [
        r.to_public_dict(author_name=names_by_id.get(r.uploaded_by, "Unknown") if r.uploaded_by is not None else "Unknown")
        for r in reports
    ]


# ---------- CRUD ----------

def create_report(uploaded_by, title, description, file_path, file_type,
                   original_filename, category=DEFAULT_REPORT_CATEGORY, file_size_bytes=None,
                   image_path=None, image_mime_type=None):
    """
    Create and persist a brand-new report (version=1, status=visible,
    review_status=pending_review) - it lands on the Peer Review page,
    not the public Reports page, until it clears review. `category`
    must be one of REPORT_CATEGORIES - callers (app.py) validate this
    before calling in, so it's trusted here. Returns the created Report.
    """
    session = Session()
    try:
        report = Report(
            uploaded_by=uploaded_by,
            title=title,
            description=description,
            file_path=file_path,
            file_type=file_type,
            original_filename=original_filename,
            file_size_bytes=file_size_bytes,
            image_path=image_path,
            image_mime_type=image_mime_type,
            status=STATUS_VISIBLE,
            review_status=REVIEW_STATUS_PENDING,
            version=1,
            category=category,
        )
        session.add(report)
        session.commit()
        session.refresh(report)
        return report
    finally:
        session.close()


def resubmit_report(report_id, title=None, description=None, resubmission_note=None,
                     file_path=None, file_type=None, original_filename=None,
                     file_size_bytes=None, image_path=None, image_mime_type=None):
    """
    Applies an uploader's resubmission after changes_requested: updates
    whichever fields are provided, sets resubmission_note, bumps
    version, and resets review_status to pending_review. Old
    ReportReview rows are left untouched (still on record) but no
    longer count toward the new version's approval total. Returns the
    updated Report, or None if not found.
    """
    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            return None

        if title is not None:
            report.title = title
        if description is not None:
            report.description = description
        report.resubmission_note = resubmission_note
        if file_path is not None:
            report.file_path = file_path
            report.file_type = file_type
            report.original_filename = original_filename
            report.file_size_bytes = file_size_bytes
        if image_path is not None:
            report.image_path = image_path
            report.image_mime_type = image_mime_type

        report.version += 1
        report.review_status = REVIEW_STATUS_PENDING

        session.commit()
        session.refresh(report)
        return report
    finally:
        session.close()


def get_report(report_id):
    """Fetch a single report by id, regardless of status/review_status. Returns Report or None."""
    session = Session()
    try:
        return session.query(Report).filter(Report.id == report_id).first()
    finally:
        session.close()


def get_published_reports(include_hidden=False, limit=DEFAULT_PAGE_SIZE, offset=0):
    """
    Fetch a page of PUBLISHED reports, newest first - what the public
    Reports page shows. By default only status=1 (visible) reports are
    returned; pass include_hidden=True to also get status=0 (hidden)
    ones. limit is always clamped to [1, MAX_PAGE_SIZE] here (not just
    at the route layer), so this can never return an unbounded result
    even if a future caller forgets to page. Returns (reports, total)
    where total is the full matching count before paging.
    """
    limit = clamp_limit(limit)
    offset = clamp_offset(offset)
    session = Session()
    try:
        query = session.query(Report).filter(Report.review_status == REVIEW_STATUS_PUBLISHED)
        if not include_hidden:
            query = query.filter(Report.status == STATUS_VISIBLE)
        total = query.count()
        reports = query.order_by(Report.created_at.desc()).offset(offset).limit(limit).all()
        return reports, total
    finally:
        session.close()


def get_pending_reports(include_hidden=False, limit=DEFAULT_PAGE_SIZE, offset=0):
    """
    Fetch a page of reports with review_status=pending_review, oldest
    first (so the longest-waiting submissions surface first on the Peer
    Review page). limit is clamped as in get_published_reports().
    Returns (reports, total).
    """
    limit = clamp_limit(limit)
    offset = clamp_offset(offset)
    session = Session()
    try:
        query = session.query(Report).filter(Report.review_status == REVIEW_STATUS_PENDING)
        if not include_hidden:
            query = query.filter(Report.status == STATUS_VISIBLE)
        total = query.count()
        reports = query.order_by(Report.created_at.asc()).offset(offset).limit(limit).all()
        return reports, total
    finally:
        session.close()


def get_changes_requested_reports(include_hidden=False, limit=DEFAULT_PAGE_SIZE, offset=0):
    """
    Fetch a page of reports with review_status=changes_requested, newest
    first (most recently rejected at the top). Shown in a separate
    section on the Peer Review page rather than mixed with
    pending_review, per product decision - visible to reviewers so they
    can see what's stalled, but not counted toward anyone's review
    queue. limit is clamped as in get_published_reports(). Returns
    (reports, total).
    """
    limit = clamp_limit(limit)
    offset = clamp_offset(offset)
    session = Session()
    try:
        query = session.query(Report).filter(Report.review_status == REVIEW_STATUS_CHANGES_REQUESTED)
        if not include_hidden:
            query = query.filter(Report.status == STATUS_VISIBLE)
        total = query.count()
        reports = query.order_by(Report.updated_at.desc()).offset(offset).limit(limit).all()
        return reports, total
    finally:
        session.close()


def get_reports_by_uploader(user_id, include_hidden=False):
    """Fetch reports uploaded by a given user, newest first, any review_status. Returns a list of Report."""
    session = Session()
    try:
        query = session.query(Report).filter(Report.uploaded_by == user_id)
        if not include_hidden:
            query = query.filter(Report.status == STATUS_VISIBLE)
        return query.order_by(Report.created_at.desc()).all()
    finally:
        session.close()


def get_all_reports(search=None, category=None, limit=DEFAULT_PAGE_SIZE, offset=0):
    """
    Fetch a page of reports across EVERY review_status (pending,
    changes_requested, published, rejected), newest first - unlike
    every other list_* function above, which is scoped to one review
    stage for a specific page (public Reports page, Peer Review queue,
    etc). This backs the admin Control tab's "recategorize an existing
    report" tool, where an admin needs to find and fix a report
    regardless of what stage it's in - the category bug this exists to
    correct (see upload_report()'s history) affected reports at every
    review status equally, since it happened at creation time.

    search, if given, does a case-insensitive substring match against
    title only (not description - description matches would surface
    too many irrelevant reports for what's meant to be a quick
    find-by-name tool). category, if given, filters to exactly that
    section - lets an admin browse "everything currently miscategorized
    as National Trauma Assessment" directly rather than paging through
    all reports. include_hidden is intentionally NOT a parameter here
    (unlike the other get_*_reports functions) - always includes
    hidden reports, since a hidden report can still have the wrong
    category and an admin fixing categories shouldn't have hidden ones
    invisible to them. Returns (reports, total).
    """
    limit = clamp_limit(limit)
    offset = clamp_offset(offset)
    session = Session()
    try:
        query = session.query(Report)
        if search:
            query = query.filter(Report.title.ilike(f"%{search}%"))
        if category:
            query = query.filter(Report.category == category)
        total = query.count()
        reports = query.order_by(Report.created_at.desc()).offset(offset).limit(limit).all()
        return reports, total
    finally:
        session.close()


def set_report_category(report_id, category):
    """
    Updates just a report's category, independent of its review status
    or version - unlike resubmit_report(), this doesn't touch
    review_status/version/file at all, since recategorizing isn't a
    content change and shouldn't send an already-published report back
    through peer review. Caller (the route) is responsible for
    validating `category` is one of REPORT_CATEGORIES before calling
    this - this function trusts its input, same as create_report()
    does. Returns the updated Report, or None if not found.
    """
    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            return None
        report.category = category
        report.updated_at = datetime.utcnow()
        session.commit()
        session.refresh(report)
        return report
    finally:
        session.close()


def delete_report(report_id):
    """
    Soft-delete a report: sets status to 0 (hidden) rather than removing
    the row. The files on disk/storage both stay intact. Returns True if
    found and hidden, False if not found.
    """
    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            return False
        report.status = STATUS_HIDDEN
        session.commit()
        return True
    finally:
        session.close()


def restore_report(report_id):
    """Undo a soft delete: sets status back to 1 (visible). Returns True if found and restored."""
    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            return False
        report.status = STATUS_VISIBLE
        session.commit()
        return True
    finally:
        session.close()


def hard_delete_report(report_id):
    """
    Permanently removes a report row from the database (bypasses the
    soft-delete). Use sparingly, e.g. for admin cleanup jobs. Returns
    True if deleted, False if not found.
    """
    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            return False
        session.delete(report)
        session.commit()
        return True
    finally:
        session.close()