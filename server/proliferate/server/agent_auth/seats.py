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
and rotation are later slices.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_KIND_ANTHROPIC_SUBSCRIPTION,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentApiKeyRecord
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
