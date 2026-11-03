"""Lemon Squeezy — the merchant of record for buyers outside India (§16).

The MoR is the seller of record to the foreign buyer: it charges and files their VAT or sales
tax, handles chargebacks and pays out monthly. Klygenix's own supply is then one B2B export a
month to the MoR, zero-rated under an LUT (services/exports.py).

Documented behaviour this relies on: a checkout is created with `POST /v1/checkouts` (JSON:API)
against a store and a variant, with `custom_price` in the store currency's minor units and
`checkout_data.custom` echoed back on the order; webhooks are signed with HMAC-SHA256 of the raw
body in `X-Signature`; `order_created` carries `subtotal` (before the MoR's tax), `currency`
and `meta.custom_data`. The provider choice is still open (plan §25) — this is one adapter
behind the same Rail interface, so a Paddle or Dodo adapter is a sibling file.
"""

from __future__ import annotations

import hashlib
import hmac
import json

import httpx

from app.video.rails.base import Fact, GatewayOrder, RailError

API = "https://api.lemonsqueezy.com/v1"
TIMEOUT = httpx.Timeout(15.0, connect=5.0)
JSONAPI = {"Accept": "application/vnd.api+json", "Content-Type": "application/vnd.api+json"}


class LemonSqueezyRail:
    name = "lemonsqueezy"

    def __init__(self, store_id: str, api_key: str, signing_secret: str | None, variant_id: str | None,
                 currency: str = "USD") -> None:
        if not store_id or not api_key or not variant_id:
            raise RailError("The merchant of record is not fully configured (store, API key and variant are needed).")
        self.store_id, self.api_key, self.variant_id = store_id, api_key, variant_id
        self.signing_secret = signing_secret or ""
        self.currency = currency

    def _call(self, method: str, path: str, **kw) -> dict:
        from app.core.breaker import guard

        try:
            with guard("lemonsqueezy", self.store_id):
                resp = httpx.request(method, f"{API}{path}", timeout=TIMEOUT,
                                     headers={**JSONAPI, "Authorization": f"Bearer {self.api_key}"}, **kw)
        except httpx.HTTPError as exc:
            raise RailError(f"The merchant of record could not be reached: {exc}") from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json()["errors"][0]["detail"]
            except (ValueError, KeyError, IndexError):
                detail = resp.text[:200]
            raise RailError(f"The merchant of record refused: {detail}")
        return resp.json()

    def create_order(self, *, amount_minor, currency, receipt, notes, prefill, redirect_url: str | None = None,
                     name: str | None = None) -> GatewayOrder:
        if currency.upper() != self.currency.upper():
            raise RailError(f"The merchant of record sells in {self.currency}, not {currency}.")
        data = self._call("POST", "/checkouts", json={"data": {
            "type": "checkouts",
            "attributes": {
                "custom_price": amount_minor,
                "product_options": {"name": (name or "Your order")[:100], "redirect_url": redirect_url or ""},
                "checkout_data": {"email": prefill.get("email"), "name": prefill.get("name"),
                                  "custom": {"checkout": receipt, **{k: str(v) for k, v in notes.items()}}},
            },
            "relationships": {
                "store": {"data": {"type": "stores", "id": str(self.store_id)}},
                "variant": {"data": {"type": "variants", "id": str(self.variant_id)}},
            },
        }})
        url = data["data"]["attributes"]["url"]
        # The checkout's own public id is the key the order webhook echoes back.
        return GatewayOrder(order_id=receipt, client={"rail": self.name, "url": url, "amount": amount_minor,
                                                       "currency": currency})

    def verify(self, body: bytes, signature: str | None) -> bool:
        if not self.signing_secret or not signature:
            return False
        expected = hmac.new(self.signing_secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def facts(self, body: bytes) -> list[Fact]:
        data = json.loads(body)
        meta = data.get("meta", {})
        event = meta.get("event_name", "")
        attrs = data.get("data", {}).get("attributes", {})
        custom = meta.get("custom_data") or {}
        order_id = str(data.get("data", {}).get("id", ""))
        event_id = f"{event}:{order_id}:{attrs.get('updated_at', '')}"
        if event == "order_created" and attrs.get("status") == "paid":
            return [Fact(event_id=event_id, kind="payment.captured", gateway_order_id=custom.get("checkout"),
                         gateway_payment_id=order_id, amount_minor=int(attrs.get("subtotal") or 0),
                         currency=(attrs.get("currency") or self.currency).upper(), method="mor")]
        if event == "order_refunded":
            return [Fact(event_id=event_id, kind="refund.processed", gateway_payment_id=order_id,
                         gateway_refund_id=f"ls_refund_{order_id}", amount_minor=int(attrs.get("refunded_amount") or 0))]
        if event == "subscription_payment_success":
            return [Fact(event_id=event_id, kind="subscription.charged",
                         gateway_subscription_id=str(attrs.get("subscription_id") or ""),
                         gateway_payment_id=order_id, amount_minor=int(attrs.get("subtotal") or 0),
                         currency=(attrs.get("currency") or self.currency).upper())]
        return []

    def fetch_order_payments(self, gateway_order_id: str) -> list[Fact]:
        return []

    def refund(self, *, gateway_payment_id: str, amount_minor: int, notes: dict) -> str:
        self._call("POST", f"/orders/{gateway_payment_id}/refund",
                   json={"data": {"type": "orders", "id": gateway_payment_id, "attributes": {"amount": amount_minor}}})
        return f"ls_refund_{gateway_payment_id}"
