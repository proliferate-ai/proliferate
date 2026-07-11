"""Secret-free workflow namespace scope resolution and readiness checks.

WF-ID deliberately has no callable plaintext gateway-token mint/rotation/builder
path. StartRun freezes public namespace/capability intent only; later credential
packets must introduce a separately versioned private execution envelope before
runtime activation can be enabled.

Scope resolution is layered (E3: NAMESPACE-LEVEL — no tool lists anywhere):

* StartRun: scope = the definition's ``integrations[]`` namespaces, stamped
  per slot into ``scope_json`` (``{"<slot>": {"integrations": [...]}}`` — §2.6). No
  ``tools/list`` fetch, no new failure mode. L22 fail-fast — a declared namespace
  with no ready account (org-aware, the same lookup the gateway uses) FAILS the run
  rather than silently narrowing. The gateway treats a namespace grant as "ALL
  tools of that provider" at call time (``domain/scope.py``).
* delivery (cloud lane, worker known): the frozen run scope is intersected with the
  delivering worker's allowlist (L25 layer 2 ⊆ layer 1) at NAMESPACE granularity.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import FUNCTION_INVOCATION_PROVIDER_NAMESPACE
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.definition import iter_agent_nodes


def resolve_run_scope(definition: dict[str, object]) -> dict[str, dict[str, object]]:
    """The run's frozen namespace grant, stamped per slot (E3, §2.6).

    Shape: ``{"<slot>": {"integrations": ["linear", "slack"]}}``. The definition's
    workflow-level ``integrations`` list applies to every slot by default; a node
    that declares its own ``integrations`` list (already validated as a subset at
    save time, ``definition.py``) narrows just that slot's grant (track 3c phase
    2 — resolver-only change, per the data contract's "the resolved plan is
    already per-slot" note; no schema change to the frozen token). No
    ``tools/list`` fetch, no per-provider tool arrays.

    The per-slot map is public authorization intent. Exact enforcement is owned by
    capability leases plus the future private credential envelope; this module
    does not mint or deliver a bearer.

    Composition (L20) inlines a child's *steps*, not its grant: the run's scope is
    the top-level definition's own ``integrations[]`` (L24 — each definition sizes
    its own grant). A composed workflow must declare the union it needs.
    """

    namespaces: list[str] = []
    seen: set[str] = set()
    for item in definition.get("integrations") or []:
        if isinstance(item, str) and item not in seen:
            seen.add(item)
            namespaces.append(item)

    scope: dict[str, dict[str, object]] = {}
    # Flatten parallel groups (L30): every lane is its own slot/session and must
    # get its own grant entry, exactly like a standalone node.
    for node in iter_agent_nodes(definition.get("agents") or []):
        if not isinstance(node, dict):
            continue
        slot = node.get("slot")
        if not isinstance(slot, str):
            continue
        node_integrations = node.get("integrations")
        if isinstance(node_integrations, list):
            slot_namespaces = [ns for ns in node_integrations if isinstance(ns, str)]
        else:
            slot_namespaces = list(namespaces)
        scope[slot] = {"integrations": slot_namespaces}
    # A grant with no slots (e.g. a zero-agent draft) is a no-op scope.
    return scope


def granted_namespaces(scope: dict[str, dict[str, object]]) -> list[str]:
    """The flat, sorted union of integration namespaces a run's scope grants.

    Used for the L22 ready-account check, capability freezing, and the save-time
    visibility check. Since v1 stamps every slot with the same workflow-level list,
    this is just that list; the union keeps it correct under per-slot narrowing.
    """

    out: set[str] = set()
    for slot_scope in scope.values():
        if not isinstance(slot_scope, dict):
            continue
        for ns in slot_scope.get("integrations") or []:
            if isinstance(ns, str):
                out.add(ns)
    return sorted(out)


async def _organization_id_for_owner(db: AsyncSession, *, owner_user_id: UUID) -> UUID | None:
    membership = await organizations_store.get_current_membership_for_user(db, owner_user_id)
    return membership.organization.id if membership is not None else None


async def visible_provider_namespaces(db: AsyncSession, *, owner_user_id: UUID) -> set[str]:
    """The integration-definition namespaces visible to a workflow owner (save-time).

    Seed definitions plus (if the owner is in an org) that org's customs — the same
    visibility the integrations UI shows.
    """

    org_id = await _organization_id_for_owner(db, owner_user_id=owner_user_id)
    if org_id is not None:
        definitions = await definitions_store.list_definitions_visible_to_org(db, org_id)
    else:
        definitions = await definitions_store.list_seed_definitions(db)
    namespaces = {definition.namespace for definition in definitions}
    # The reserved ``functions`` virtual provider (track 1b): it has no
    # integration-definition row by design (the reservation check forbids one),
    # so it is grantable exactly when the owner has ≥1 live invocation.
    if await invocations_store.list_for_owner(db, owner_user_id):
        namespaces.add(FUNCTION_INVOCATION_PROVIDER_NAMESPACE)
    return namespaces


async def assert_declared_providers_ready(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    namespaces: list[str],
) -> None:
    """L22 fail-fast at StartRun: every declared namespace must have a ready account.

    Org-aware — uses the same account+policy lookup the gateway uses, so a provider
    the owner's org has disabled counts as not-ready. Raises ``CloudApiError`` (the
    run is never created), never silently narrows the grant.
    """

    if not namespaces:
        return
    organization_id = await _organization_id_for_owner(db, owner_user_id=owner_user_id)
    for provider in namespaces:
        if provider == FUNCTION_INVOCATION_PROVIDER_NAMESPACE:
            # The virtual ``functions`` provider has no integration account;
            # "ready" means the owner has ≥1 live invocation definition.
            if not await invocations_store.list_for_owner(db, owner_user_id):
                raise CloudApiError(
                    "workflow_function_provider_not_ready",
                    "This workflow grants function invocations, but you have no "
                    "function invocations defined. Create one before running.",
                    status_code=409,
                )
            continue
        row = await accounts_store.get_ready_account_for_provider(
            db, owner_user_id, provider, organization_id=organization_id
        )
        if row is None or not accounts_store.org_policy_allows(
            row, organization_id=organization_id
        ):
            raise CloudApiError(
                "workflow_function_provider_not_ready",
                f"This workflow grants the '{provider}' integration, but you have no "
                f"ready '{provider}' integration. Connect it before running.",
                status_code=409,
            )
