from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationOAuthFlow
from proliferate.db.store.cloud_integrations.types import IntegrationOAuthFlowRecord
from proliferate.utils.time import utcnow


def _flow_record(row: CloudIntegrationOAuthFlow) -> IntegrationOAuthFlowRecord:
    return IntegrationOAuthFlowRecord(
        id=row.id,
        account_id=row.account_id,
        user_id=row.user_id,
        state_hash=row.state_hash,
        code_verifier_ciphertext=row.code_verifier_ciphertext,
        issuer=row.issuer,
        resource=row.resource,
        client_id=row.client_id,
        client_strategy=row.client_strategy,
        token_endpoint=row.token_endpoint,
        requested_scopes=row.requested_scopes,
        redirect_uri=row.redirect_uri,
        authorization_url=row.authorization_url,
        callback_surface=row.callback_surface,
        final_surface=row.final_surface,
        return_path=row.return_path,
        status=row.status,
        expires_at=row.expires_at,
        used_at=row.used_at,
        cancelled_at=row.cancelled_at,
        failure_code=row.failure_code,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def create_oauth_flow_canceling_existing(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    state_hash: str,
    code_verifier_ciphertext: str,
    issuer: str,
    resource: str,
    client_id: str,
    client_strategy: str,
    token_endpoint: str,
    requested_scopes: str,
    redirect_uri: str,
    authorization_url: str,
    callback_surface: str,
    final_surface: str,
    return_path: str | None,
    expires_at: datetime,
) -> IntegrationOAuthFlowRecord:
    now = utcnow()
    existing = (
        (
            await db.execute(
                select(CloudIntegrationOAuthFlow).where(
                    CloudIntegrationOAuthFlow.account_id == account_id,
                    CloudIntegrationOAuthFlow.user_id == user_id,
                    CloudIntegrationOAuthFlow.status == "active",
                )
            )
        )
        .scalars()
        .all()
    )
    for flow in existing:
        flow.status = "cancelled"
        flow.cancelled_at = now
        flow.updated_at = now
    row = CloudIntegrationOAuthFlow(
        account_id=account_id,
        user_id=user_id,
        state_hash=state_hash,
        code_verifier_ciphertext=code_verifier_ciphertext,
        issuer=issuer,
        resource=resource,
        client_id=client_id,
        client_strategy=client_strategy,
        token_endpoint=token_endpoint,
        requested_scopes=requested_scopes,
        redirect_uri=redirect_uri,
        authorization_url=authorization_url,
        callback_surface=callback_surface,
        final_surface=final_surface,
        return_path=return_path,
        status="active",
        expires_at=expires_at,
        used_at=None,
        cancelled_at=None,
        failure_code=None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _flow_record(row)


async def get_oauth_flow_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> IntegrationOAuthFlowRecord | None:
    row = (
        await db.execute(
            select(CloudIntegrationOAuthFlow).where(
                CloudIntegrationOAuthFlow.id == flow_id,
                CloudIntegrationOAuthFlow.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return _flow_record(row) if row is not None else None


async def get_oauth_flow_by_state_hash(
    db: AsyncSession,
    *,
    state_hash: str,
) -> IntegrationOAuthFlowRecord | None:
    row = (
        await db.execute(
            select(CloudIntegrationOAuthFlow).where(
                CloudIntegrationOAuthFlow.state_hash == state_hash
            )
        )
    ).scalar_one_or_none()
    return _flow_record(row) if row is not None else None


async def claim_active_oauth_flow_by_state_hash(
    db: AsyncSession,
    *,
    state_hash: str,
) -> IntegrationOAuthFlowRecord | None:
    row = (
        await db.execute(
            select(CloudIntegrationOAuthFlow)
            .where(
                CloudIntegrationOAuthFlow.state_hash == state_hash,
                CloudIntegrationOAuthFlow.status == "active",
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.status = "exchanging"
    row.used_at = utcnow()
    row.updated_at = row.used_at
    await db.flush()
    await db.refresh(row)
    return _flow_record(row)


async def complete_oauth_flow(
    db: AsyncSession,
    *,
    flow_id: UUID,
) -> IntegrationOAuthFlowRecord | None:
    row = await db.get(CloudIntegrationOAuthFlow, flow_id)
    if row is None:
        return None
    row.status = "completed"
    row.updated_at = utcnow()
    await db.flush()
    await db.refresh(row)
    return _flow_record(row)


async def fail_oauth_flow(
    db: AsyncSession,
    *,
    flow_id: UUID,
    failure_code: str,
) -> IntegrationOAuthFlowRecord | None:
    row = await db.get(CloudIntegrationOAuthFlow, flow_id)
    if row is None:
        return None
    row.status = "failed"
    row.failure_code = failure_code
    row.updated_at = utcnow()
    await db.flush()
    await db.refresh(row)
    return _flow_record(row)


async def expire_oauth_flow(
    db: AsyncSession,
    *,
    flow_id: UUID,
) -> IntegrationOAuthFlowRecord | None:
    row = await db.get(CloudIntegrationOAuthFlow, flow_id)
    if row is None:
        return None
    row.status = "expired"
    row.updated_at = utcnow()
    await db.flush()
    await db.refresh(row)
    return _flow_record(row)


async def cancel_oauth_flow_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> IntegrationOAuthFlowRecord | None:
    row = (
        await db.execute(
            select(CloudIntegrationOAuthFlow).where(
                CloudIntegrationOAuthFlow.id == flow_id,
                CloudIntegrationOAuthFlow.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.status = "cancelled"
    row.cancelled_at = utcnow()
    row.updated_at = row.cancelled_at
    await db.flush()
    await db.refresh(row)
    return _flow_record(row)
