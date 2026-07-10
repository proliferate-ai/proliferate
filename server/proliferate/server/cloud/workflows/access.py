"""Run-report resource-access deps for the workflow gateway plane (D18/L16, E7).

Two run-facing HTTP surfaces authenticate with a run-scoped bearer credential
instead of route-level org authorization: the per-run gateway token (anyharness
reporting on its own behalf, or the completion ping) and, for ``/status`` and
``/delivered``, a fallback to the caller's own user session (the desktop
local-lane relay). Both deps below resolve the credential against the route's
``run_id`` path param and return an actor the service layer treats uniformly
(:class:`RunTokenActor` or the reporting ``User``) — the same
resource-lookup-plus-actor-composition shape ``server/<domain>/access.py``
deps use elsewhere, just keyed off a bearer credential instead of org standing.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import optional_current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class RunTokenActor:
    """Minimal actor for a runtime-authenticated run report (D18 / L16). The per-run
    gateway token proves the run, so the owner id is all downstream owner-scoped
    checks need — the executor is always the workflow owner in v1."""

    id: UUID


def bearer_token_from_request(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, raw = header.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return raw.strip()


async def authorize_run_report(
    run_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    user: User | None = Depends(optional_current_active_user),
) -> RunTokenActor | User:
    """D18 (E7): accept EITHER the per-run gateway token (anyharness reporting on
    its own behalf) OR a user session (the desktop local-lane relay) as the
    credential for ``/status`` and ``/delivered``.

    A valid run token that belongs to a *different* run is a spoofing attempt →
    403 (mirrors ``/ping``). A bearer that is not a run token falls through to
    user-session auth (e.g. a JWT-authed desktop). No credential at all → 401.
    """

    token = bearer_token_from_request(request)
    if token:
        grant = await store.get_active_run_gateway_token_by_hash(
            db,
            token_hash=runtime_workers_store.hash_workflow_run_gateway_token(token),
            now=utcnow(),
        )
        if grant is not None:
            if grant.workflow_run_id != run_id:
                raise CloudApiError(
                    "workflow_run_token_mismatch",
                    "This run token does not belong to the reported run.",
                    status_code=403,
                )
            return RunTokenActor(id=grant.owner_user_id)
    if user is not None:
        return user
    raise CloudApiError(
        "workflow_run_report_unauthorized",
        "A user session or the per-run gateway token is required.",
        status_code=401,
    )


async def authorize_run_ping(
    run_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> RunTokenActor:
    """Completion ping (L16 / §3.7) authentication. NO user-session auth — the
    per-run gateway token IS the auth. Requires token<->run_id match (so run A's
    token can't ping run B). Duplicate/stale/late pings are safe by construction,
    so the endpoint body only needs a valid, matching token to proceed.
    """

    token = bearer_token_from_request(request)
    if not token:
        raise CloudApiError(
            "workflow_ping_unauthorized",
            "Missing or malformed run ping token.",
            status_code=401,
        )
    grant = await store.get_active_run_gateway_token_by_hash(
        db,
        token_hash=runtime_workers_store.hash_workflow_run_gateway_token(token),
        now=utcnow(),
    )
    if grant is None:
        # Unknown, expired (terminal run), or revoked token.
        raise CloudApiError(
            "workflow_ping_unauthorized",
            "Run ping token is invalid, expired, or revoked.",
            status_code=401,
        )
    if grant.workflow_run_id != run_id:
        raise CloudApiError(
            "workflow_ping_run_mismatch",
            "This token does not belong to the pinged run.",
            status_code=403,
        )
    return RunTokenActor(id=grant.owner_user_id)
