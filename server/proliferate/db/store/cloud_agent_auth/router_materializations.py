"""Cloud agent-auth router materializations store operations."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_router import (
    AgentGatewayRouterMaterialization,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _router_materialization_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayRouterMaterializationRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def upsert_router_materialization(
    db: AsyncSession,
    *,
    router_kind: str,
    router_object_kind: str,
    object_scope: str,
    policy_id: UUID | None,
    provider_credential_id: UUID | None,
    budget_subject_id: UUID | None,
    selection_id: UUID | None,
    sandbox_profile_id: UUID | None,
    target_id: UUID | None,
    agent_kind: str | None,
    protocol_facade: str | None,
    router_object_id: str | None,
    router_object_secret_ciphertext: str | None,
    router_object_secret_ciphertext_key_id: str | None,
    sync_status: str,
    sync_fingerprint: str | None,
    status: str,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
) -> AgentGatewayRouterMaterializationRecord:
    filters = [
        AgentGatewayRouterMaterialization.router_kind == router_kind,
        AgentGatewayRouterMaterialization.router_object_kind == router_object_kind,
        AgentGatewayRouterMaterialization.object_scope == object_scope,
        AgentGatewayRouterMaterialization.status != "revoked",
    ]
    if object_scope == "runtime_selection":
        filters.extend(
            [
                AgentGatewayRouterMaterialization.selection_id == selection_id,
                AgentGatewayRouterMaterialization.target_id == target_id,
            ]
        )
    elif object_scope == "policy":
        filters.append(AgentGatewayRouterMaterialization.policy_id == policy_id)
    elif object_scope == "budget_subject":
        filters.append(AgentGatewayRouterMaterialization.budget_subject_id == budget_subject_id)
        filters.append(AgentGatewayRouterMaterialization.router_object_id == router_object_id)
    else:
        filters.append(AgentGatewayRouterMaterialization.id.is_(None))
    row = (
        await db.execute(
            select(AgentGatewayRouterMaterialization).where(*filters).with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentGatewayRouterMaterialization(
            router_kind=router_kind,
            router_object_kind=router_object_kind,
            object_scope=object_scope,
            policy_id=policy_id,
            provider_credential_id=provider_credential_id,
            budget_subject_id=budget_subject_id,
            selection_id=selection_id,
            sandbox_profile_id=sandbox_profile_id,
            target_id=target_id,
            agent_kind=agent_kind,
            protocol_facade=protocol_facade,
            router_object_id=router_object_id,
            router_object_secret_ciphertext=router_object_secret_ciphertext,
            router_object_secret_ciphertext_key_id=router_object_secret_ciphertext_key_id,
            sync_status=sync_status,
            sync_fingerprint=sync_fingerprint,
            status=status,
            last_reconciled_at=now if sync_status == "synced" else None,
            last_error_code=last_error_code,
            last_error_message=last_error_message,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.policy_id = policy_id
        row.provider_credential_id = provider_credential_id
        row.budget_subject_id = budget_subject_id
        row.selection_id = selection_id
        row.sandbox_profile_id = sandbox_profile_id
        row.target_id = target_id
        row.agent_kind = agent_kind
        row.protocol_facade = protocol_facade
        row.router_object_id = router_object_id
        row.router_object_secret_ciphertext = router_object_secret_ciphertext
        row.router_object_secret_ciphertext_key_id = router_object_secret_ciphertext_key_id
        row.sync_status = sync_status
        row.sync_fingerprint = sync_fingerprint
        row.status = status
        row.last_error_code = last_error_code
        row.last_error_message = last_error_message
        if sync_status == "synced":
            row.last_reconciled_at = now
        row.updated_at = now
    await db.flush()
    return _router_materialization_record(row)


async def get_runtime_router_materialization(
    db: AsyncSession,
    *,
    router_kind: str,
    selection_id: UUID,
    target_id: UUID,
    router_object_kind: str = "virtual_key",
) -> AgentGatewayRouterMaterializationRecord | None:
    row = (
        await db.execute(
            select(AgentGatewayRouterMaterialization).where(
                AgentGatewayRouterMaterialization.router_kind == router_kind,
                AgentGatewayRouterMaterialization.router_object_kind == router_object_kind,
                AgentGatewayRouterMaterialization.object_scope == "runtime_selection",
                AgentGatewayRouterMaterialization.selection_id == selection_id,
                AgentGatewayRouterMaterialization.target_id == target_id,
                AgentGatewayRouterMaterialization.status != "revoked",
            )
        )
    ).scalar_one_or_none()
    return _router_materialization_record(row) if row is not None else None


async def get_router_materialization_by_object_id(
    db: AsyncSession,
    *,
    router_kind: str,
    router_object_id: str,
    router_object_kind: str | None = None,
) -> AgentGatewayRouterMaterializationRecord | None:
    filters = [
        AgentGatewayRouterMaterialization.router_kind == router_kind,
        AgentGatewayRouterMaterialization.router_object_id == router_object_id,
        AgentGatewayRouterMaterialization.status != "revoked",
    ]
    if router_object_kind is not None:
        filters.append(AgentGatewayRouterMaterialization.router_object_kind == router_object_kind)
    row = (
        await db.execute(
            select(AgentGatewayRouterMaterialization)
            .where(*filters)
            .order_by(AgentGatewayRouterMaterialization.updated_at.desc())
        )
    ).scalar_one_or_none()
    return _router_materialization_record(row) if row is not None else None


async def update_router_materialization_status(
    db: AsyncSession,
    *,
    materialization_id: UUID,
    status: str,
    sync_status: str | None = None,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
) -> AgentGatewayRouterMaterializationRecord | None:
    row = await db.get(AgentGatewayRouterMaterialization, materialization_id)
    if row is None:
        return None
    row.status = status
    if sync_status is not None:
        row.sync_status = sync_status
    row.last_error_code = last_error_code
    row.last_error_message = last_error_message
    row.updated_at = utcnow()
    await db.flush()
    return _router_materialization_record(row)


async def list_active_router_virtual_key_ids(
    db: AsyncSession,
    *,
    router_kind: str,
    limit: int = 1000,
) -> tuple[str, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRouterMaterialization.router_object_id)
                .where(
                    AgentGatewayRouterMaterialization.router_kind == router_kind,
                    AgentGatewayRouterMaterialization.router_object_kind == "virtual_key",
                    AgentGatewayRouterMaterialization.router_object_id.is_not(None),
                    AgentGatewayRouterMaterialization.status == "active",
                )
                .order_by(AgentGatewayRouterMaterialization.updated_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(str(row) for row in rows if row)


async def list_active_router_virtual_key_materializations_for_budget(
    db: AsyncSession,
    *,
    router_kind: str,
    budget_subject_id: UUID,
    limit: int = 1000,
) -> tuple[AgentGatewayRouterMaterializationRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRouterMaterialization)
                .where(
                    AgentGatewayRouterMaterialization.router_kind == router_kind,
                    AgentGatewayRouterMaterialization.router_object_kind == "virtual_key",
                    AgentGatewayRouterMaterialization.object_scope == "runtime_selection",
                    AgentGatewayRouterMaterialization.budget_subject_id == budget_subject_id,
                    AgentGatewayRouterMaterialization.router_object_id.is_not(None),
                    AgentGatewayRouterMaterialization.status == "active",
                )
                .order_by(AgentGatewayRouterMaterialization.updated_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_router_materialization_record(row) for row in rows)


async def list_active_router_materializations_for_policy(
    db: AsyncSession,
    *,
    router_kind: str,
    policy_id: UUID,
    router_object_kind: str | None = None,
    limit: int = 1000,
) -> tuple[AgentGatewayRouterMaterializationRecord, ...]:
    filters = [
        AgentGatewayRouterMaterialization.router_kind == router_kind,
        AgentGatewayRouterMaterialization.policy_id == policy_id,
        AgentGatewayRouterMaterialization.router_object_id.is_not(None),
        AgentGatewayRouterMaterialization.status == "active",
    ]
    if router_object_kind is not None:
        filters.append(AgentGatewayRouterMaterialization.router_object_kind == router_object_kind)
    rows = (
        (
            await db.execute(
                select(AgentGatewayRouterMaterialization)
                .where(*filters)
                .order_by(AgentGatewayRouterMaterialization.updated_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_router_materialization_record(row) for row in rows)


async def list_active_runtime_router_materializations_for_selection(
    db: AsyncSession,
    *,
    router_kind: str,
    selection_id: UUID,
    router_object_kind: str = "virtual_key",
    limit: int = 1000,
) -> tuple[AgentGatewayRouterMaterializationRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRouterMaterialization)
                .where(
                    AgentGatewayRouterMaterialization.router_kind == router_kind,
                    AgentGatewayRouterMaterialization.router_object_kind == router_object_kind,
                    AgentGatewayRouterMaterialization.object_scope == "runtime_selection",
                    AgentGatewayRouterMaterialization.selection_id == selection_id,
                    AgentGatewayRouterMaterialization.router_object_id.is_not(None),
                    AgentGatewayRouterMaterialization.status == "active",
                )
                .order_by(AgentGatewayRouterMaterialization.updated_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_router_materialization_record(row) for row in rows)
