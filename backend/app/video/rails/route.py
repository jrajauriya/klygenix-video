from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import datetime

import httpx

from app.config import settings
from app.video.rails.base import RailError

TIMEOUT = httpx.Timeout(20.0, connect=5.0)

STATUS_MAP = {
    "requested": "under_review", "under_review": "under_review", "needs_clarification": "needs_clarification",
    "activated": "activated", "suspended": "suspended", "rejected": "rejected",
}


@dataclass
class LinkedAccount:
    account_id: str
    stakeholder_id: str | None
    product_id: str | None
    status: str
    requirements: list = field(default_factory=list)


def api_host() -> str:
    base = settings.RAZORPAY_API_BASE.rstrip("/")
    return base[:-3] if base.endswith("/v1") else base


class RouteClient:
    name = "razorpay"

    def __init__(self, key_id: str, key_secret: str) -> None:
        if not key_id or not key_secret or not settings.ROUTE_PROFILE_CATEGORY:
            raise RailError("The platform's Razorpay account is not configured for Route.")
        self.auth = (key_id, key_secret)

    def _call(self, method: str, path: str, **kw) -> dict:
        from app.core.breaker import guard

        try:
            with guard("razorpay-route", self.auth[0]):
                resp = httpx.request(method, f"{api_host()}{path}", auth=self.auth, timeout=TIMEOUT, **kw)
        except httpx.HTTPError as exc:
            raise RailError(f"Razorpay could not be reached: {exc}") from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("error", {}).get("description")
            except ValueError:
                detail = resp.text[:200]
            raise RailError(f"Razorpay refused: {detail}")
        return resp.json()

    def create_account(self, a) -> LinkedAccount:
        addr = a.address or {}
        acc = self._call("POST", "/v2/accounts", json={
            "email": a.email, "phone": a.phone, "type": "route", "reference_id": f"kv-{a.tenant_id}",
            "legal_business_name": a.legal_name, "business_type": a.business_type, "contact_name": a.contact_name,
            "profile": {"category": settings.ROUTE_PROFILE_CATEGORY, "subcategory": settings.ROUTE_PROFILE_SUBCATEGORY, "addresses": {"registered": {
                "street1": addr.get("street1", ""), "street2": addr.get("street2", ""), "city": addr.get("city", ""),
                "state": addr.get("state", ""), "postal_code": addr.get("postal_code", ""), "country": "IN"}}},
            "legal_info": {k: v for k, v in (("pan", a.pan), ("gst", a.gstin)) if v},
        })
        sth = self._call("POST", f"/v2/accounts/{acc['id']}/stakeholders", json={
            "name": a.contact_name, "email": a.email, "kyc": {"pan": a.pan} if a.pan else {}})
        prd = self._call("POST", f"/v2/accounts/{acc['id']}/products", json={"product_name": "route", "tnc_accepted": True})
        return LinkedAccount(acc["id"], sth.get("id"), prd.get("id"), STATUS_MAP.get(prd.get("activation_status"), "under_review"),
                             prd.get("requirements") or [])

    def submit_bank(self, a, account_number: str) -> LinkedAccount:
        prd = self._call("PATCH", f"/v2/accounts/{a.gateway_account_id}/products/{a.gateway_product_id}", json={
            "settlements": {"account_number": account_number, "ifsc_code": a.ifsc, "beneficiary_name": a.beneficiary_name},
            "tnc_accepted": True})
        return LinkedAccount(a.gateway_account_id, a.gateway_stakeholder_id, a.gateway_product_id,
                             STATUS_MAP.get(prd.get("activation_status"), "under_review"), prd.get("requirements") or [])

    def status(self, a) -> LinkedAccount:
        prd = self._call("GET", f"/v2/accounts/{a.gateway_account_id}/products/{a.gateway_product_id}")
        return LinkedAccount(a.gateway_account_id, a.gateway_stakeholder_id, a.gateway_product_id,
                             STATUS_MAP.get(prd.get("activation_status"), a.status), prd.get("requirements") or [])

    def transfer(self, *, payment_id: str, account_id: str, amount_minor: int, hold_until: datetime | None,
                 notes: dict) -> str:
        t = {"account": account_id, "amount": amount_minor, "currency": "INR",
             "notes": {k: str(v)[:250] for k, v in notes.items()}}
        if hold_until:
            t.update(on_hold=True, on_hold_until=int(hold_until.timestamp()))
        out = self._call("POST", f"/v1/payments/{payment_id}/transfers", json={"transfers": [t]})
        return out["items"][0]["id"]

    def release(self, transfer_id: str) -> None:
        self._call("PATCH", f"/v1/transfers/{transfer_id}", json={"on_hold": False})

    def reverse(self, transfer_id: str, amount_minor: int) -> str:
        return self._call("POST", f"/v1/transfers/{transfer_id}/reversals", json={"amount": amount_minor})["id"]


class SandboxRoute:
    name = "sandbox"

    def create_account(self, a) -> LinkedAccount:
        status = "needs_clarification" if (a.pan or "").upper().startswith("AAAAA") else "under_review"
        reqs = [{"field": "pan", "reason": "The PAN does not match the name given."}] if status == "needs_clarification" else []
        return LinkedAccount(f"acc_sbx_{secrets.token_hex(6)}", f"sth_sbx_{secrets.token_hex(6)}",
                             f"acc_prd_sbx_{secrets.token_hex(6)}", status, reqs)

    def submit_bank(self, a, account_number: str) -> LinkedAccount:
        if (a.pan or "").upper().startswith("AAAAA"):
            return LinkedAccount(a.gateway_account_id, a.gateway_stakeholder_id, a.gateway_product_id, "needs_clarification",
                                 [{"field": "pan", "reason": "The PAN does not match the name given."}])
        return LinkedAccount(a.gateway_account_id, a.gateway_stakeholder_id, a.gateway_product_id, "activated", [])

    def status(self, a) -> LinkedAccount:
        return LinkedAccount(a.gateway_account_id, a.gateway_stakeholder_id, a.gateway_product_id, a.status, a.requirements or [])

    def transfer(self, *, payment_id, account_id, amount_minor, hold_until, notes) -> str:
        if amount_minor <= 0:
            raise RailError("A transfer needs a positive amount.")
        return f"trf_sbx_{secrets.token_hex(7)}"

    def release(self, transfer_id: str) -> None:
        return None

    def reverse(self, transfer_id: str, amount_minor: int) -> str:
        return f"rvrsl_sbx_{secrets.token_hex(7)}"


def route_client():
    if settings.PAYMENT_RAIL == "sandbox" or not settings.RAZORPAY_KEY_ID:
        if not settings.SANDBOX_ENABLED and settings.PAYMENT_RAIL != "sandbox":
            raise RailError("The platform's Razorpay account is not configured for Route.")
        return SandboxRoute()
    return RouteClient(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)
