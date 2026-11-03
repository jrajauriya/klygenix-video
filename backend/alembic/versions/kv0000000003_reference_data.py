"""reference data — GST codes with dated rates, and the plans

Revision ID: kv0000000003
Revises: kv0000000002
"""
import json
from typing import Sequence, Union

from alembic import op

revision: str = "kv0000000003"
down_revision: Union[str, None] = "kv0000000002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CODES = [
    ("OIDAR", "Online information and digital content", "998431", 1800),
    ("SAAS", "Software as a service — creator tools", "997331", 1800),
    ("NONE", "No GST — tips, outside scope", "999799", 0),
]

PLANS = [
    ("viewer_free", "viewer", "Free", "Watch everything; summaries, chapters and subtitles; 5 Ask questions a day.", 0, 0,
     {"ask_per_day": 5, "languages": 2}, 10),
    ("viewer_premium", "viewer", "Viewer Premium", "Ask without the daily limit, notes, every subtitle language.", 14900, 499,
     {"ask_per_day": 200, "languages": 6, "notes": True}, 20),
    ("creator_free", "creator", "Creator Free", "Upload and publish; 60 AI minutes and 3 clip renders a month.", 0, 0,
     {"ai_minutes": 60, "renders": 3, "watermark": True, "seats": 1}, 30),
    ("creator_pro", "creator", "Creator Pro", "600 AI minutes, unlimited clips within fair use, no watermark, analytics.", 49900, 999,
     {"ai_minutes": 600, "renders": 500, "watermark": False, "seats": 1}, 40),
    ("creator_business", "creator", "Creator Business", "3,000 AI minutes, 5 seats, brand kit, priority renders.", 199900, 3999,
     {"ai_minutes": 3000, "renders": 3000, "watermark": False, "seats": 5, "priority": True}, 50),
]


def upgrade() -> None:
    for code, name, sac, rate in CODES:
        op.execute(
            f"INSERT INTO kv_tax.tax_codes (code, name, sac) VALUES ('{code}', '{name}', '{sac}') "
            "ON CONFLICT (code) DO NOTHING"
        )
        op.execute(
            "INSERT INTO kv_tax.tax_rates (tax_code_id, rate_bps, effective_from, source) "
            f"SELECT id, {rate}, DATE '2017-07-01', 'Believed current Nov 2026 — confirm with CA before launch' "
            f"FROM kv_tax.tax_codes WHERE code = '{code}' ON CONFLICT DO NOTHING"
        )
    for key, audience, name, desc, inr, usd, limits, sort in PLANS:
        op.execute(
            "INSERT INTO kv_commerce.plans (key, audience, name, description, price_inr_minor, price_usd_minor, limits, is_active, sort) "
            f"VALUES ('{key}', '{audience}', '{name}', '{desc.replace(chr(39), chr(39) * 2)}', {inr}, {usd}, "
            f"'{json.dumps(limits)}'::jsonb, true, {sort}) ON CONFLICT (key) DO NOTHING"
        )


def downgrade() -> None:
    op.execute("DELETE FROM kv_commerce.plans")
    op.execute("DELETE FROM kv_tax.tax_rates")
    op.execute("DELETE FROM kv_tax.tax_codes")
