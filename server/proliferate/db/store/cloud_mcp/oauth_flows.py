from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudMcpOAuthFlow
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
        status=flow.status,
        expires_at=flow.expires_at,
        used_at=flow.used_at,
        cancelled_at=flow.cancelled_at,
        failure_code=flow.failure_code,
        created_at=flow.created_at,
        updated_at=flow.updated_at,
    )


async def create_oauth_flow_canceling_existing(
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
    expires_at: datetime,
) -> CloudMcpOAuthFlowRecord:
    async with db_engine.async_session_factory() as db:
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
            status="active",
            expires_at=expires_at,
            created_at=now,
            updated_at=now,
        )
        db.add(created)
        await db.commit()
        await db.refresh(created)
        return _record(created)


async def get_oauth_flow_for_user(
    *,
    user_id: UUID,
    flow_id: UUID,
) -> CloudMcpOAuthFlowRecord | None:
    async with db_engine.async_session_factory() as db:
        flow = (
            await db.execute(
                select(CloudMcpOAuthFlow).where(
                    CloudMcpOAuthFlow.id == flow_id,
                    CloudMcpOAuthFlow.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        return _record(flow) if flow is not None else None


async def cancel_oauth_flow_for_user(
    *,
    user_id: UUID,
    flow_id: UUID,
) -> CloudMcpOAuthFlowRecord | None:
    async with db_engine.async_session_factory() as db:
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
            flow.updated_at = flow.cancelled_at
            await db.commit()
            await db.refresh(flow)
        return _record(flow)


async def claim_active_oauth_flow_by_state_hash(
    state_hash: str,
) -> CloudMcpOAuthFlowRecord | None:
    async with db_engine.async_session_factory() as db:
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
        await db.commit()
        await db.refresh(flow)
        return _record(flow) if flow is not None else None


async def complete_oauth_flow(
    *,
    flow_id: UUID,
) -> CloudMcpOAuthFlowRecord | None:
    async with db_engine.async_session_factory() as db:
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
            await db.commit()
            await db.refresh(flow)
        return _record(flow)


async def fail_oauth_flow(
    *,
    flow_id: UUID,
    failure_code: str,
) -> CloudMcpOAuthFlowRecord | None:
    async with db_engine.async_session_factory() as db:
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
            await db.commit()
            await db.refresh(flow)
        return _record(flow)
