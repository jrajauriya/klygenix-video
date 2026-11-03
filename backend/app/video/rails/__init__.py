from __future__ import annotations

from app.config import settings
from app.video.rails.base import Fact, GatewayOrder, Rail, RailError
from app.video.rails.lemonsqueezy import LemonSqueezyRail
from app.video.rails.razorpay import RazorpayRail
from app.video.rails.sandbox import SandboxRail

__all__ = ["Fact", "GatewayOrder", "Rail", "RailError", "rail_for", "rail_named"]


def rail_named(name: str) -> Rail:
    if name == "sandbox":
        if not settings.SANDBOX_ENABLED:
            raise RailError("The sandbox rail is off.")
        return SandboxRail()
    if name == "razorpay":
        return RazorpayRail(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET, settings.RAZORPAY_WEBHOOK_SECRET)
    if name == "lemonsqueezy":
        return LemonSqueezyRail(settings.LEMONSQUEEZY_STORE_ID, settings.LEMONSQUEEZY_API_KEY,
                                settings.LEMONSQUEEZY_WEBHOOK_SECRET, settings.LEMONSQUEEZY_VARIANT_ID, "USD")
    raise RailError(f"Unknown rail {name!r}")


def rail_for(country: str) -> Rail:
    mode = settings.PAYMENT_RAIL
    if mode == "sandbox":
        return rail_named("sandbox")
    abroad = (country or "IN").upper() != "IN"
    if abroad and settings.LEMONSQUEEZY_API_KEY:
        return rail_named("lemonsqueezy")
    if settings.RAZORPAY_KEY_ID and mode in ("auto", "razorpay"):
        return rail_named("razorpay")
    if mode == "razorpay":
        raise RailError("Razorpay is not configured.")
    return rail_named("sandbox")
