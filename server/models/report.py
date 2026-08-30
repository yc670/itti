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

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, BigInteger, or_
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
# A publisher has asked to delete their own PUBLISHED report and given
# a reason (see request_report_deletion() below) - the report stays
# visible on the public Reports page (deliberately, per product
# decision - deleting a live report isn't something one person should
# be able to do unilaterally, even to their own work, without another
# set of eyes) until a reviewer/admin decides. Unlike the
# publish workflow's 3-approval/2-rejection vote counting, exactly ONE
# reviewer/admin decision is final either way - see
# record_deletion_review() in report_review.py. Only reachable FROM
# "published" (see request_report_deletion()'s own guard) - a report
# still mid-review (pending_review/changes_requested) has never gone
# public yet, so its uploader can keep using the ordinary instant
# soft-delete for it instead of going through this queue.
REVIEW_STATUS_DELETION_REQUESTED = "deletion_requested"

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

    # Set only while review_status == REVIEW_STATUS_DELETION_REQUESTED -
    # the publisher's required explanation for why they want their own
    # published report taken down (see request_report_deletion()).
    # Stays populated after the request resolves (approved or denied)
    # as a record of what was asked and why - only cleared if the
    # report is later un-deleted (see restore_report()), since at that
    # point the old reason no longer describes the report's current
    # state.
    pending_deletion_reason = Column(Text, nullable=True)
    pending_deletion_requested_at = Column(DateTime, nullable=True)

    # Set only when status flips to STATUS_HIDDEN (soft-deleted) on an
    # already-PUBLISHED report - null for a report that's never been
    # published, or one still visible. Tracks HOW it got soft-deleted,
    # for the admin Deleted Reports page (see get_deleted_reports()):
    #   "deletion_review" - a publisher requested it, a reviewer/admin approved it
    #   "admin"            - an admin used the ordinary instant soft-delete on it
    # Deliberately NOT cleared by restore_report() (unlike
    # pending_deletion_reason above) - even after a report is reposted,
    # knowing how its last deletion happened is still useful history,
    # and a future re-deletion will just overwrite it with whichever
    # path is used that time.
    deleted_via = Column(String, nullable=True)

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
            "pending_deletion_reason": self.pending_deletion_reason,
            "pending_deletion_requested_at": (
                self.pending_deletion_requested_at.isoformat() if self.pending_deletion_requested_at else None
            ),
            "deleted_via": self.deleted_via,
            "status": self.status,
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


def search_published_reports(query_text, limit=5):
    """
    A lightweight, public search over PUBLISHED+visible reports only -
    matches query_text against title OR description, case-insensitive.
    Backs the sitewide search bar (see SearchBar.jsx) - deliberately a
    separate function from get_published_reports() above rather than
    adding a search= param to it, since that function's contract (used
    by the main Reports page, no search concept there at all) shouldn't
    change shape for a caller that only exists elsewhere.

    Unlike get_all_reports()'s admin search (title-only, any
    review_status), this is intentionally public-safe: only ever
    returns reports every visitor can already see, and searches
    description text too since a sitewide search is more likely to be
    a topic/keyword lookup than someone hunting for an exact title they
    already know. Capped at a small fixed limit (no pagination) - this
    is preview-of-results, not a full report browser; the "see all
    results" link routes to /reports/browse with the same query instead.
    """
    if not query_text or not query_text.strip():
        return []
    session = Session()
    try:
        pattern = f"%{query_text.strip()}%"
        return (
            session.query(Report)
            .filter(
                Report.review_status == REVIEW_STATUS_PUBLISHED,
                Report.status == STATUS_VISIBLE,
                or_(Report.title.ilike(pattern), Report.description.ilike(pattern)),
            )
            .order_by(Report.created_at.desc())
            .limit(limit)
            .all()
        )
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


def get_deletion_requested_reports(limit=DEFAULT_PAGE_SIZE, offset=0):
    """
    Fetch a page of reports with review_status=deletion_requested,
    oldest request first (same "longest waiting first" ordering as
    get_pending_reports() above) - backs the Peer Review page's
    Deletion Requests tab (reviewer/admin only). Deliberately does NOT
    take an include_hidden param, unlike every other get_*_reports
    function here: a deletion-requested report is by definition still
    STATUS_VISIBLE (see request_report_deletion()'s own guard - the
    report stays live on the public Reports page throughout the review
    period, per product decision), so there's nothing hidden to
    optionally include. Returns (reports, total).
    """
    limit = clamp_limit(limit)
    offset = clamp_offset(offset)
    session = Session()
    try:
        query = session.query(Report).filter(Report.review_status == REVIEW_STATUS_DELETION_REQUESTED)
        total = query.count()
        reports = query.order_by(Report.pending_deletion_requested_at.asc()).offset(offset).limit(limit).all()
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


