"""Gateway-time trusted activation resolution + receipt recording (WS3c, §7.3).

This is the seam the integration gateway (``integration_gateway/service.py``)
calls when a tool call carries a trusted ``activation_id`` (injected by the
trusted MCP/proxy layer — agent-supplied tool arguments never carry it): it
looks up the runtime's durable activation registration, authenticates it
against the calling credential's trusted (run, slot, session) context, checks
it names the SAME capability actually being dispatched, revalidates live via
WS3a's ``authorize_capability`` (no positive cache), and durably records the
activation-keyed outcome — all WITHOUT ever persisting arguments, headers, or
secrets.

Also owns the authenticated runtime query surface's read helpers
(``executor_credentials_api.py`` wires these to HTTP): recovering the
authoritative receipt by activation identity, and listing receipts for a
(run, slot, step, attempt) so the runtime can evaluate ``domain.gate``.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import FUNCTION_INVOCATION_PROVIDER_NAMESPACE
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.db.store.workflow_ledger import activations as activations_store
from proliferate.db.store.workflow_ledger import gateway as ledger_gateway
from proliferate.db.store.workflow_ledger.records import ActivationRecord, GatewayReceiptRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import capability_authz
from proliferate.server.cloud.workflows.domain.capabilities import (
    CAPABILITY_KIND_FUNCTION,
    CAPABILITY_KIND_INTEGRATION_TOOL,
    ParsedCapabilityKey,
    parse_capability_key,
)


@dataclass(frozen=True)
class ActivationCallResolution:
    """The result of resolving a gateway call's trusted activation context.

    ``existing_receipt`` set means this activation already has a terminal
    receipt — a prior call already executed (or was denied for) it. The
    gateway MUST NOT dispatch upstream again (§7.3: "does not repeat the
    external effect") and should return a result shaped from that receipt.
    ``None`` means the call is cleared to dispatch; the caller must invoke
    :func:`record_terminal_receipt` with the outcome exactly once afterward.
    """

    activation: ActivationRecord
    existing_receipt: GatewayReceiptRecord | None


async def _capability_matches_call(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    parsed: ParsedCapabilityKey,
    provider: str,
    tool: str,
) -> bool:
    """Whether the actual (provider, tool) being dispatched is the SAME
    capability the activation names (§7.1: "activates only that capability")."""

    if parsed.kind == CAPABILITY_KIND_FUNCTION:
        if provider != FUNCTION_INVOCATION_PROVIDER_NAMESPACE or parsed.definition_id is None:
            return False
        record = await invocations_store.get_by_id(db, UUID(parsed.definition_id))
        return record is not None and record.name == tool
    if parsed.kind == CAPABILITY_KIND_INTEGRATION_TOOL:
        if parsed.tool_name != tool:
            return False
        row = await accounts_store.get_ready_account_for_provider(
            db, grant.owner_user_id, provider, organization_id=grant.organization_id
        )
        return row is not None and str(row.definition.id) == parsed.provider_definition_id
    return False


async def record_terminal_receipt(
    db: AsyncSession,
    *,
    activation: ActivationRecord,
    authorization_decision: str,
    outcome: str,
) -> GatewayReceiptRecord:
    """Durably record the activation-keyed outcome (§7.3) — success, denied,
    upstream-failed, or output-invalid — WITHOUT arguments, headers, or
    secrets. Called at most once per activation: the unique ``activation_id``
    constraint on ``workflow_gateway_receipt`` is the DB backstop against a
    caller that skipped the ``existing_receipt`` short-circuit."""

    try:
        parsed: ParsedCapabilityKey | None = parse_capability_key(activation.capability_key)
    except ValueError:
        parsed = None
    kwargs: dict[str, object] = {}
    capability_kind = CAPABILITY_KIND_FUNCTION
    if parsed is not None:
        capability_kind = parsed.kind
        if parsed.kind == CAPABILITY_KIND_FUNCTION:
            kwargs["function_definition_id"] = parsed.definition_id
            kwargs["semantic_revision"] = parsed.semantic_revision
        elif parsed.kind == CAPABILITY_KIND_INTEGRATION_TOOL:
            kwargs["provider_definition_id"] = parsed.provider_definition_id
            kwargs["provider_revision"] = parsed.provider_revision
            kwargs["tool_name"] = parsed.tool_name
    return await ledger_gateway.insert_gateway_receipt(
        db,
        run_id=activation.run_id,
        plan_hash=activation.plan_hash,
        slot_id=activation.slot_id,
        session_id=activation.session_id,
        step_key=activation.step_key,
        attempt=activation.attempt,
        activation_id=activation.activation_id,
        capability_kind=capability_kind,
        authorization_decision=authorization_decision,
        outcome=outcome,
        turn_id=activation.turn_id,
        **kwargs,
    )


async def resolve_activation_for_call(
    db: AsyncSession,
    *,
    grant: IntegrationGatewayGrant,
    provider: str,
    tool: str,
    activation_id: str,
) -> ActivationCallResolution:
    """Resolve + gate an inbound tool call's trusted activation context (§7.3).

    Only ``activation_id`` rides the call — the trusted MCP/proxy layer injects
    it and agent-supplied tool arguments never carry it. Every other identity
    field is looked up from the durable registration, never re-asserted by the
    caller. Raises a typed ``CloudApiError`` (denied, NO receipt written — there
    is no legitimate activation of THIS credential's to record against) when
    the activation is unknown or belongs to a different run/slot/session than
    the presented credential's trusted context. When the activation IS this
    credential's but names a different capability than the one actually being
    dispatched, or WS3a's live authorization denies it, this writes a terminal
    ``denied`` receipt — the activation is thereby CONSUMED (a corrective turn
    must mint a fresh ``activation_id``) — and raises.
    """

    activation = await activations_store.get_activation_by_id(db, activation_id=activation_id)
    if activation is None:
        raise CloudApiError(
            "integration_gateway_activation_unknown",
            "Unknown activation id.",
            status_code=403,
        )
    if (
        activation.run_id != grant.run_id
        or activation.slot_id != grant.slot_id
        or activation.session_id != grant.session_id
    ):
        raise CloudApiError(
            "integration_gateway_activation_context_mismatch",
            "This activation does not belong to the calling run/slot/session.",
            status_code=403,
        )

    existing_receipt = await ledger_gateway.get_gateway_receipt_by_activation(
        db, activation_id=activation_id
    )
    if existing_receipt is not None:
        # §7.3 recovery path: the effect (or its denial) already happened once —
        # never repeat it, no matter how many times this call is retried.
        return ActivationCallResolution(activation=activation, existing_receipt=existing_receipt)

    try:
        parsed = parse_capability_key(activation.capability_key)
    except ValueError:
        await record_terminal_receipt(
            db, activation=activation, authorization_decision="deny", outcome="denied"
        )
        raise CloudApiError(
            "integration_gateway_activation_capability_malformed",
            "The activation's capability_key is malformed.",
            status_code=403,
        ) from None

    if not await _capability_matches_call(
        db, grant=grant, parsed=parsed, provider=provider, tool=tool
    ):
        await record_terminal_receipt(
            db, activation=activation, authorization_decision="deny", outcome="denied"
        )
        raise CloudApiError(
            "integration_gateway_activation_capability_mismatch",
            "This activation does not authorize the requested provider/tool.",
            status_code=403,
        )

    decision = await capability_authz.authorize_capability(
        db,
        run=capability_authz.CapabilityRunContext(
            run_id=activation.run_id,
            owner_user_id=grant.owner_user_id,
            organization_id=grant.organization_id,
        ),
        slot_id=activation.slot_id,
        capability_key=activation.capability_key,
    )
    if not decision.allowed:
        await record_terminal_receipt(
            db, activation=activation, authorization_decision="deny", outcome="denied"
        )
        raise CloudApiError(
            "integration_gateway_capability_denied",
            decision.detail or "This capability is not part of the run's frozen authority.",
            status_code=403,
        )

    return ActivationCallResolution(activation=activation, existing_receipt=None)


# --- authenticated runtime query surface (§7.3 recovery) -----------------------


async def get_activation_and_receipt(
    db: AsyncSession, *, run_id: UUID, activation_id: str
) -> tuple[ActivationRecord, GatewayReceiptRecord | None] | None:
    """The activation + its receipt (``None`` = absent -> corrective re-prompt),
    scoped to ``run_id`` so one run's control channel cannot enumerate another
    run's activations even if it guessed an id. ``None`` overall = not found /
    not this run's."""

    activation = await activations_store.get_activation_by_id(db, activation_id=activation_id)
    if activation is None or activation.run_id != run_id:
        return None
    receipt = await ledger_gateway.get_gateway_receipt_by_activation(
        db, activation_id=activation_id
    )
    return activation, receipt


async def list_receipts_for_gate(
    db: AsyncSession, *, run_id: UUID, slot_id: str, step_key: str, attempt: int
) -> tuple[GatewayReceiptRecord, ...]:
    """Every receipt for ``(run, step, attempt)``, further narrowed to
    ``slot_id`` (the store index is per-step/attempt only) — the exact input
    ``domain.gate.gate_satisfied`` consumes."""

    receipts = await ledger_gateway.list_gateway_receipts_for_step(
        db, run_id=run_id, step_key=step_key, attempt=attempt
    )
    return tuple(receipt for receipt in receipts if receipt.slot_id == slot_id)
