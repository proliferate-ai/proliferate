"""Eager LiteLLM enrollment for users and organizations.

Every enrollment ensures the durable row first (idempotent), then — when the
gateway is enabled — provisions the LiteLLM team, user, and virtual key and
marks the row synced. Failures mark the row failed; the backfill worker
retries pending/failed rows and discovers users created before the hooks
existed.
"""

from __future__ import annotations

import hashlib
import logging
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
    AGENT_GATEWAY_SUBJECT_KIND_USER,
    AGENT_GATEWAY_SYNC_STATUS_SYNCED,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.integrations import litellm
from proliferate.integrations.litellm import LiteLLMIntegrationError, LiteLLMVirtualKey
from proliferate.server.cloud.agent_gateway.free_credits import ensure_user_free_credit_grant

logger = logging.getLogger(__name__)

# When a subject with an active grant has exhausted it, LiteLLM's ``max_budget``
# must mirror a *near-zero* cap rather than "0" — our ``_parse_budget`` reads
# "0"/empty as "uncapped" (the org-default semantics), so flooring at exactly 0
# would mint an unbounded key for an out-of-credit subject. A tiny positive
# floor keeps the key effectively blocked (never unbounded) while the importer
# also disables it on the next tick.
_EXHAUSTED_BUDGET_FLOOR_USD = Decimal("0.01")


def build_sync_fingerprint(*, team_id: str, budget: str, key_alias: str) -> str:
    """Stable hash of the provisioned LiteLLM state, used to detect drift."""
    material = f"{team_id}|{budget}|{key_alias}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _parse_budget(raw: str) -> float | None:
    """Budget settings are strings; "0"/empty means uncapped (no budget sent)."""
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _key_alias(enrollment_id: UUID, subject_label: str) -> str:
    return f"vk-{subject_label}-{str(enrollment_id)[:8]}"


def _is_duplicate_alias_error(error: LiteLLMIntegrationError) -> bool:
    """A 400 whose message mentions the alias == LiteLLM rejecting a dup alias."""
    return error.status_code == 400 and "alias" in error.message.lower()


async def _mint_virtual_key_idempotent(
    *,
    user_id: str,
    team_id: str,
    alias: str,
    max_budget: float | None,
    metadata: dict[str, str],
) -> LiteLLMVirtualKey:
    """Mint a virtual key, tolerating an orphaned key under the same alias.

    The alias is deterministic per enrollment, so a crash/rollback after a
    prior mint (id never committed) leaves a live key we no longer track. On
    the duplicate-alias 400 we purge that orphan and re-mint, guaranteeing the
    enrollment ends up owning a key we also hold the raw secret for.
    """
    try:
        return await litellm.mint_virtual_key(
            user_id=user_id,
            team_id=team_id,
            alias=alias,
            max_budget=max_budget,
            metadata=metadata,
        )
    except LiteLLMIntegrationError as error:
        if not _is_duplicate_alias_error(error):
            raise
        await litellm.delete_virtual_keys_by_alias(alias=alias)
        return await litellm.mint_virtual_key(
            user_id=user_id,
            team_id=team_id,
            alias=alias,
            max_budget=max_budget,
            metadata=metadata,
        )


