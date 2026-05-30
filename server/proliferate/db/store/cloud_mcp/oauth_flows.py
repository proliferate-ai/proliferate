from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.mcp import CloudMcpOAuthFlow
from proliferate.db.store.cloud_mcp.types import CloudMcpOAuthFlowRecord
from proliferate.utils.time import utcnow


def _record(flow: CloudMcpOAuthFlow) -> CloudMcpOAuthFlowRecord:
    return CloudMcpOAuthFlowRecord(
        id=flow.id,
        connection_db_id=flow.connection_db_id,
        user_id=flow.user_id,
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
    connection_db_id: UUID,
    user_id: UUID,
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
) -> CloudMcpOAuthFlowRecord:
    now = utcnow()
    active = list(
        (
            await db.execute(
                select(CloudMcpOAuthFlow)
                .where(
                    CloudMcpOAuthFlow.connection_db_id == connection_db_id,
                    CloudMcpOAuthFlow.status == "active",
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
    created = CloudMcpOAuthFlow(
        connection_db_id=connection_db_id,
        user_id=user_id,
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


async def get_oauth_flow_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> CloudMcpOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudMcpOAuthFlow).where(
                CloudMcpOAuthFlow.id == flow_id,
                CloudMcpOAuthFlow.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return _record(flow) if flow is not None else None


async def get_oauth_flow_by_state_hash(
    db: AsyncSession,
    state_hash: str,
) -> CloudMcpOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudMcpOAuthFlow)
            .where(CloudMcpOAuthFlow.state_hash == state_hash)
            .order_by(CloudMcpOAuthFlow.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return _record(flow) if flow is not None else None


async def cancel_oauth_flow_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> CloudMcpOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudMcpOAuthFlow)
            .where(
                CloudMcpOAuthFlow.id == flow_id,
                CloudMcpOAuthFlow.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if flow is None:
        return None
    if flow.status == "active":
        flow.status = "cancelled"
        flow.cancelled_at = utcnow()
        flow.failure_code = "user_cancelled"
        flow.updated_at = flow.cancelled_at
        await db.flush()
        await db.refresh(flow)
    return _record(flow)


async def claim_active_oauth_flow_by_state_hash(
    db: AsyncSession,
    state_hash: str,
) -> CloudMcpOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudMcpOAuthFlow)
            .where(
                CloudMcpOAuthFlow.state_hash == state_hash,
                CloudMcpOAuthFlow.status == "active",
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
    return _record(flow) if flow is not None else None


async def complete_oauth_flow(
    db: AsyncSession,
    *,
    flow_id: UUID,
) -> CloudMcpOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudMcpOAuthFlow).where(CloudMcpOAuthFlow.id == flow_id).with_for_update()
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


async def cancel_active_oauth_flows_for_connection(
    db: AsyncSession,
    *,
    connection_db_id: UUID,
    failure_code: str,
) -> tuple[CloudMcpOAuthFlowRecord, ...]:
    now = utcnow()
    flows = list(
        (
            await db.execute(
                select(CloudMcpOAuthFlow)
                .where(
                    CloudMcpOAuthFlow.connection_db_id == connection_db_id,
                    CloudMcpOAuthFlow.status.in_(("active", "exchanging")),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for flow in flows:
        flow.status = "cancelled"
        flow.cancelled_at = now
        flow.failure_code = failure_code
        flow.updated_at = now
    if flows:
        await db.flush()
        for flow in flows:
            await db.refresh(flow)
    return tuple(_record(flow) for flow in flows)


async def expire_oauth_flow(
    db: AsyncSession,
    *,
    flow_id: UUID,
) -> CloudMcpOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudMcpOAuthFlow).where(CloudMcpOAuthFlow.id == flow_id).with_for_update()
        )
    ).scalar_one_or_none()
    if flow is None:
        return None
    now = utcnow()
    if flow.status in {"active", "exchanging"}:
        flow.status = "expired"
        flow.failure_code = "expired"
        flow.updated_at = now
        await db.flush()
        await db.refresh(flow)
    return _record(flow)


async def fail_oauth_flow(
    db: AsyncSession,
    *,
    flow_id: UUID,
    failure_code: str,
) -> CloudMcpOAuthFlowRecord | None:
    flow = (
        await db.execute(
            select(CloudMcpOAuthFlow).where(CloudMcpOAuthFlow.id == flow_id).with_for_update()
        )
    ).scalar_one_or_none()
    if flow is None:
        return None
    now = utcnow()
    if flow.status in {"active", "exchanging"}:
        flow.status = "failed"
        flow.failure_code = failure_code
        flow.updated_at = now
        await db.flush()
        await db.refresh(flow)
    return _record(flow)
