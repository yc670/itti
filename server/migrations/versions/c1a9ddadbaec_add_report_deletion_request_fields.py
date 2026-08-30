"""add report deletion request fields

Revision ID: c1a9ddadbaec
Revises: 9dd9f4e91099
Create Date: 2026-08-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a9ddadbaec'
down_revision: Union[str, None] = '9dd9f4e91099'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('reports', sa.Column('pending_deletion_reason', sa.Text(), nullable=True))
    op.add_column('reports', sa.Column('pending_deletion_requested_at', sa.DateTime(), nullable=True))
    op.add_column('reports', sa.Column('deleted_via', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('reports', 'deleted_via')
    op.drop_column('reports', 'pending_deletion_requested_at')
    op.drop_column('reports', 'pending_deletion_reason')