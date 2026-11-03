"""The sandbox rail — a gateway that lives inside this API, for development and tests.

It is not a shortcut around the rules: its "payment" is a callback body signed with
SANDBOX_WEBHOOK_SECRET and fed to the very same webhook ingest as Razorpay's, so the whole
verify → record → enqueue → worker grants path runs end to end with no keys and no network.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets

from app.config import settings
from app.video.rails.base import Fact, GatewayOrder, RailError

# Orders the sandbox has issued in this process are not needed: the order id itself
# carries nothing secret, and the paying endpoint re-reads the checkout from the database.


def sign(body: bytes) -> str:
    return hmac.new(settings.SANDBOX_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


class SandboxRail:
    name = "sandbox"

    def create_order(self, *, amount_minor, currency, receipt, notes, prefill) -> GatewayOrder:
        order_id = f"sbx_order_{secrets.token_hex(8)}"
        return GatewayOrder(order_id=order_id, client={
            "rail": "sandbox", "order_id": order_id, "amount": amount_minor, "currency": currency,
            "prefill": prefill,
        })

    def verify(self, body: bytes, signature: str | None) -> bool:
        return bool(signature) and hmac.compare_digest(sign(body), signature or "")

    def event_body(self, kind: str, **fields) -> bytes:
        payload = {"id": f"sbx_evt_{secrets.token_hex(8)}", "event": kind, **fields}
        return json.dumps(payload, separators=(",", ":")).encode()

    def facts(self, body: bytes) -> list[Fact]:
        data = json.loads(body)
        return [Fact(
            event_id=data["id"], kind=data["event"],
            gateway_order_id=data.get("order_id"), gateway_payment_id=data.get("payment_id"),
            gateway_refund_id=data.get("refund_id"), gateway_dispute_id=data.get("dispute_id"),
            gateway_subscription_id=data.get("subscription_id"),
            amount_minor=int(data.get("amount") or 0), fee_minor=int(data.get("fee") or 0),
            tax_on_fee_minor=int(data.get("tax") or 0), currency=data.get("currency") or "INR",
            method=data.get("method"), reason=data.get("reason"),
        )]

    def fetch_order_payments(self, gateway_order_id: str) -> list[Fact]:
        return []

    def refund(self, *, gateway_payment_id: str, amount_minor: int, notes: dict) -> str:
        if not gateway_payment_id:
            raise RailError("Nothing to refund against.")
        return f"sbx_rfnd_{secrets.token_hex(8)}"
