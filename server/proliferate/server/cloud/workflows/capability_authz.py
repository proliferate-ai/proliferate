"""Live capability authorization (WS3a, feature spec §7.1 live narrowing).

The frozen leases (``capability_resolution.py``) are the maximum authority; this
module is the USE-TIME check that a call is still allowed. Two guarantees:

1. the exact frozen lease must EXIST for the (run, slot, capability_key); and
2. the live state is revalidated on EVERY call with NO positive cache — a
   definition archived/revoked, an account no longer ready, or org membership
   removed after StartRun denies the next decision (§7.1: "revocation, archive,
   membership removal, or policy narrowing may deny a previously frozen
   capability at the next authorization decision").

A capability created after StartRun has no frozen lease, so it is undiscoverable
and denied — the run's authority can never widen.

This wires in ALONGSIDE the existing namespace scope check (``domain/scope.py``):
both must pass when a run has leases. A legacy run with NO leases keeps
namespace-only behavior (``authorize_dispatch`` allows), so no existing run path
breaks; enforcement cutover to leases-only is WS3b/WS3c.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import FUNCTION_INVOCATION_PROVIDER_NAMESPACE
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.workflow_ledger import gateway as ledger_gateway
from proliferate.db.store.workflow_ledger.records import CapabilityLeaseRecord
from proliferate.server.cloud.workflows.domain.capabilities import (
    CAPABILITY_KIND_FUNCTION,
    CAPABILITY_KIND_INTEGRATION_TOOL,
    FunctionRef,
    parse_capability_key,
)

# Enumerated deny reasons (mirrors domain/scope.py style; agent-readable).
CAPABILITY_DENY_NO_LEASE = "capability_not_leased"
CAPABILITY_DENY_REVOKED = "capability_revoked"
CAPABILITY_DENY_STALE_REVISION = "capability_stale_revision"
CAPABILITY_DENY_ACCOUNT_NOT_READY = "capability_account_not_ready"
CAPABILITY_DENY_MEMBERSHIP = "capability_membership_removed"
CAPABILITY_DENY_MALFORMED = "capability_key_malformed"


@dataclass(frozen=True)
class CapabilityRunContext:
    """The trusted run identity the gateway boundary supplies (never an agent
    claim): the credential proves the run, and the owner/org come from the run
    token grant, not from tool arguments."""

    run_id: UUID
    owner_user_id: UUID
    organization_id: UUID | None = None


@dataclass(frozen=True)
class CapabilityDecision:
    allowed: bool
    reason: str | None = None
    detail: str | None = None


async def _revalidate_live(
    db: AsyncSession,
    *,
    ctx: CapabilityRunContext,
    lease: CapabilityLeaseRecord,
) -> CapabilityDecision:
    """Revalidate a frozen lease against current state (no positive cache)."""

    if lease.kind == CAPABILITY_KIND_FUNCTION:
        definition_id = lease.function_definition_id
        frozen_revision = lease.semantic_revision
        record = (
            await invocations_store.get_by_id(db, UUID(definition_id))
            if definition_id is not None
            else None
        )
        if record is None or record.archived_at is not None:
            return CapabilityDecision(
                allowed=False,
                reason=CAPABILITY_DENY_REVOKED,
                detail="This function invocation has been archived or removed.",
            )
        if record.semantic_revision != frozen_revision:
            return CapabilityDecision(
                allowed=False,
                reason=CAPABILITY_DENY_STALE_REVISION,
                detail=(
                    "This function invocation was edited after the run started; the "
                    "run's frozen revision is no longer available."
                ),
            )
        return CapabilityDecision(allowed=True)

    if lease.kind == CAPABILITY_KIND_INTEGRATION_TOOL:
        # Revalidate via the SAME org-aware ready-account lookup the gateway uses,
        # by the definition's namespace. Archive/disable/removed-membership all
        # collapse to "no ready+allowed account" and deny.
        row = await _integration_ready_row(db, ctx=ctx, lease=lease)
        if row is None:
            return CapabilityDecision(
                allowed=False,
                reason=CAPABILITY_DENY_ACCOUNT_NOT_READY,
                detail="The integration for this tool is no longer connected or is disabled.",
            )
        if ctx.organization_id is not None:
            membership = await organizations_store.get_active_membership(
                db, organization_id=ctx.organization_id, user_id=ctx.owner_user_id
            )
            if membership is None:
                return CapabilityDecision(
                    allowed=False,
                    reason=CAPABILITY_DENY_MEMBERSHIP,
                    detail="Organization membership was removed after the run started.",
                )
        return CapabilityDecision(allowed=True)

    # product_mcp is not routed through the integration gateway (WS8 owns it).
    return CapabilityDecision(
        allowed=False,
        reason=CAPABILITY_DENY_REVOKED,
        detail="This capability kind is not authorized at the integration gateway.",
    )


async def _integration_ready_row(
    db: AsyncSession, *, ctx: CapabilityRunContext, lease: CapabilityLeaseRecord
) -> accounts_store.ReadyAccountRow | None:
    """The current ready+org-allowed account for a frozen integration lease's
    definition, resolved by matching the frozen ``provider_definition_id`` to a
    live ready account's definition id. ``None`` denies."""

    provider_definition_id = lease.provider_definition_id
    if provider_definition_id is None:
        return None
    rows = await accounts_store.list_ready_accounts_for_user(
        db, ctx.owner_user_id, organization_id=ctx.organization_id
    )
    for row in rows:
        if str(row.definition.id) != str(provider_definition_id):
            continue
        if not accounts_store.org_policy_allows(row, organization_id=ctx.organization_id):
            return None
        return row
    return None


