"""Razorpay — Orders, Payments, Refunds and webhooks (§10, §20).

Documented behaviour this relies on: an order is created server-side for a fixed amount;
Checkout opens against that order; the webhook body is signed with HMAC-SHA256 using the
webhook secret in `X-Razorpay-Signature`; `payment.captured` carries `order_id`, `fee` and
`tax` in paise. Every call has a timeout and goes through Pay's circuit breaker (rule 08).
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import replace

import httpx

from app.config import settings
from app.video.rails.base import Fact, GatewayOrder, RailError

TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class RazorpayRail:
    name = "razorpay"

    def __init__(self, key_id: str, key_secret: str, webhook_secret: str | None) -> None:
        if not key_id or not key_secret:
            raise RailError("Razorpay is not configured for this store.")
        self.key_id = key_id
        self.key_secret = key_secret
        self.webhook_secret = webhook_secret or ""

    def _call(self, method: str, path: str, **kw) -> dict:
        from app.core.breaker import guard

        url = f"{settings.RAZORPAY_API_BASE}{path}"
        try:
            with guard("razorpay", self.key_id):
                resp = httpx.request(method, url, auth=(self.key_id, self.key_secret), timeout=TIMEOUT, **kw)
        except httpx.HTTPError as exc:
            raise RailError(f"Razorpay could not be reached: {exc}") from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("error", {}).get("description")
            except ValueError:
                detail = resp.text[:200]
            raise RailError(f"Razorpay refused: {detail}")
        return resp.json()

    def create_order(self, *, amount_minor, currency, receipt, notes, prefill) -> GatewayOrder:
        data = self._call("POST", "/orders", json={
            "amount": amount_minor, "currency": currency, "receipt": receipt[:40],
            "notes": {k: str(v)[:250] for k, v in notes.items()},
        })
        return GatewayOrder(order_id=data["id"], client={
            "rail": "razorpay", "key_id": self.key_id, "order_id": data["id"],
            "amount": amount_minor, "currency": currency, "prefill": prefill,
        })

    def create_subscription(self, *, plan_key: str, name: str, amount_minor: int, currency: str, interval: str,
                            known_plans: dict, notes: dict, prefill: dict,
                            start_at: int | None = None) -> tuple[GatewayOrder, dict]:
        """A recurring membership: UPI AutoPay or a card e-mandate collects each renewal (§10).

        A plan is one price at one period; it is created once and remembered on the product
        (`known_plans`), because a Razorpay plan cannot be edited — a new price is a new plan.
        Returns the checkout payload and the (possibly grown) plan map to store back.
        """
        plans = dict(known_plans or {})
        plan_id = plans.get(plan_key)
        if not plan_id:
            plan = self._call("POST", "/plans", json={
                "period": "yearly" if interval == "year" else "monthly", "interval": 1,
                "item": {"name": name[:100], "amount": amount_minor, "currency": currency},
            })
            plan_id = plan["id"]
            plans[plan_key] = plan_id
        body = {"plan_id": plan_id, "total_count": 10 if interval == "year" else 120, "customer_notify": 1,
                "notes": {k: str(v)[:250] for k, v in notes.items()}}
        if start_at:
            body["start_at"] = int(start_at)
        sub = self._call("POST", "/subscriptions", json=body)
        return GatewayOrder(order_id=sub["id"], client={
            "rail": "razorpay", "key_id": self.key_id, "subscription_id": sub["id"],
            "amount": amount_minor, "currency": currency, "prefill": prefill,
        }), plans

    def cancel_subscription(self, subscription_id: str, *, at_cycle_end: bool) -> dict:
        return self._call("POST", f"/subscriptions/{subscription_id}/cancel",
                          json={"cancel_at_cycle_end": 1 if at_cycle_end else 0})

    def verify(self, body: bytes, signature: str | None) -> bool:
        if not self.webhook_secret or not signature:
            return False
        expected = hmac.new(self.webhook_secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    @staticmethod
    def _payment_fact(event_id: str, kind: str, p: dict) -> Fact:
        return Fact(
            event_id=event_id, kind=kind, gateway_order_id=p.get("order_id"),
            gateway_payment_id=p.get("id"), amount_minor=int(p.get("amount") or 0),
            fee_minor=int(p.get("fee") or 0), tax_on_fee_minor=int(p.get("tax") or 0),
            currency=p.get("currency") or "INR", method=p.get("method"),
            reason=p.get("error_description"),
        )

    def facts(self, body: bytes) -> list[Fact]:
        data = json.loads(body)
        event = data.get("event", "")
        event_id = data.get("id") or hashlib.sha256(body).hexdigest()[:40]
        payload = data.get("payload", {})
        if event in ("payment.captured", "order.paid"):
            p = payload.get("payment", {}).get("entity", {})
            return [self._payment_fact(event_id, "payment.captured", p)]
        if event == "payment.failed":
            p = payload.get("payment", {}).get("entity", {})
            return [self._payment_fact(event_id, "payment.failed", p)]
        if event == "refund.processed":
            r = payload.get("refund", {}).get("entity", {})
            return [Fact(event_id=event_id, kind="refund.processed", gateway_refund_id=r.get("id"),
                         gateway_payment_id=r.get("payment_id"), amount_minor=int(r.get("amount") or 0))]
        if event.startswith("payment.dispute."):
            d = payload.get("dispute", {}).get("entity", {})
            kind = {"payment.dispute.created": "dispute.opened", "payment.dispute.won": "dispute.won",
                    "payment.dispute.lost": "dispute.lost"}.get(event)
            if kind:
                return [Fact(event_id=event_id, kind=kind, gateway_dispute_id=d.get("id"),
                             gateway_payment_id=d.get("payment_id"), amount_minor=int(d.get("amount") or 0),
                             reason=d.get("reason_code"))]
        if event == "subscription.charged":
            s = payload.get("subscription", {}).get("entity", {})
            p = payload.get("payment", {}).get("entity", {})
            f = self._payment_fact(event_id, "subscription.charged", p)
            return [replace(f, gateway_subscription_id=s.get("id"))]
        if event in ("subscription.halted", "subscription.pending"):
            s = payload.get("subscription", {}).get("entity", {})
            return [Fact(event_id=event_id, kind="subscription.halted", gateway_subscription_id=s.get("id"))]
        return []

    def fetch_order_payments(self, gateway_order_id: str) -> list[Fact]:
        data = self._call("GET", f"/orders/{gateway_order_id}/payments")
        out = []
        for p in data.get("items", []):
            if p.get("status") == "captured":
                out.append(self._payment_fact(f"poll_{p['id']}", "payment.captured", p))
        return out

    def refund(self, *, gateway_payment_id: str, amount_minor: int, notes: dict) -> str:
        data = self._call("POST", f"/payments/{gateway_payment_id}/refund", json={
            "amount": amount_minor, "notes": {k: str(v)[:250] for k, v in notes.items()},
        })
        return data["id"]