async def ensure_user_enrollment(
    db: AsyncSession,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord:
    subject = await ensure_personal_billing_subject(db, user_id)
    enrollment = await agent_gateway_store.ensure_enrollment_row(
        db,
        subject_kind=AGENT_GATEWAY_SUBJECT_KIND_USER,
        billing_subject_id=subject.id,
        user_id=user_id,
    )
    if not settings.agent_gateway_enabled:
        return enrollment
    # Grant free credits (deduped) before syncing so the LiteLLM budget can
    # mirror the resulting remaining balance. Runs every pass; idempotent.
    await ensure_user_free_credit_grant(db, user_id)
    if enrollment.sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED:
        return enrollment
    budget_raw = await _remaining_credit_budget_raw(
        db,
        billing_subject_id=subject.id,
        fallback=settings.agent_gateway_default_user_budget_usd,
    )
    return await _sync_enrollment(
        db,
        enrollment=enrollment,
        team_alias=f"user-{user_id}",
        litellm_user_id=f"user-{user_id}",
        subject_label=f"user-{user_id}",
        budget_raw=budget_raw,
    )


async def _remaining_credit_budget_raw(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    fallback: str,
) -> str:
    """Budget string mirroring remaining LLM credit.

    When the subject has any active credit grant, the LiteLLM budget mirrors
    the remaining balance, floored at a tiny positive value so an exhausted
    subject gets a near-zero (blocked) cap rather than "0" — which
    ``_parse_budget`` would read as uncapped. With no grant at all — e.g. free
    credits disabled or no linked GitHub identity — fall back to the default
    user budget so gateway access is not silently uncapped-to-zero.
    """
    balance = await agent_gateway_store.get_remaining_credit_usd(db, billing_subject_id)
    if balance.granted_usd <= 0:
        return fallback
    remaining = balance.remaining_usd
    if remaining <= _EXHAUSTED_BUDGET_FLOOR_USD:
        remaining = _EXHAUSTED_BUDGET_FLOOR_USD
    return str(remaining)


async def ensure_org_enrollment(
    db: AsyncSession,
    organization_id: UUID,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord:
    """Enroll one member under the org team.

    Per spec §2.3 the virtual key is per (user, team): every org member gets
    their own key under the shared org team/budget so gateway spend is
    attributable to the member who spent it.
    """
    subject = await ensure_organization_billing_subject(db, organization_id)
    enrollment = await agent_gateway_store.ensure_enrollment_row(
        db,
        subject_kind=AGENT_GATEWAY_SUBJECT_KIND_ORGANIZATION,
        billing_subject_id=subject.id,
        organization_id=organization_id,
        user_id=user_id,
    )
    if not settings.agent_gateway_enabled:
        return enrollment
    if enrollment.sync_status == AGENT_GATEWAY_SYNC_STATUS_SYNCED:
        return enrollment
    return await _sync_enrollment(
        db,
        enrollment=enrollment,
        team_alias=f"org-{organization_id}",
        litellm_user_id=f"user-{user_id}",
        subject_label=f"org-{organization_id}-user-{user_id}",
        budget_raw=settings.agent_gateway_default_org_budget_usd,
    )


async def _sync_enrollment(
    db: AsyncSession,
    *,
    enrollment: AgentGatewayEnrollmentRecord,
    team_alias: str,
    litellm_user_id: str | None,
    subject_label: str,
    budget_raw: str,
) -> AgentGatewayEnrollmentRecord:
    budget = _parse_budget(budget_raw)
    key_alias = _key_alias(enrollment.id, subject_label)
    metadata: dict[str, str] = {
        "proliferate_billing_subject_id": str(enrollment.billing_subject_id),
    }
    if enrollment.user_id is not None:
        metadata["proliferate_user_id"] = str(enrollment.user_id)
    if enrollment.organization_id is not None:
        metadata["proliferate_organization_id"] = str(enrollment.organization_id)
    try:
        team_id = await litellm.ensure_team(alias=team_alias, max_budget=budget)
        if litellm_user_id is not None:
            await litellm.ensure_user(user_id=litellm_user_id)
        virtual_key = enrollment.virtual_key_id
        if virtual_key is None:
            minted = await _mint_virtual_key_idempotent(
                user_id=litellm_user_id or team_alias,
                team_id=team_id,
                alias=key_alias,
                max_budget=budget,
                metadata=metadata,
            )
            return await agent_gateway_store.mark_enrollment_synced(
                db,
                enrollment_id=enrollment.id,
                litellm_team_id=team_id,
                litellm_user_id=litellm_user_id,
                virtual_key_id=minted.token_id or None,
                virtual_key=minted.key,
                sync_fingerprint=build_sync_fingerprint(
                    team_id=team_id,
                    budget=budget_raw,
                    key_alias=key_alias,
                ),
            )
        # A key already exists (retry after a partial failure); refresh metadata only.
        return await agent_gateway_store.mark_enrollment_synced(
            db,
            enrollment_id=enrollment.id,
            litellm_team_id=team_id,
            litellm_user_id=litellm_user_id,
            virtual_key_id=enrollment.virtual_key_id,
            virtual_key=None,
            sync_fingerprint=build_sync_fingerprint(
                team_id=team_id,
                budget=budget_raw,
                key_alias=key_alias,
            ),
        )
    except LiteLLMIntegrationError as error:
        logger.warning(
            "Agent gateway enrollment sync failed",
            extra={
                "enrollment_id": str(enrollment.id),
                "subject_kind": enrollment.subject_kind,
                "error_code": error.code,
            },
        )
        return await agent_gateway_store.mark_enrollment_failed(
            db,
            enrollment_id=enrollment.id,
            error_code=error.code,
            error_message=error.message,
        )


async def backfill_enrollments(db: AsyncSession, *, limit: int = 50) -> int:
    """Sync pending/failed enrollments and enroll users missing rows.

    Work is bounded to ``limit`` subjects per invocation. Returns the number
    of subjects processed.
    """
    processed = 0
    pending = await agent_gateway_store.list_enrollments_needing_sync(db, limit=limit)
    for enrollment in pending:
        is_user = enrollment.subject_kind == AGENT_GATEWAY_SUBJECT_KIND_USER
        if is_user and enrollment.user_id is not None:
            await ensure_user_enrollment(db, enrollment.user_id)
        elif enrollment.organization_id is not None and enrollment.user_id is not None:
            await ensure_org_enrollment(db, enrollment.organization_id, enrollment.user_id)
        processed += 1

    remaining = limit - processed
    if remaining <= 0:
        return processed
    missing_user_ids = await agent_gateway_store.list_user_ids_missing_enrollment(
        db,
        limit=remaining,
    )
    for user_id in missing_user_ids:
        await ensure_user_enrollment(db, user_id)
        processed += 1

    remaining = limit - processed
    if remaining <= 0:
        return processed
    # Symmetric org recovery: a lost org-join hook leaves an active membership
    # with no enrollment row, which would otherwise never self-heal.
    missing_memberships = await agent_gateway_store.list_org_memberships_missing_enrollment(
        db,
        limit=remaining,
    )
    for organization_id, member_user_id in missing_memberships:
        await ensure_org_enrollment(db, organization_id, member_user_id)
        processed += 1
    return processed
