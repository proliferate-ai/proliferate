"""StartRun capability resolution (WS3a, feature spec §7.1).

Replaces namespace-only grants with EXACT, per-slot, frozen ``CapabilityRef``s.
At StartRun the workflow-level (and per-slot narrowed) integration namespaces are
expanded into the exact tools/functions VISIBLE + READY for the owner AT THAT
MOMENT, and each is persisted as a ``workflow_capability_lease`` row — the new
frozen truth. A tool/function created or edited after StartRun resolves to a
different identity and therefore can never widen the run.

This runs ALONGSIDE the existing namespace-based per-run gateway token
(``gateway_grants.py``): the runtime still consumes namespaces until WS3b/WS5c,
and enforcement cutover is WS3b/WS3c. WS3a only freezes the leases and adds the
live-authorization seam (``capability_authz.py``).

Enumeration rules at mint (E3 forbids a ``tools/list`` fetch, so no new failure
mode is introduced):

* ``functions`` namespace -> one ``function`` ref per LIVE owner invocation, at
  its current ``semantic_revision``. Fully enumerable from the DB, so functions
  are always frozen exactly (and thus enforceable immediately).
* an integration namespace -> one ``integration_tool`` ref per tool in the
  owner's WARM tool-schema cache for that provider, at the definition's current
  ``updated_at`` (reused as ``provider_revision`` — no new column). A COLD cache
  yields no integration_tool leases for that provider: the namespace grant in the
  per-run token still governs it (legacy-parallel), and WS3c tightens the exact
  integration-tool freeze when the receipt/tool-cache path lands. We never invent
  a fake ``inputSchemaHash``; a tool with no cached schema records the explicit
  ``"unknown"`` sentinel.
"""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import FUNCTION_INVOCATION_PROVIDER_NAMESPACE
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import tool_cache as tool_cache_store
from proliferate.db.store.workflow_ledger import gateway as ledger_gateway
from proliferate.db.store.workflow_ledger.records import CapabilityLeaseRecord
from proliferate.server.cloud.workflows.domain.capabilities import (
    FunctionRef,
    IntegrationToolRef,
    input_schema_hash,
)


def _provider_revision(updated_at: object) -> str:
    """Reuse the definition's ``updated_at`` marker as its provider revision (the
    'investigate an existing version/updated marker' handoff decision — no new
    column). ``isoformat`` is stable and colon-tolerant under the key codec."""

    isoformat = getattr(updated_at, "isoformat", None)
    return isoformat() if callable(isoformat) else str(updated_at)


async def _integration_tool_refs(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    namespace: str,
    organization_id: UUID | None,
) -> list[IntegrationToolRef]:
    """Exact integration-tool refs for one provider namespace, from the warm tool
    cache. Empty when the provider has no ready account or a cold cache."""

    row = await accounts_store.get_ready_account_for_provider(
        db, owner_user_id, namespace, organization_id=organization_id
    )
    if row is None or not accounts_store.org_policy_allows(row, organization_id=organization_id):
        return []
    cache = await tool_cache_store.get_tool_cache(db, row.account.id)
    if cache is None or cache.status != "ready":
        return []
    try:
        tools = json.loads(cache.tools_json or "[]")
    except (ValueError, TypeError):
        return []
    if not isinstance(tools, list):
        return []
    revision = _provider_revision(row.definition.updated_at)
    refs: list[IntegrationToolRef] = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        tool_name = tool.get("name")
        if not isinstance(tool_name, str):
            continue
        schema = tool.get("inputSchema")
        refs.append(
            IntegrationToolRef(
                provider_definition_id=str(row.definition.id),
                provider_revision=revision,
                tool_name=tool_name,
                input_schema_hash=input_schema_hash(schema if isinstance(schema, dict) else None),
            )
        )
    return refs


async def resolve_capability_refs(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    organization_id: UUID | None,
    run_scope: dict[str, dict[str, object]],
) -> dict[str, list[object]]:
    """Resolve each slot's granted namespaces into exact ``CapabilityRef``s.

    ``run_scope`` is the per-slot namespace grant from
    ``gateway_grants.resolve_run_scope`` (``{"<slot>": {"integrations": [...]}}``);
    the per-slot subset already narrows there. Returns ``{slot_id: [ref, ...]}``.
    Function refs are enumerated once and reused across slots (person-scoped);
    integration refs are resolved per namespace and cached within the call.
    """

    function_refs: list[FunctionRef] | None = None
    integration_cache: dict[str, list[IntegrationToolRef]] = {}
    resolved: dict[str, list[object]] = {}

    for slot_id, slot_scope in run_scope.items():
        if not isinstance(slot_scope, dict):
            continue
        refs: list[object] = []
        for namespace in slot_scope.get("integrations") or []:
            if not isinstance(namespace, str):
                continue
            if namespace == FUNCTION_INVOCATION_PROVIDER_NAMESPACE:
                if function_refs is None:
                    invocations = await invocations_store.list_for_owner(db, owner_user_id)
                    function_refs = [
                        FunctionRef(
                            definition_id=str(inv.id),
                            semantic_revision=inv.semantic_revision,
                        )
                        for inv in invocations
                    ]
                refs.extend(function_refs)
            else:
                if namespace not in integration_cache:
                    integration_cache[namespace] = await _integration_tool_refs(
                        db,
                        owner_user_id=owner_user_id,
                        namespace=namespace,
                        organization_id=organization_id,
                    )
                refs.extend(integration_cache[namespace])
        resolved[slot_id] = refs
    return resolved


async def freeze_capability_leases(
    db: AsyncSession,
    *,
    run_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID | None,
    run_scope: dict[str, dict[str, object]],
    plan_hash: str | None = None,
) -> tuple[CapabilityLeaseRecord, ...]:
    """Resolve and persist the run's exact per-slot capability leases at StartRun.

    The single StartRun entry point (called from ``compiler.start_run`` after the
    run row exists — the lease FKs ``workflow_run.id``). Idempotent within a run
    only by the ``(run_id, slot_id, capability_key)`` unique constraint; StartRun
    calls it exactly once. Returns the inserted lease records.
    """

    resolved = await resolve_capability_refs(
        db,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        run_scope=run_scope,
    )
    leases: list[CapabilityLeaseRecord] = []
    for slot_id, refs in resolved.items():
        for ref in refs:
            if isinstance(ref, FunctionRef):
                leases.append(
                    await ledger_gateway.insert_capability_lease(
                        db,
                        run_id=run_id,
                        slot_id=slot_id,
                        kind=ref.kind,
                        capability_key=ref.capability_key,
                        plan_hash=plan_hash,
                        function_definition_id=ref.definition_id,
                        semantic_revision=ref.semantic_revision,
                    )
                )
            elif isinstance(ref, IntegrationToolRef):
                leases.append(
                    await ledger_gateway.insert_capability_lease(
                        db,
                        run_id=run_id,
                        slot_id=slot_id,
                        kind=ref.kind,
                        capability_key=ref.capability_key,
                        plan_hash=plan_hash,
                        provider_definition_id=ref.provider_definition_id,
                        provider_revision=ref.provider_revision,
                        tool_name=ref.tool_name,
                        input_schema_hash=ref.input_schema_hash,
                    )
                )
    return tuple(leases)
