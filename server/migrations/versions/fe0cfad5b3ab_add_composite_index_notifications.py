"""add composite index on notifications (user_id, is_read)

Revision ID: fe0cfad5b3ab
Revises: 9be8486b4b71
Create Date: 2026-08-17 00:00:00.000000

get_unread_count() and mark_all_read() (server/models/notification.py)
both filter on user_id AND is_read together. get_unread_count()
specifically backs the navbar's unread-notification dot, polled every
30 seconds per signed-in user for as long as they have a tab open
(client/src/components/NavBar.jsx) - likely one of the single
highest-frequency queries in the app. user_id and is_read already had
their own single-column indexes, but confirmed via EXPLAIN QUERY PLAN
that a query filtering both only used the user_id index and still had
to scan every one of that user's notification rows to check is_read
one at a time. This composite index lets both queries resolve with a
single index seek instead.

Same reasoning as the reports composite index in 9be8486b4b71 - see
that migration for the fuller writeup of why (review_status, status)
needed the same treatment.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'fe0cfad5b3ab'
down_revision: Union[str, None] = '9be8486b4b71'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_notifications_user_id_is_read', 'notifications', ['user_id', 'is_read'], unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_notifications_user_id_is_read', table_name='notifications')
