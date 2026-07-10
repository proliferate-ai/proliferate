"""Per-run gateway token minting + scope resolution (PR E / OPEN-3a, L16/L22/L25).

Every run mints exactly one per-run gateway token at StartRun — even a run with an
empty function grant (L16: the token doubles as the completion-ping credential).
The plaintext rides inside ``resolved_plan_json.gateway``; only the hash is stored.

Scope resolution is layered (E3: NAMESPACE-LEVEL — no tool lists anywhere):

* mint (StartRun): scope = the definition's ``integrations[]`` namespaces, stamped
  per slot into ``scope_json`` (``{"<slot>": {"integrations": [...]}}`` — §2.6). No
  ``tools/list`` fetch, no new failure mode. L22 fail-fast — a declared namespace
  with no ready account (org-aware, the same lookup the gateway uses) FAILS the run
  rather than silently narrowing. The gateway treats a namespace grant as "ALL
  tools of that provider" at call time (``domain/scope.py``).
* delivery (cloud lane, worker known): the frozen run scope is intersected with the
  delivering worker's allowlist (L25 layer 2 ⊆ layer 1) at NAMESPACE granularity.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CLOUD_WORKFLOW_RUN_PING_PATH_TEMPLATE
from proliferate.constants.workflows import WORKFLOW_RUN_GATEWAY_TOKEN_TTL_SECONDS
from proliferate.server.cloud.workflows.domain.definition import iter_agent_nodes
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime_workers.service import (
    integration_gateway_config,
    worker_cloud_base_url,
)
from proliferate.utils.time import utcnow

_TOKEN_BYTES = 48


def resolve_run_scope(definition: dict[str, object]) -> dict[str, dict[str, object]]:
    """The run's frozen namespace grant, stamped per slot (E3, §2.6).

    Shape: ``{"<slot>": {"integrations": ["linear", "slack"]}}``. The definition's
    workflow-level ``integrations`` list applies to every slot by default; a node
    that declares its own ``integrations`` list (already validated as a subset at
    save time, ``definition.py``) narrows just that slot's grant (track 3c phase
    2 — resolver-only change, per the data contract's "the resolved plan is
    already per-slot" note; no schema change to the frozen token). No
    ``tools/list`` fetch, no per-provider tool arrays.

    Enforcement caveat: the per-run gateway token is per-run, not per-slot, and a
    caller does not identify its slot, so the gateway enforces the UNION of every
    slot's grant (``_flatten_run_scope`` in integration_gateway/dependencies.py).
    The per-slot grant here narrows what each slot is GIVEN in the frozen token; true
    per-slot enforcement (callers identifying their slot) is Part II future work.

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

    Used for the L22 ready-account check, the plan's gateway ``integrations``
    block, and the save-time visibility check. Since v1 stamps every slot with the
    same workflow-level list, this is just that list; the union keeps it correct if
    per-slot narrowing lands later.
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
    return {definition.namespace for definition in definitions}


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
        account_pair = await accounts_store.get_ready_account_for_provider(
            db, owner_user_id, provider, organization_id=organization_id
        )
        if account_pair is None:
            raise CloudApiError(
                "workflow_function_provider_not_ready",
                f"This workflow grants the '{provider}' integration, but you have no "
                f"ready '{provider}' integration. Connect it before running.",
                status_code=409,
            )


async def mint_run_gateway_token(
    db: AsyncSession,
    *,
    run_id: UUID,
    owner_user_id: UUID,
    scope: dict[str, dict[str, object]],
) -> tuple[str, dict[str, object]]:
    """Mint the run's gateway token and build the ``resolved_plan_json.gateway`` block.

    Returns ``(plaintext_token, gateway_block)``. The run row must already exist
    (the token FKs ``workflow_run.id``). Identical shape on every lane (L16).
    """

    organization_id = await _organization_id_for_owner(db, owner_user_id=owner_user_id)
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    await store.create_run_gateway_token(
        db,
        workflow_run_id=run_id,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        token_hash=runtime_workers_store.hash_workflow_run_gateway_token(token),
        scope_json=scope,
        expires_at=utcnow() + timedelta(seconds=WORKFLOW_RUN_GATEWAY_TOKEN_TTL_SECONDS),
    )
    return token, build_gateway_plan_block(token=token, run_id=run_id, scope=scope)


async def rotate_run_gateway_token(
    db: AsyncSession,
    *,
    run_id: UUID,
    owner_user_id: UUID,
    scope: dict[str, dict[str, object]],
) -> tuple[str, dict[str, object]]:
    """Rotate a run's per-run gateway token (track 2a claim/reclaim).

    Expires the run's existing active token(s) and mints a fresh one bound to the
    same run + scope. Used on every local claim/reclaim so a laptop that lost the
    run (reclaimed by another device) is left holding an EXPIRED token: the gateway
    refuses its calls and the token-authed ``/status`` path 401s it
    (``get_active_run_gateway_token_by_hash`` already filters on status=active AND
    unexpired). Returns the same ``(plaintext_token, gateway_block)`` pair as
    :func:`mint_run_gateway_token` so the caller can fold it into the resolved plan
    it hands the new claimant, exactly mirroring StartRun's mint+embed.
    """

    await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run_id)
    return await mint_run_gateway_token(
        db, run_id=run_id, owner_user_id=owner_user_id, scope=scope
    )


def _ping_url(run_id: UUID) -> str:
    base = worker_cloud_base_url()
    if not base:
        raise CloudApiError(
            "cloud_worker_misconfigured",
            "No cloud base URL is configured for the workflow completion ping.",
            status_code=500,
        )
    return f"{base}{CLOUD_WORKFLOW_RUN_PING_PATH_TEMPLATE.format(run_id=run_id)}"


def build_gateway_plan_block(
    *, token: str, run_id: UUID, scope: dict[str, dict[str, object]]
) -> dict[str, object]:
    """The plan's gateway block: url (same as enroll composes), authorization,
    ping_url, and the resolved namespace grant (E3: a flat list of integration
    namespaces, possibly empty — the runtime only reads its emptiness for the L22
    local-lane fail-fast; it never inspects tools)."""

    config = integration_gateway_config(token)
    return {
        "url": config.url,
        "authorization": config.authorization,
        "ping_url": _ping_url(run_id),
        "integrations": granted_namespaces(scope),
    }
