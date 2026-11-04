"""add_catalog_metadata_fields

Revision ID: c1a8d0e5b7a1
Revises: 59fbdae65e4e
Create Date: 2026-11-04 10:38:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a8d0e5b7a1'
down_revision: Union[str, None] = '59fbdae65e4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('songs', sa.Column('duration_seconds', sa.Integer(), nullable=True))
    op.add_column('songs', sa.Column('thumbnail_url', sa.String(length=1024), nullable=True))
    op.add_column('songs', sa.Column('metadata_status', sa.String(length=32), server_default='pending', nullable=False))
    op.add_column('songs', sa.Column('last_metadata_sync', sa.DateTime(timezone=True), nullable=True))
    op.add_column('songs', sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))
    op.add_column('songs', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))


def downgrade() -> None:
    op.drop_column('songs', 'updated_at')
    op.drop_column('songs', 'created_at')
    op.drop_column('songs', 'last_metadata_sync')
    op.drop_column('songs', 'metadata_status')
    op.drop_column('songs', 'thumbnail_url')
    op.drop_column('songs', 'duration_seconds')

