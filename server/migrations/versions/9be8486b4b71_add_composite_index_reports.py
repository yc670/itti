"""add composite index on reports (review_status, status)

Revision ID: 9be8486b4b71
Revises: 9dd9f4e91099
Create Date: 2026-08-17 00:00:00.000000

get_published_reports(), get_pending_reports(), and
get_changes_requested_reports() (server/models/report.py) all filter
on review_status AND status together - e.g.
"WHERE review_status = 'published' AND status = 1" - which are the
three queries behind GET /api/reports, /api/reports/pending, and
/api/reports/changes-requested respectively. Each column already has
its own single-column index (added by earlier migrations, matching
index=True on the model), but a query filtering on two columns can
only make full use of one single-column index at a time on SQLite (no
automatic index merge) and gets a less efficient bitmap-merge on
Postgres rather than a direct index seek - both still have to filter
the *other* column's matches by scanning/re-checking rows one at a
time. A composite index covering both columns together lets the
database satisfy the whole WHERE clause with a single index seek
instead.

Column order is (review_status, status) rather than the reverse:
review_status is the more selective/primary differentiator between
these three query functions (four distinct values as of the
deletion-request workflow: pending_review, published,
changes_requested, deletion_requested), while status is close to a
constant across the table in practice (nearly every row is
STATUS_VISIBLE=1; STATUS_HIDDEN is the rare case) - putting the more
selective column first is what lets a B-tree composite index narrow
the search space the most before the second column even comes into
play.

Not attempting to also cover each function's ORDER BY (created_at
DESC / created_at ASC / updated_at DESC respectively) in the same
index - three different trailing sort columns would need three
separate composite indexes to each act as a fully covering index for
its one query, which is a real write-amplification/disk cost for a
site this size with no evidence yet that the sort step itself (rather
than the initial WHERE-clause table scan this migration fixes) is a
bottleneck. Worth revisiting if the reports table grows very large
and profiling says otherwise.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '9be8486b4b71'
down_revision: Union[str, None] = '9dd9f4e91099'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_reports_review_status_status', 'reports', ['review_status', 'status'], unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_reports_review_status_status', table_name='reports')