def request_report_deletion(report_id, reason):
    """
    A publisher asking to delete their own PUBLISHED report - records
    the required reason and moves review_status to
    REVIEW_STATUS_DELETION_REQUESTED (see that constant's own comment
    for why the report stays visible throughout, and why this is only
    reachable from "published"). Does NOT check who's calling or
    whether they own the report - the route
    (request_report_deletion_route in app.py) is responsible for both,
    same division of labor as every other model function here.

    Raises ValueError (safe, user-facing message) if the report isn't
    currently published, or if reason is blank - the route turns this
    into a 400. Returns the updated Report.
    """
    if not reason or not reason.strip():
        raise ValueError("A reason is required to request deletion.")

    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            raise ValueError("Report not found.")
        if report.review_status != REVIEW_STATUS_PUBLISHED:
            raise ValueError("Only a published report can be submitted for deletion review.")

        report.review_status = REVIEW_STATUS_DELETION_REQUESTED
        report.pending_deletion_reason = reason.strip()
        report.pending_deletion_requested_at = datetime.utcnow()
        session.commit()
        session.refresh(report)
        return report
    finally:
        session.close()


def cancel_deletion_request(report_id):
    """
    A reviewer/admin denying a deletion request - puts the report back
    to "published" (it never actually left public view - see
    REVIEW_STATUS_DELETION_REQUESTED's own comment) without touching
    pending_deletion_reason/pending_deletion_requested_at, which stay
    as a record of what was asked and denied. Returns the updated
    Report, or None if not found or not currently in
    deletion_requested (the route is responsible for checking that
    before calling, same pattern as request_report_deletion() above -
    this raises ValueError rather than silently no-op'ing so a stale
    double-click can't look like it worked).
    """
    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            raise ValueError("Report not found.")
        if report.review_status != REVIEW_STATUS_DELETION_REQUESTED:
            raise ValueError("This report isn't currently awaiting a deletion decision.")

        report.review_status = REVIEW_STATUS_PUBLISHED
        session.commit()
        session.refresh(report)
        return report
    finally:
        session.close()


def delete_report(report_id, via=None):
    """
    Soft-delete a report: sets status to 0 (hidden) rather than removing
    the row. The files on disk/storage both stay intact.

    via, if given, is recorded on Report.deleted_via ("deletion_review"
    or "admin" - see that column's own comment) for the admin Deleted
    Reports page. Left as None for a soft-delete on a report that was
    never published (pending_review/changes_requested/rejected) - only
    a published report's deletion is meaningful history to track there,
    since get_deleted_reports() below only surfaces reports that were
    live at some point.

    via="deletion_review" additionally resets review_status back to
    REVIEW_STATUS_PUBLISHED - the report was sitting at
    REVIEW_STATUS_DELETION_REQUESTED (see that constant's own comment)
    right up until this call, and "published but hidden" is the same
    state an admin's ordinary instant soft-delete leaves a report in
    (delete_report() called with via="admin" from a report that was
    already published never touched review_status either). This is
    what makes get_deleted_reports()'s "repost" action (just
    restore_report(), flipping status back to visible) correct either
    way, without needing to know which path a given deleted report took.

    Returns True if found and hidden, False if not found.
    """
    session = Session()
    try:
        report = session.query(Report).filter(Report.id == report_id).first()
        if report is None:
            return False
        report.status = STATUS_HIDDEN
        if via is not None:
            report.deleted_via = via
        if via == "deletion_review":
            report.review_status = REVIEW_STATUS_PUBLISHED
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


def get_deleted_reports(search=None, category=None, limit=DEFAULT_PAGE_SIZE, offset=0):
    """
    Fetch a page of soft-deleted (status=hidden) reports that were
    PUBLISHED at some point - i.e. Report.deleted_via is set (either
    "deletion_review" or "admin", see that column's own comment) -
    newest-deleted first. Backs the admin-only Deleted Reports page.

    Deliberately excludes a soft-deleted report whose deleted_via is
    still null - that means it was hidden while still
    pending_review/changes_requested/rejected (never public), which
    isn't "a deleted report" in the sense this page means; it's closer
    to a withdrawn draft. Only reports that were actually live and then
    taken down belong here, per product decision.

    search/category filters and pagination shape match
    get_all_reports() (the admin recategorize tool) - same reasoning,
    this is the same kind of admin utility list. Returns (reports, total).
    """
    limit = clamp_limit(limit)
    offset = clamp_offset(offset)
    session = Session()
    try:
        query = session.query(Report).filter(
            Report.status == STATUS_HIDDEN,
            Report.deleted_via.isnot(None),
        )
        if search:
            query = query.filter(Report.title.ilike(f"%{search}%"))
        if category:
            query = query.filter(Report.category == category)
        total = query.count()
        reports = query.order_by(Report.updated_at.desc()).offset(offset).limit(limit).all()
        return reports, total
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