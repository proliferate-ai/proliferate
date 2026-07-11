"""Run-facing resource-access deps for the workflow control plane (D18/L16, E7).

Run-facing HTTP surfaces authenticate with a run-scoped bearer credential instead
of route-level org authorization: the per-run gateway token(s) (the runtime
reporting/pinging/exchanging on its own behalf) and, for ``/status`` /
``/delivered`` / the local heartbeat, a fallback to the caller's own user session
(the desktop local-lane relay). Each dep resolves the credential against the
route's ``run_id`` path param and returns an actor the service layer treats
uniformly (:class:`RunTokenActor` or the reporting ``User``).

WS3b typed audiences (feature spec §5.3): every new-style credential carries an
``audience`` and each surface accepts only its own family — a run_report token
cannot ping, an integration credential cannot report, a delivery-claim credential
cannot be replayed as a report, and so on. A LEGACY (pre-WS3b) all-purpose run
token has a NULL audience and still authenticates everywhere it did before
migration; enforcement is strict only for new-style (audience-stamped) tokens.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import optional_current_active_user
from proliferate.config import settings
from proliferate.constants.workflows import (
    WORKFLOW_CONTROL_CHANNEL_AUDIENCES,
    WORKFLOW_CREDENTIAL_AUDIENCE_DELIVERY_CLAIM,
    WORKFLOW_CREDENTIAL_AUDIENCE_PING,
    WORKFLOW_CREDENTIAL_AUDIENCE_RUN_REPORT,
)
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store import workflow_credentials as credentials_store
from proliferate.db.store.workflow_credentials import AudienceTokenRecord
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


async def resolve_run_token_for_audience(
    db: AsyncSession,
    *,
    token: str,
    run_id: UUID,
    audiences: Iterable[str],
    mismatch_code: str,
    wrong_audience_code: str,
) -> AudienceTokenRecord | None:
    """Resolve a bearer to an active run gateway token bound to ``run_id`` whose
    audience is allowed for this endpoint family, or ``None`` if the bearer is not
    a run token at all (caller may then fall back to user-session auth).

    Denials that are NOT "no token" raise immediately:

    * a valid token for a DIFFERENT run → 403 (spoofing; mirrors ``/ping``).
    * a valid new-style token with the WRONG audience → 403.

    A LEGACY token (``audience is None``) is accepted for any endpoint family.
    """

    if not token:
        return None
    grant = await credentials_store.get_audience_token_by_hash(
        db,
        token_hash=runtime_workers_store.hash_workflow_run_gateway_token(token),
        now=utcnow(),
    )
    if grant is None:
        return None
    if grant.workflow_run_id != run_id:
        raise CloudApiError(
            mismatch_code,
            "This run token does not belong to the addressed run.",
            status_code=403,
        )
    if grant.audience is not None and grant.audience not in set(audiences):
        raise CloudApiError(
            wrong_audience_code,
            f"This credential's audience '{grant.audience}' is not accepted here.",
            status_code=403,
        )
    return grant


async def authorize_run_report(
    run_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    user: User | None = Depends(optional_current_active_user),
) -> RunTokenActor | User:
    """D18 (E7): accept EITHER the run_report credential (the runtime self-reporting
    ``/status`` / ``/delivered``) OR a user session (the desktop local-lane relay).

    WS3b: a new-style token must carry the ``run_report`` audience; a ping,
    integration, or delivery-claim credential is denied (403). A legacy all-purpose
    token still authenticates. A bearer that is not a run token falls through to
    user-session auth. No credential at all → 401.
    """

    grant = await resolve_run_token_for_audience(
        db,
        token=bearer_token_from_request(request),
        run_id=run_id,
        audiences={WORKFLOW_CREDENTIAL_AUDIENCE_RUN_REPORT},
        mismatch_code="workflow_run_token_mismatch",
        wrong_audience_code="workflow_run_report_wrong_audience",
    )
    if grant is not None:
        return RunTokenActor(id=grant.owner_user_id)
    if user is not None:
        return user
    raise CloudApiError(
        "workflow_run_report_unauthorized",
        "A user session or the run-report credential is required.",
        status_code=401,
    )


async def authorize_run_ping(
    run_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> RunTokenActor:
    """Completion ping (L16 / §3.7) auth. NO user-session auth — the ping credential
    IS the auth. WS3b: a new-style token must carry the ``ping`` audience (a
    run_report/integration/delivery-claim credential is denied 403); a legacy
    all-purpose token still authenticates. Requires token<->run_id match.
    """

    token = bearer_token_from_request(request)
    if not token:
        raise CloudApiError(
            "workflow_ping_unauthorized",
            "Missing or malformed run ping token.",
            status_code=401,
        )
    grant = await resolve_run_token_for_audience(
        db,
        token=token,
        run_id=run_id,
        audiences={WORKFLOW_CREDENTIAL_AUDIENCE_PING},
        mismatch_code="workflow_ping_run_mismatch",
        wrong_audience_code="workflow_ping_wrong_audience",
    )
    if grant is None:
        # Unknown, expired (terminal run), or revoked token.
        raise CloudApiError(
            "workflow_ping_unauthorized",
            "Run ping token is invalid, expired, or revoked.",
            status_code=401,
        )
    return RunTokenActor(id=grant.owner_user_id)


async def authorize_delivery_claim(
    run_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    user: User | None = Depends(optional_current_active_user),
) -> RunTokenActor | User:
    """Desktop local-lane run-scoped claim callback (heartbeat) auth (§5.3).

    Accepts EITHER the ``delivery_claim`` credential (a device cannot replay
    another audience's token here) OR the desktop's user session (today's local
    executor auth, unchanged during migration). A new-style token of any other
    audience is denied 403; a legacy all-purpose token still authenticates. No
    credential and no session → 401.
    """

    grant = await resolve_run_token_for_audience(
        db,
        token=bearer_token_from_request(request),
        run_id=run_id,
        audiences={WORKFLOW_CREDENTIAL_AUDIENCE_DELIVERY_CLAIM},
        mismatch_code="workflow_delivery_claim_run_mismatch",
        wrong_audience_code="workflow_delivery_claim_wrong_audience",
    )
    if grant is not None:
        return RunTokenActor(id=grant.owner_user_id)
    if user is not None:
        return user
    raise CloudApiError(
        "workflow_delivery_claim_unauthorized",
        "A user session or the delivery-claim credential is required.",
        status_code=401,
    )


async def authorize_control_channel(
    run_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> RunTokenActor:
    """Authenticated control channel for credential exchange/ACK (§5.3).

    The runtime drives handle exchange + install ACK with its ``run_report`` or
    ``delivery_claim`` credential (never an integration or ping credential). A
    legacy all-purpose token is accepted for compat. No token → 401.
    """

    token = bearer_token_from_request(request)
    if not token:
        raise CloudApiError(
            "workflow_control_channel_unauthorized",
            "Missing or malformed control-channel credential.",
            status_code=401,
        )
    grant = await resolve_run_token_for_audience(
        db,
        token=token,
        run_id=run_id,
        audiences=WORKFLOW_CONTROL_CHANNEL_AUDIENCES,
        mismatch_code="workflow_control_channel_run_mismatch",
        wrong_audience_code="workflow_control_channel_wrong_audience",
    )
    if grant is None:
        raise CloudApiError(
            "workflow_control_channel_unauthorized",
            "Control-channel credential is invalid, expired, or revoked.",
            status_code=401,
        )
    return RunTokenActor(id=grant.owner_user_id)
