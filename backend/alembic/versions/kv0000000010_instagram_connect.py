"""connected Instagram professional accounts

Revision ID: kv0000000010
Revises: kv0000000009
"""
from typing import Sequence, Union

from alembic import op

revision: str = "kv0000000010"
down_revision: Union[str, None] = "kv0000000009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_connected_channels_platform", "connected_channels", schema="kv_social", type_="check")
    op.create_check_constraint("ck_connected_channels_platform", "connected_channels",
                               "platform IN ('youtube','bilibili','instagram')", schema="kv_social")


def downgrade() -> None:
    op.execute("DELETE FROM kv_social.connected_channels WHERE platform = 'instagram'")
    op.drop_constraint("ck_connected_channels_platform", "connected_channels", schema="kv_social", type_="check")
    op.create_check_constraint("ck_connected_channels_platform", "connected_channels",
                               "platform IN ('youtube','bilibili')", schema="kv_social")
