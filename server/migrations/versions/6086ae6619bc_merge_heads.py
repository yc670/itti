"""merge heads: composite indexes + email verification

Two migration chains diverged from a shared ancestor (9dd9f4e91099,
"add password reset codes") after work landed independently on two
branches that were later merged back together:
  - 9be8486b4b71 -> fe0cfad5b3ab (composite indexes on reports/
    notifications, from a performance audit)
  - c1a9ddadbaec -> 8797e68b757e (report deletion workflow, then
    email verification, from this session's work)

Both are legitimate, independent, non-overlapping schema changes
(different tables/columns) - this merge revision just gives Alembic a
single head again so `alembic upgrade head` is unambiguous. No DDL of
its own.

Revision ID: 6086ae6619bc
Revises: 8797e68b757e, fe0cfad5b3ab
Create Date: 2026-08-23 00:00:00.000000

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = '6086ae6619bc'
down_revision: Union[str, Sequence[str], None] = ('8797e68b757e', 'fe0cfad5b3ab')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
