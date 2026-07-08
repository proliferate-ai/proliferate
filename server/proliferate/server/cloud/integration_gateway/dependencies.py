"""Auth for the integration gateway: bearer token -> owner grant.

A bearer resolves to one of two grants, tried in order (§6.4/6.7):

1. A **per-run** workflow gateway token (PR E). The token IS the run: the grant
   carries ``run_id``/``workflow_id`` and the run's frozen function scope
   (``run_scope``, layer 2). It is tried FIRST — its own HMAC domain means a run
   token can never collide with a worker token.
2. The **per-worker** AnyHarness gateway token (unchanged). ``run_scope`` is None
   (no per-run function restriction).

Both grants carry ``worker_scope`` (L25 layer 1), re-resolved on every request so a
worker allowlist narrowed *after* a run token was minted bites on the next call.
"""

from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.db.store import cloud_workflows as workflows_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.runtime_workers import IntegrationGatewayGrant
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.time import utcnow


def _bearer_token_from_request(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise CloudApiError(
            "integration_gateway_unauthorized",
            "Missing or malformed gateway bearer token.",
            status_code=401,
        )
    return token.strip()


async def _resolve_run_token_grant(
    db: AsyncSession, *, token: str
) -> IntegrationGatewayGrant | None:
    """Resolve a per-run workflow gateway token, or None if the bearer isn't one."""

    run_token = await workflows_store.get_active_run_gateway_token_by_hash(
        db,
        token_hash=runtime_workers_store.hash_workflow_run_gateway_token(token),
        now=utcnow(),
    )
    if run_token is None:
        return None
    # L25 layer 1, re-checked per request: the delivering worker is the owner's
    # active cloud-sandbox worker; a scope narrowed after mint bites here.
    worker_scope = await runtime_workers_store.get_active_worker_gateway_scope_for_owner(
        db, owner_user_id=run_token.owner_user_id
    )
    return IntegrationGatewayGrant(
        owner_user_id=run_token.owner_user_id,
        organization_id=run_token.organization_id,
        run_id=run_token.workflow_run_id,
        run_scope=_flatten_run_scope(run_token.scope_json),
        worker_scope=worker_scope,
    )


def _flatten_run_scope(scope_json: object) -> list[dict[str, object]]:
    """E3: the per-slot namespace grant (``{"<slot>": {"integrations": [...]}}``)
    flattened into the namespace-level run scope the pure enforcement layer
    consumes — one namespace-only entry per granted provider (``{"provider": ns}``,
    no ``tools`` key), deduped across slots.

    The gateway token is per-run, not per-slot, and the caller does not identify
    its slot, so enforcement is the union of every slot's grant. A namespace-only
    entry means "ALL tools of that provider" at call time (``domain/scope.py``).
    """

    if not isinstance(scope_json, dict):
        return []
    namespaces: set[str] = set()
    for slot_scope in scope_json.values():
        if not isinstance(slot_scope, dict):
            continue
        for ns in slot_scope.get("integrations") or []:
            if isinstance(ns, str):
                namespaces.add(ns)
    return [{"provider": ns} for ns in sorted(namespaces)]


async def require_integration_gateway_grant(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationGatewayGrant:
    """Resolve the gateway bearer to its owning identity + scope.

    A per-run token is tried first (its scope is the run's frozen grant); otherwise
    the per-worker token resolves (unscoped by run, subject only to the worker
    allowlist as today).
    """
    token = _bearer_token_from_request(request)

    run_grant = await _resolve_run_token_grant(db, token=token)
    if run_grant is not None:
        return run_grant

    grant = await runtime_workers_store.get_grant_by_gateway_token_hash(
        db,
        token_hash=runtime_workers_store.hash_gateway_token(token),
    )
    if grant is None:
        raise CloudApiError(
            "integration_gateway_unauthorized",
            "Gateway token is invalid or revoked.",
            status_code=401,
        )
    return grant


__all__ = ["IntegrationGatewayGrant", "require_integration_gateway_grant"]
