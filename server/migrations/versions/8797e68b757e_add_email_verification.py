"""add email verification

Revision ID: 8797e68b757e
Revises: c1a9ddadbaec
Create Date: 2026-08-16 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8797e68b757e'
down_revision: Union[str, None] = 'c1a9ddadbaec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=False, server_default=sa.false()))

    # Backfill: every account that already existed before this feature
    # shipped is grandfathered in as verified, regardless of how it
    # signed up. The alternative - defaulting everyone to False - would
    # instantly lock every existing password-account user out of their
    # own account the next time they tried to log in, with no code ever
    # having been sent to them (the verification-code flow only fires
    # from NEW signups going forward - see auth_signup() in app.py).
    # Google accounts were always verified by definition (Google's own
    # OAuth already confirmed the email); this backfill treats
    # already-existing password accounts the same way on the reasoning
    # that they've been actively used without incident, which is itself
    # a weaker but real signal the email is reachable/owned by the
    # account holder.
    op.execute("UPDATE users SET email_verified = 1 WHERE 1=1")

    op.create_table('email_verification_codes',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('code_hash', sa.String(), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('used_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_email_verification_codes_code_hash'), 'email_verification_codes', ['code_hash'], unique=False)
    op.create_index(op.f('ix_email_verification_codes_user_id'), 'email_verification_codes', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_email_verification_codes_user_id'), table_name='email_verification_codes')
    op.drop_index(op.f('ix_email_verification_codes_code_hash'), table_name='email_verification_codes')
    op.drop_table('email_verification_codes')
    op.drop_column('users', 'email_verified')
