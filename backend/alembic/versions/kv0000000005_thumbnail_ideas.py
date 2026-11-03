"""thumbnail ideas picked from the video

Revision ID: kv0000000005
Revises: kv0000000004
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "kv0000000005"
down_revision: Union[str, None] = "kv0000000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("thumbnail_ideas", postgresql.JSONB(astext_type=sa.Text()), server_default="[]",
                                      nullable=False), schema="kv_media")


def downgrade() -> None:
    op.drop_column("videos", "thumbnail_ideas", schema="kv_media")
