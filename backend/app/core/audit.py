"""The money audit trail (§22) — written by the flush that makes the change.

Nothing is asked to remember. A change to a watched table writes a row whether or not
anybody thought about it, which is the whole difference between this and the thirteen
`*_by_user_id` columns scattered over the money tables: those are passed by hand, and four
of them had been quietly missed by the time this was built.

`kv_admin.activity_log` is the other log and answers a different question. It is written
after the response, on its own session, through a bounded queue that drops on overflow.
That is correct for page views and, as §22 puts it, unacceptable for a payout approval.
"""

from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
from typing import Any

from sqlalchemy import event, inspect, text
from sqlalchemy.orm import Session

from app.core.logging_config import REDACT, get_request_id

ACTOR_KEY = "audit_actor"
ACTION_KEY = "audit_action"

USER = "user"
WORKER = "worker"
PROVIDER = "provider"
CUSTOMER = "customer"
# An integration acting on a key. It runs AS a user, but leaving their name on it would
# say a person did something a person did not do.
API_KEY = "api_key"
SYSTEM = "system"
UNKNOWN = "unknown"

# Money, and only money. A customer's phone number changing is not a movement, and a trail
# that records everything is telemetry again.
WATCHED = {
    # Money.
    "orders", "order_items", "payments", "refunds", "disputes", "subscriptions",
    "subscription_cycles", "coupons", "commissions", "affiliate_payouts", "tax_invoices",
    "periods", "products", "product_prices",
    # Access — a grant or a revoke is as consequential as a payment (§22).
    "entitlements", "licence_keys",
    # Credentials a tenant holds. The values never land here — `_safe` fingerprints them.
    "gateway_accounts", "channel_accounts", "api_keys", "email_configs",
}

# `role_permissions` is deliberately absent: a matrix save is a scoped delete followed by
# fifty inserts, so the listener would write fifty rows saying nothing. It is recorded
# once, by hand, with the levels that actually moved — see `record` and the permissions
# router.

# A column whose name contains one of these never reaches the trail, whatever it holds.
SECRET = tuple(REDACT)


class Actor:
    __slots__ = ("kind", "user_id", "label", "ip")

    def __init__(
        self,
        kind: str,
        *,
        user_id: int | None = None,
        label: str | None = None,
        ip: str | None = None,
    ) -> None:
        self.kind = kind
        self.user_id = user_id
        self.label = label
        self.ip = ip


def acting_as(session: Session, actor: Actor) -> None:
    session.info[ACTOR_KEY] = actor


def attribute(session: Session, *, tenant_id: int | None, actor: Actor) -> None:
    """Make a plain session able to record.

    Two places, and both are needed — the same lesson `get_tenant_db` learned. The trail
    is under row-level security, and `app.tenant_id` is transaction-local: setting only
    `session.info` leaves the transaction already in flight without it, and the audit
    INSERT is refused by the policy rather than by anything that looks like a bug.
    """
    if tenant_id is not None:
        session.info["tenant_id"] = tenant_id
        session.execute(
            text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(tenant_id)}
        )
    acting_as(session, actor)


def name(session: Session, action: str) -> None:
    """Say what is being done, for the rows this unit of work is about to write.

    Without it the trail reads `payments.changed`, which is true and says nothing; with
    it, `payment.payer_named`. Consumed by the next flush and cleared, so it cannot leak
    into whatever the session does afterwards.
    """
    session.info[ACTION_KEY] = action


@contextmanager
def acting(session: Session, action: str):
    previous = session.info.get(ACTION_KEY)
    session.info[ACTION_KEY] = action
    try:
        yield
    finally:
        if previous is None:
            session.info.pop(ACTION_KEY, None)
        else:
            session.info[ACTION_KEY] = previous


def fingerprint(value: Any) -> str | None:
    """Enough to tell one secret from another, and nothing else (§22).

    A rotation is only auditable if the record can say the value changed AND that it
    changed to the thing that was meant. `[redacted]` twice says neither.

    Of the secret, never of one encryption of it: Fernet is randomised, so the same
    password sealed twice gives two ciphertexts, and fingerprinting those would make
    every save look like a rotation and every real rotation indistinguishable from one.
    """
    from app.core.services import secrets

    if value is None or value == "":
        return None
    plain = secrets.resolve(value) if secrets.is_encrypted(value) else str(value)
    if not plain:
        return None
    return sha256(plain.encode()).hexdigest()[:12]


