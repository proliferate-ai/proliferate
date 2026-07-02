"""Persistence helpers for in-flight integration OAuth authorization flows.

Ported from the old cloud_mcp oauth flow store, rekeyed onto the new
integration columns (account_id / owner_user_id / definition_id).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationOAuthFlow
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class IntegrationOAuthFlowRecord:
    id: UUID
    account_id: UUID | None
    owner_user_id: UUID
    definition_id: UUID
    state_hash: str
    code_verifier_ciphertext: str
    issuer: str | None
    resource: str | None
    client_id: str
    token_endpoint: str | None
    requested_scopes: str
    redirect_uri: str
    authorization_url: str
    callback_surface: str
    final_surface: str
    return_path: str | None
    status: str
    expires_at: datetime
    used_at: datetime | None
    cancelled_at: datetime | None
    failure_code: str | None
    created_at: datetime
    updated_at: datetime


def _record(flow: CloudIntegrationOAuthFlow) -> IntegrationOAuthFlowRecord:
    return IntegrationOAuthFlowRecord(
        id=flow.id,
        account_id=flow.account_id,
        owner_user_id=flow.owner_user_id,
        definition_id=flow.definition_id,
        state_hash=flow.state_hash,
        code_verifier_ciphertext=flow.code_verifier_ciphertext,
        issuer=flow.issuer,
        resource=flow.resource,
        client_id=flow.client_id,
        token_endpoint=flow.token_endpoint,
        requested_scopes=flow.requested_scopes,
        redirect_uri=flow.redirect_uri,
        authorization_url=flow.authorization_url,
        callback_surface=flow.callback_surface,
        final_surface=flow.final_surface,
        return_path=flow.return_path,
        status=flow.status,
        expires_at=flow.expires_at,
        used_at=flow.used_at,
        cancelled_at=flow.cancelled_at,
        failure_code=flow.failure_code,
        created_at=flow.created_at,
        updated_at=flow.updated_at,
    )


async def create_oauth_flow_canceling_existing(
    db: AsyncSession,
    *,
    account_id: UUID | None,
    owner_user_id: UUID,
    definition_id: UUID,
    state_hash: str,
    code_verifier_ciphertext: str,
    issuer: str | None,
    resource: str | None,
    client_id: str,
    token_endpoint: str | None,
    requested_scopes: str,
    redirect_uri: str,
    authorization_url: str,
    callback_surface: str = "desktop",
    final_surface: str = "desktop",
    return_path: str | None = None,
    expires_at: datetime,
) -> IntegrationOAuthFlowRecord:
    now = utcnow()
    active = list(
        (
            await db.execute(
                select(CloudIntegrationOAuthFlow)
                .where(
                    CloudIntegrationOAuthFlow.owner_user_id == owner_user_id,
                    CloudIntegrationOAuthFlow.definition_id == definition_id,
                    CloudIntegrationOAuthFlow.status == "active",
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for flow in active:
        flow.status = "cancelled"
        flow.cancelled_at = now
        flow.failure_code = "superseded"
        flow.updated_at = now
    created = CloudIntegrationOAuthFlow(
        account_id=account_id,
        owner_user_id=owner_user_id,
        definition_id=definition_id,
        state_hash=state_hash,
        code_verifier_ciphertext=code_verifier_ciphertext,
        issuer=issuer,
        resource=resource,
        client_id=client_id,
        token_endpoint=token_endpoint,
        requested_scopes=requested_scopes,
        redirect_uri=redirect_uri,
        authorization_url=authorization_url,
        callback_surface=callback_surface,
        final_surface=final_surface,
        return_path=return_path,
        status="active",
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    db.add(created)
    await db.flush()
    await db.refresh(created)
    return _record(created)


async def get_oauth_flow(
    db: AsyncSession,
    flow_id: UUID,
) -> IntegrationOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudIntegrationOAuthFlow).where(CloudIntegrationOAuthFlow.id == flow_id)
        )
    ).scalar_one_or_none()
    return _record(flow) if flow is not None else None


async def get_oauth_flow_for_user(
    db: AsyncSession,
    user_id: UUID,
    flow_id: UUID,
) -> IntegrationOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudIntegrationOAuthFlow).where(
                CloudIntegrationOAuthFlow.id == flow_id,
                CloudIntegrationOAuthFlow.owner_user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return _record(flow) if flow is not None else None


async def get_oauth_flow_by_state_hash(
    db: AsyncSession,
    state_hash: str,
) -> IntegrationOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudIntegrationOAuthFlow)
            .where(CloudIntegrationOAuthFlow.state_hash == state_hash)
            .order_by(CloudIntegrationOAuthFlow.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return _record(flow) if flow is not None else None


async def claim_active_oauth_flow_by_state_hash(
    db: AsyncSession,
    state_hash: str,
) -> IntegrationOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudIntegrationOAuthFlow)
            .where(
                CloudIntegrationOAuthFlow.state_hash == state_hash,
                CloudIntegrationOAuthFlow.status == "active",
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if flow is None:
        return None
    flow.status = "exchanging"
    flow.updated_at = utcnow()
    await db.flush()
    await db.refresh(flow)
    return _record(flow)


async def complete_oauth_flow(
    db: AsyncSession,
    flow_id: UUID,
) -> IntegrationOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudIntegrationOAuthFlow)
            .where(CloudIntegrationOAuthFlow.id == flow_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if flow is None:
        return None
    now = utcnow()
    if flow.status in {"active", "exchanging"}:
        flow.status = "completed"
        flow.used_at = now
        flow.updated_at = now
        await db.flush()
        await db.refresh(flow)
    return _record(flow)


async def cancel_oauth_flow_for_user(
    db: AsyncSession,
    user_id: UUID,
    flow_id: UUID,
) -> IntegrationOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudIntegrationOAuthFlow)
            .where(
                CloudIntegrationOAuthFlow.id == flow_id,
                CloudIntegrationOAuthFlow.owner_user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if flow is None:
        return None
    if flow.status == "active":
        now = utcnow()
        flow.status = "cancelled"
        flow.cancelled_at = now
        flow.failure_code = "user_cancelled"
        flow.updated_at = now
        await db.flush()
        await db.refresh(flow)
    return _record(flow)


async def expire_oauth_flow(
    db: AsyncSession,
    flow_id: UUID,
) -> IntegrationOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudIntegrationOAuthFlow)
            .where(CloudIntegrationOAuthFlow.id == flow_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if flow is None:
        return None
    if flow.status in {"active", "exchanging"}:
        now = utcnow()
        flow.status = "expired"
        flow.failure_code = "expired"
        flow.updated_at = now
        await db.flush()
        await db.refresh(flow)
    return _record(flow)


async def fail_oauth_flow(
    db: AsyncSession,
    flow_id: UUID,
    failure_code: str,
) -> IntegrationOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudIntegrationOAuthFlow)
            .where(CloudIntegrationOAuthFlow.id == flow_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if flow is None:
        return None
    if flow.status in {"active", "exchanging"}:
        now = utcnow()
        flow.status = "failed"
        flow.failure_code = failure_code
        flow.updated_at = now
        await db.flush()
        await db.refresh(flow)
    return _record(flow)
