"""THE payment rail interface (§10). One adapter per provider; the state machine is shared.

A rail never decides anything about access. It creates a gateway order for an amount the
server already fixed, verifies a callback's signature over the raw bytes, and turns the
provider's payload into provider-neutral facts the payment worker reads.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class RailError(Exception):
    """The provider refused or could not be reached."""


@dataclass(frozen=True, slots=True)
class GatewayOrder:
    order_id: str
    # What the storefront needs to open the payment UI: key id, amounts, prefill.
    client: dict = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Fact:
    """One thing a provider told us, in our words."""

    event_id: str
    kind: str   # payment.captured | payment.failed | refund.processed | dispute.opened
                # | dispute.won | dispute.lost | subscription.charged | subscription.halted
    gateway_order_id: str | None = None
    gateway_payment_id: str | None = None
    gateway_refund_id: str | None = None
    gateway_dispute_id: str | None = None
    gateway_subscription_id: str | None = None
    amount_minor: int = 0
    fee_minor: int = 0
    tax_on_fee_minor: int = 0
    currency: str = "INR"
    method: str | None = None
    reason: str | None = None


class Rail(Protocol):
    name: str

    def create_order(self, *, amount_minor: int, currency: str, receipt: str, notes: dict,
                     prefill: dict) -> GatewayOrder: ...

    def verify(self, body: bytes, signature: str | None) -> bool: ...

    def facts(self, body: bytes) -> list[Fact]: ...

    def fetch_order_payments(self, gateway_order_id: str) -> list[Fact]: ...

    def refund(self, *, gateway_payment_id: str, amount_minor: int, notes: dict) -> str: ...
