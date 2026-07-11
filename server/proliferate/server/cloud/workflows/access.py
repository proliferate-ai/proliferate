"""Fail-closed legacy run-report credential lookups during WF-ID cutover.

The old routes remain mounted only to return typed feature-off errors and to
reject unknown/mismatched credentials safely. WF-ID parks every historical
run-token row and has no mint path. These dependencies therefore provide no
activation edge; the future final-envelope contract must replace them.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import optional_current_active_user
from proliferate.config import settings
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.workflow_ledger import legacy_tokens as legacy_token_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.time import utcnow


def require_workflows_enabled() -> None:
    """D-003 launch flag: the whole workflows surface 404s while disabled.

    404 (not 403) so a dark production deployment doesn't advertise the
    surface's existence; the desktop hides its entry points from the same
    flag via ``/meta`` ``workflowsEnabled``. Guards both the workflows router
    and the function-invocations router (invocations exist for workflows).
    """
    if not settings.workflows_enabled:
        raise CloudApiError(
            "workflows_disabled",
            "Workflows are not enabled on this deployment.",
            status_code=404,
        )


@dataclass(frozen=True)
class RunTokenActor:
    """Legacy actor shape used only before the feature-off service gate."""

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
    """Resolve a still-valid legacy token or user only to reach the feature-off gate.

    A valid run token that belongs to a *different* run is a spoofing attempt →
    403 (mirrors ``/ping``). A bearer that is not a run token falls through to
    user-session auth (e.g. a JWT-authed desktop). No credential at all → 401.
    """

    token = bearer_token_from_request(request)
    if token:
        grant = await legacy_token_store.get_active_run_gateway_token_by_hash(
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
    """Fail closed on legacy completion-ping credentials before the parked gate.

    Requires token<->run_id match so a historical run A credential cannot reach
    run B. WF-ID creates no such credentials and the migration expires all old
    rows.
    """

    token = bearer_token_from_request(request)
    if not token:
        raise CloudApiError(
            "workflow_ping_unauthorized",
            "Missing or malformed run ping token.",
            status_code=401,
        )
    grant = await legacy_token_store.get_active_run_gateway_token_by_hash(
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
