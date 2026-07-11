"""Persistence helpers for per-org integration policies.

A policy row records an organization's enable/disable decision for a single
integration definition, one row per (organization_id, definition_id).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationPolicy
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class IntegrationPolicyRecord:
    id: UUID
    organization_id: UUID
    definition_id: UUID
    enabled: bool
    scope_json: list[str] | None
    updated_by_user_id: UUID
    created_at: datetime
    updated_at: datetime


def _record(policy: CloudIntegrationPolicy) -> IntegrationPolicyRecord:
    return IntegrationPolicyRecord(
        id=policy.id,
        organization_id=policy.organization_id,
        definition_id=policy.definition_id,
        enabled=policy.enabled,
        scope_json=list(policy.scope_json) if policy.scope_json is not None else None,
        updated_by_user_id=policy.updated_by_user_id,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


async def list_policies_for_org(
    db: AsyncSession,
    organization_id: UUID,
) -> tuple[IntegrationPolicyRecord, ...]:
    policies = (
        (
            await db.execute(
                select(CloudIntegrationPolicy)
                .where(CloudIntegrationPolicy.organization_id == organization_id)
                .order_by(CloudIntegrationPolicy.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_record(policy) for policy in policies)


async def list_authored_scope_restrictions(
    db: AsyncSession,
    organization_id: UUID,
) -> dict[UUID, list[str]]:
    """The org's per-definition CHAT default-access restrictions (§2 "default
    access modes"): rows whose ``scope_json`` is authored (non-NULL).

    Maps ``definition_id -> tool-name allowlist`` where the value carries the
    per-integration default access mode wired into the interactive gateway:

      * ``[]``          -> integration EXCLUDED from the chat default set
      * ``[tool, ...]`` -> integration in the default set, restricted to those tools

    A definition with no authored ``scope_json`` (absent here) means "no
    restriction" — the integration is in the default set with all its tools.
    """
    policies = (
        (
            await db.execute(
                select(CloudIntegrationPolicy).where(
                    CloudIntegrationPolicy.organization_id == organization_id,
                    CloudIntegrationPolicy.scope_json.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    return {policy.definition_id: list(policy.scope_json or []) for policy in policies}


async def get_policy(
    db: AsyncSession,
    organization_id: UUID,
    definition_id: UUID,
) -> IntegrationPolicyRecord | None:
    policy = (
        await db.execute(
            select(CloudIntegrationPolicy).where(
                CloudIntegrationPolicy.organization_id == organization_id,
                CloudIntegrationPolicy.definition_id == definition_id,
            )
        )
    ).scalar_one_or_none()
    return _record(policy) if policy is not None else None


async def upsert_policy(
    db: AsyncSession,
    *,
    organization_id: UUID,
    definition_id: UUID,
    enabled: bool,
    updated_by_user_id: UUID,
) -> IntegrationPolicyRecord:
    policy = (
        await db.execute(
            select(CloudIntegrationPolicy)
            .where(
                CloudIntegrationPolicy.organization_id == organization_id,
                CloudIntegrationPolicy.definition_id == definition_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if policy is None:
        policy = CloudIntegrationPolicy(
            organization_id=organization_id,
            definition_id=definition_id,
            enabled=enabled,
            updated_by_user_id=updated_by_user_id,
            created_at=now,
            updated_at=now,
        )
        db.add(policy)
    else:
        policy.enabled = enabled
        policy.updated_by_user_id = updated_by_user_id
        policy.updated_at = now
    await db.flush()
    await db.refresh(policy)
    return _record(policy)


async def upsert_default_chat_scope(
    db: AsyncSession,
    *,
    organization_id: UUID,
    definition_id: UUID,
    included: bool,
    updated_by_user_id: UUID,
) -> IntegrationPolicyRecord:
    """Author (or clear) this definition's CHAT default-access restriction (§2).

    ``included=True`` clears any authored restriction (``scope_json=None`` — the
    integration is in the chat default set with all its tools, today's implicit
    behavior). ``included=False`` authors an explicit exclusion (``scope_json=[]``
    — the integration is absent from the chat default set). Per-tool restriction
    (a non-empty allowlist) is supported by the underlying column but has no UI
    surface yet; this helper only ever writes the two coarse states. Preserves
    the row's existing ``enabled`` policy (defaults True on first write) — this
    is the chat-default knob, independent of the org enable/disable switch.
    """
    policy = (
        await db.execute(
            select(CloudIntegrationPolicy)
            .where(
                CloudIntegrationPolicy.organization_id == organization_id,
                CloudIntegrationPolicy.definition_id == definition_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    scope_json: list[str] | None = None if included else []
    if policy is None:
        policy = CloudIntegrationPolicy(
            organization_id=organization_id,
            definition_id=definition_id,
            enabled=True,
            scope_json=scope_json,
            updated_by_user_id=updated_by_user_id,
            created_at=now,
            updated_at=now,
        )
        db.add(policy)
    else:
        policy.scope_json = scope_json
        policy.updated_by_user_id = updated_by_user_id
        policy.updated_at = now
    await db.flush()
    await db.refresh(policy)
    return _record(policy)