async def authorize_capability(
    db: AsyncSession,
    *,
    run: CapabilityRunContext,
    slot_id: str,
    capability_key: str,
) -> CapabilityDecision:
    """The named live-narrowing seam: the frozen (run, slot, key) lease must EXIST
    and its live state must revalidate. No positive cache — every call re-queries.

    This is the slot-specific check WS3b/WS3c and the receipt path consume with
    the frozen key from the resolved plan/lease.
    """

    try:
        parse_capability_key(capability_key)
    except ValueError:
        return CapabilityDecision(
            allowed=False,
            reason=CAPABILITY_DENY_MALFORMED,
            detail="Malformed capability key.",
        )
    leases = await ledger_gateway.list_capability_leases(db, run_id=run.run_id)
    match = next(
        (
            lease
            for lease in leases
            if lease.slot_id == slot_id and lease.capability_key == capability_key
        ),
        None,
    )
    if match is None:
        return CapabilityDecision(
            allowed=False,
            reason=CAPABILITY_DENY_NO_LEASE,
            detail="This capability is not leased to this slot for this run.",
        )
    return await _revalidate_live(db, ctx=run, lease=match)


async def authorize_dispatch(
    db: AsyncSession,
    *,
    run: CapabilityRunContext,
    provider: str,
    tool: str,
) -> CapabilityDecision:
    """Gateway-dispatch authorization (caller does not identify its slot).

    Enforced ALONGSIDE the namespace scope check in ``call_provider_tool``:

    * A run with NO leases is legacy — allow (namespace-only governs).
    * ``functions``: the frozen function leases are always exact, so the tool
      (addressed by ``name``) must map to a live function whose current
      ``(id, semantic_revision)`` matches a frozen lease in ANY slot; a function
      created OR edited after StartRun has no matching lease and is denied.
    * an integration provider: enforced only when that provider was lease-frozen
      at StartRun (warm cache). If it has no integration_tool leases for this run
      (cold cache), fall back to allow — the namespace token still governs it and
      WS3c tightens it. When frozen, a ``(provider_definition_id, tool)`` lease
      must exist and revalidate live.
    """

    leases = await ledger_gateway.list_capability_leases(db, run_id=run.run_id)
    if not leases:
        return CapabilityDecision(allowed=True)  # legacy run: namespace-only

    if provider == FUNCTION_INVOCATION_PROVIDER_NAMESPACE:
        record = await invocations_store.get_by_name(
            db, owner_user_id=run.owner_user_id, name=tool
        )
        if record is None:
            return CapabilityDecision(
                allowed=False,
                reason=CAPABILITY_DENY_REVOKED,
                detail=f"Function '{tool}' is not available to this run.",
            )
        live_key = FunctionRef(
            definition_id=str(record.id), semantic_revision=record.semantic_revision
        ).capability_key
        match = next(
            (
                lease
                for lease in leases
                if lease.kind == CAPABILITY_KIND_FUNCTION and lease.capability_key == live_key
            ),
            None,
        )
        if match is None:
            return CapabilityDecision(
                allowed=False,
                reason=CAPABILITY_DENY_NO_LEASE,
                detail=(
                    f"Function '{tool}' was created or edited after this run started "
                    "and is not part of the run's frozen capabilities."
                ),
            )
        return await _revalidate_live(db, ctx=run, lease=match)

    # Integration provider. Match the frozen leases by definition, not namespace
    # (the lease stores the provider definition id). Resolve the live definition
    # id from a ready account; if there are no integration leases for it, this
    # provider was not lease-frozen (cold cache) -> namespace-only fallback.
    row = await accounts_store.get_ready_account_for_provider(
        db, run.owner_user_id, provider, organization_id=run.organization_id
    )
    provider_leases = [
        lease
        for lease in leases
        if lease.kind == CAPABILITY_KIND_INTEGRATION_TOOL
        and row is not None
        and str(lease.provider_definition_id) == str(row.definition.id)
    ]
    if not provider_leases:
        # Either the provider isn't ready (namespace check already denies), or it
        # was never lease-frozen (cold cache): defer to the namespace layer.
        return CapabilityDecision(allowed=True)
    match = next((lease for lease in provider_leases if lease.tool_name == tool), None)
    if match is None:
        return CapabilityDecision(
            allowed=False,
            reason=CAPABILITY_DENY_NO_LEASE,
            detail=(
                f"Tool '{tool}' on '{provider}' was not part of the run's frozen "
                "capabilities (created after the run started)."
            ),
        )
    return await _revalidate_live(db, ctx=run, lease=match)
