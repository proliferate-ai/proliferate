"""Seat lifecycle glue (agent_auth spec §4 cell 1, seats v1).

A seat is a portable Claude Max subscription credential: one
``anthropic_subscription`` vault row whose ciphertext decrypts to a long-lived
``claude setup-token`` OAuth token. This module is the mint intake — the one
upward secret path (spec §3 flow 2): the runtime captures the token in memory,
the courier POSTs it here exactly once, and the vault row is born with the
user-entered identity (the token carries no profile scope, so the system can
learn neither email nor plan on its own).

No probe loop lives here: verification is the ordinary launch probe, run
runtime-side under the seat's isolated home after the next delivery applies
(spec §3 flow 2's "Verification is the ordinary launch probe"). Usage probing
is a later slice; slice 2 adds the limit-hit intake (the courier's relay of a
runtime-observed limit error — the audit half of rotation, spec §3 flow 5's
hard signal; the rotation *decision* stays runtime-local).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
    AGENT_API_KEY_STATUS_ACTIVE,
    AGENT_AUTH_SEAT_CAPABLE_HARNESS_KINDS,
    AGENT_AUTH_SOURCE_SEAT,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentApiKeyRecord
from proliferate.server.agent_auth.budget import get_gateway_enrollment_for_user
from proliferate.server.api_errors import CloudApiError
from proliferate.server.event_logging import log_cloud_event

_MAX_TITLE_LENGTH = 255
_MAX_TOKEN_LENGTH = 4096
_MAX_EMAIL_LENGTH = 255
_MAX_PLAN_TIER_LENGTH = 64


def compose_seat_title(
    *,
    title: str | None,
    email: str | None,
    plan_tier: str | None,
    existing_seat_count: int,
) -> str:
    """The seat's display identity: user words, or "Max seat N".

    An explicit ``title`` wins verbatim. Otherwise the entered email becomes
    "Max seat · <email>" (the spec §2 DDL's example shape) and the optional
    plan tier rides as a display tag — there is no plan column; the title IS
    the label the pane renders. With nothing entered, seats number themselves.
    """
    if title:
        base = title
    elif email:
        base = f"Max seat · {email}"
    else:
        base = f"Max seat {existing_seat_count + 1}"
    if plan_tier:
        base = f"{base} · {plan_tier}"
    return base


async def create_seat(
    db: AsyncSession,
    *,
    user_id: UUID,
    token: str,
    title: str | None = None,
    email: str | None = None,
    plan_tier: str | None = None,
) -> AgentApiKeyRecord:
    """Mint intake: persist a captured seat token as a vault row.

    Called by the keys-create route when the courier uploads a mint capture
    (``kind='anthropic_subscription'``). The token is validated only for
    shape-of-a-secret (non-empty, bounded) — the capture rule already gated
    the format runtime-side, and over-validating here would strand a token
    the vendor legitimately reshapes.
    """
    token = token.strip()
    if not token or len(token) > _MAX_TOKEN_LENGTH:
        raise CloudApiError(
            "invalid_agent_seat_token",
            "The seat token must be a non-empty string.",
            status_code=400,
        )
    title = title.strip() if title else None
    if title and len(title) > _MAX_TITLE_LENGTH:
        raise CloudApiError(
            "invalid_agent_api_key_title",
            f"Title must be 1-{_MAX_TITLE_LENGTH} characters.",
            status_code=400,
        )
    email = email.strip() if email else None
    if email and len(email) > _MAX_EMAIL_LENGTH:
        raise CloudApiError(
            "invalid_agent_seat_label",
            f"Email must be 1-{_MAX_EMAIL_LENGTH} characters.",
            status_code=400,
        )
    plan_tier = plan_tier.strip() if plan_tier else None
    if plan_tier and len(plan_tier) > _MAX_PLAN_TIER_LENGTH:
        raise CloudApiError(
            "invalid_agent_seat_label",
            f"Plan tier must be 1-{_MAX_PLAN_TIER_LENGTH} characters.",
            status_code=400,
        )

    existing = await agent_gateway_store.list_agent_api_keys(db, user_id=user_id)
    existing_seat_count = sum(
        1 for record in existing if record.kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION
    )
    composed_title = compose_seat_title(
        title=title,
        email=email,
        plan_tier=plan_tier,
        existing_seat_count=existing_seat_count,
    )
    if len(composed_title) > _MAX_TITLE_LENGTH:
        composed_title = composed_title[:_MAX_TITLE_LENGTH]

    record = await agent_gateway_store.create_agent_seat(
        db,
        user_id=user_id,
        title=composed_title,
        value=token,
    )
    log_cloud_event(
        "agent_seat_minted",
        user_id=str(user_id),
        api_key_id=str(record.id),
    )
    return record


async def _seat_harness_kind(db: AsyncSession, *, user_id: UUID) -> str:
    """The harness a limit hit belongs to, derived from the caller's selections.

    The wire report carries no harness (the seat is account-global), so the
    hit is attributed to the harness kind of the caller's ENABLED seat
    selections. None, or more than one distinct kind, falls back to the one
    seat-capable kind — seats are claude-only this slice
    (``AGENT_AUTH_SEAT_CAPABLE_HARNESS_KINDS``), so the fallback cannot
    misattribute.
    """
    selections = await agent_gateway_store.list_auth_selections(db, user_id=user_id)
    kinds = {
        selection.harness_kind
        for selection in selections
        if selection.enabled and selection.source_kind == AGENT_AUTH_SOURCE_SEAT
    }
    if len(kinds) == 1:
        return next(iter(kinds))
    return AGENT_AUTH_SEAT_CAPABLE_HARNESS_KINDS[0]


async def report_seat_limit_hit(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_id: UUID,
    window: str | None,
    reset_at: datetime,
) -> None:
    """Record a runtime-observed seat limit hit (spec §3 flow 5, hard signal).

    The courier relays the hit fire-and-forget; cooling is runtime-local and
    never waits on this. The server never picks the next seat — when another
    active seat exists the runtime will rotate, so ``agent_seat_rotated`` is
    logged beside the hit, carrying the seat rotated AWAY FROM. Events carry
    ids only, never token material.
    """
    keys = await agent_gateway_store.list_agent_api_keys(db, user_id=user_id, include_revoked=True)
    hit = next((record for record in keys if record.id == api_key_id), None)
    if hit is None or hit.kind != AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION:
        # Foreign, vanished, and non-seat keys are indistinguishable to the
        # caller — one 404 in the surface's standard envelope.
        raise CloudApiError(
            "agent_api_key_not_found",
            "Seat not found.",
            status_code=404,
        )

    harness_kind = await _seat_harness_kind(db, user_id=user_id)
    # Org attribution follows the gateway payer law's default-org resolution;
    # omitted when the caller has no enrollment (log_cloud_event drops None).
    enrollment = await get_gateway_enrollment_for_user(db, user_id)
    organization_id = (
        str(enrollment.organization_id)
        if enrollment is not None and enrollment.organization_id is not None
        else None
    )

    log_cloud_event(
        "agent_seat_limit_hit",
        user_id=str(user_id),
        organization_id=organization_id,
        api_key_id=str(api_key_id),
        harness_kind=harness_kind,
        window=window,
        reset_at=reset_at.isoformat(),
    )
    has_other_active_seat = any(
        record.id != api_key_id
        and record.kind == AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION
        and record.status == AGENT_API_KEY_STATUS_ACTIVE
        for record in keys
    )
    if has_other_active_seat:
        log_cloud_event(
            "agent_seat_rotated",
            user_id=str(user_id),
            organization_id=organization_id,
            api_key_id=str(api_key_id),
            harness_kind=harness_kind,
        )
