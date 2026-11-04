from app.video.models import ads, ai, commerce, community, ledger, media, onboarding, payouts, social, studio, tax, trust  # noqa: F401

from app.video.services import translit as _translit  # noqa: E402

_translit.install()