def _safe(name: str, value: Any) -> Any:
    lowered = name.lower()
    if any(word in lowered for word in SECRET):
        return fingerprint(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(k): _safe(str(k), v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe(name, v) for v in value]
    return str(value)


def _diff(obj, *, created: bool) -> tuple[dict | None, dict | None]:
    """The columns that moved, not the row twice over."""
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    state = inspect(obj)
    for attr in state.mapper.column_attrs:
        name = attr.key
        history = state.attrs[name].history
        if not history.has_changes():
            continue
        was = history.deleted[0] if history.deleted else None
        now = history.added[0] if history.added else None
        if created:
            after[name] = _safe(name, now)
            continue
        before[name] = _safe(name, was)
        after[name] = _safe(name, now)
    return (before or None), (after or None)


def _table_of(obj) -> str | None:
    table = getattr(obj, "__tablename__", None)
    return table if table in WATCHED else None


def _identity(obj) -> int | None:
    value = getattr(obj, "id", None)
    return value if isinstance(value, int) else None


PENDING_KEY = "_audit_pending"


def record(
    session: Session,
    *,
    action: str,
    target_table: str,
    target_id: int | None = None,
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    """One row, written by hand, for a change the listener would only make noise of.

    The listener is the floor and stays the floor: this is for the cases where a single
    action is fifty row writes and the useful record is the summary of what moved.
    """
    from app.core.models.audit import AuditEntry

    tenant_id = session.info.get("tenant_id")
    if tenant_id is None:
        return

    actor: Actor = session.info.get(ACTOR_KEY) or Actor(UNKNOWN)
    session.add(
        AuditEntry(
            tenant_id=tenant_id,
            actor_kind=actor.kind,
            actor_user_id=actor.user_id,
            actor_label=actor.label,
            action=action,
            target_table=target_table,
            target_id=target_id,
            before=before or None,
            after=after or None,
            request_id=get_request_id(),
            ip=actor.ip,
        )
    )


@event.listens_for(Session, "before_flush")
def _capture(session: Session, flush_context, instances) -> None:
    """Read the diffs here: after the flush, the attribute history is gone."""
    tenant_id = session.info.get("tenant_id")
    if tenant_id is None:
        return

    actor: Actor = session.info.get(ACTOR_KEY) or Actor(UNKNOWN)
    # Read, not popped: a named action is consumed by the flush that actually writes
    # something. `issue()` takes a row lock on the number counter first, and that flush
    # touches nothing watched — popping here threw the name away before its own change.
    named = session.info.get(ACTION_KEY)
    request_id = get_request_id()
    wrote = False

    for obj, verb, created in (
        *((o, "created", True) for o in session.new),
        *((o, "changed", False) for o in session.dirty),
        *((o, "removed", False) for o in session.deleted),
    ):
        table = _table_of(obj)
        if table is None:
            continue
        before, after = _diff(obj, created=created)
        if before is None and after is None:
            continue
        wrote = True
        session.info.setdefault(PENDING_KEY, []).append(
            (
                obj,
                {
                    "tenant_id": tenant_id,
                    "actor_kind": actor.kind,
                    "actor_user_id": actor.user_id,
                    "actor_label": actor.label,
                    "action": named or f"{table}.{verb}",
                    "target_table": table,
                    "before": before,
                    "after": after,
                    "request_id": request_id,
                    "ip": actor.ip,
                },
            )
        )


    if wrote:
        session.info.pop(ACTION_KEY, None)


@event.listens_for(Session, "after_flush_postexec")
def _write(session: Session, flush_context) -> None:
    """Write them here, where a row created in this flush finally has an id.

    Objects added at this point go out on the next flush, which `commit()` performs — so
    the row still lands inside the transaction that made the change, and a rollback takes
    it with everything else.
    """
    from app.core.models.audit import AuditEntry

    pending = session.info.pop(PENDING_KEY, None)
    if not pending:
        return

    for obj, payload in pending:
        target_id = _identity(obj)
        session.add(AuditEntry(target_id=target_id, **payload))
