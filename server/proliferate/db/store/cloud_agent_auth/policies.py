"""Cloud agent-auth policies store operations."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_credentials import (
    AgentAuthCredential,
)
from proliferate.db.models.cloud.agent_auth_gateway import (
    AgentGatewayPolicy,
    AgentGatewayProviderCredential,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _credential_record,
    _policy_record,
    _provider_credential_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentGatewayPolicyRecord,
    AgentGatewayProviderCredentialRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def ensure_gateway_policy(
    db: AsyncSession,
    *,
    credential_id: UUID,
    policy_kind: str,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    budget_subject_id: UUID | None,
    litellm_team_id: str | None,
    litellm_virtual_key_id: str | None,
    litellm_virtual_key_ciphertext: str | None,
    litellm_virtual_key_ciphertext_key_id: str | None,
    litellm_sync_status: str,
    litellm_sync_fingerprint: str | None,
    status: str,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
) -> AgentGatewayPolicyRecord:
    row = (
        await db.execute(
            select(AgentGatewayPolicy)
            .where(AgentGatewayPolicy.credential_id == credential_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentGatewayPolicy(
            credential_id=credential_id,
            policy_kind=policy_kind,
            owner_scope=owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            budget_subject_id=budget_subject_id,
            litellm_team_id=litellm_team_id,
            litellm_virtual_key_id=litellm_virtual_key_id,
            litellm_virtual_key_ciphertext=litellm_virtual_key_ciphertext,
            litellm_virtual_key_ciphertext_key_id=litellm_virtual_key_ciphertext_key_id,
            litellm_sync_status=litellm_sync_status,
            litellm_sync_fingerprint=litellm_sync_fingerprint,
            status=status,
            revision=1,
            last_provisioned_at=now if litellm_sync_status == "synced" else None,
            last_litellm_reconciled_at=now if litellm_sync_status == "synced" else None,
            last_error_code=last_error_code,
            last_error_message=last_error_message,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        changed = (
            row.policy_kind != policy_kind
            or row.budget_subject_id != budget_subject_id
            or row.litellm_team_id != litellm_team_id
            or row.litellm_virtual_key_id != litellm_virtual_key_id
            or row.litellm_virtual_key_ciphertext != litellm_virtual_key_ciphertext
            or row.litellm_sync_status != litellm_sync_status
            or row.litellm_sync_fingerprint != litellm_sync_fingerprint
            or row.status != status
            or row.last_error_code != last_error_code
            or row.last_error_message != last_error_message
        )
        row.policy_kind = policy_kind
        row.owner_scope = owner_scope
        row.owner_user_id = owner_user_id
        row.organization_id = organization_id
        row.budget_subject_id = budget_subject_id
        row.litellm_team_id = litellm_team_id
        row.litellm_virtual_key_id = litellm_virtual_key_id
        row.litellm_virtual_key_ciphertext = litellm_virtual_key_ciphertext
        row.litellm_virtual_key_ciphertext_key_id = litellm_virtual_key_ciphertext_key_id
        row.litellm_sync_status = litellm_sync_status
        row.litellm_sync_fingerprint = litellm_sync_fingerprint
        row.status = status
        row.last_error_code = last_error_code
        row.last_error_message = last_error_message
        if litellm_sync_status == "synced":
            row.last_provisioned_at = now
            row.last_litellm_reconciled_at = now
        if changed:
            row.revision += 1
        row.updated_at = now
    await db.flush()
    return _policy_record(row)


async def get_gateway_policy_for_credential(
    db: AsyncSession,
    credential_id: UUID,
) -> AgentGatewayPolicyRecord | None:
    row = (
        await db.execute(
            select(AgentGatewayPolicy).where(AgentGatewayPolicy.credential_id == credential_id)
        )
    ).scalar_one_or_none()
    return _policy_record(row) if row is not None else None


async def get_managed_gateway_credential(
    db: AsyncSession,
    *,
    organization_id: UUID,
    agent_kind: str,
) -> AgentAuthCredentialRecord | None:
    return await get_managed_gateway_credential_for_owner(
        db,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
        agent_kind=agent_kind,
    )


async def get_managed_gateway_credential_for_owner(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    agent_kind: str,
) -> AgentAuthCredentialRecord | None:
    owner_filters = [AgentAuthCredential.owner_scope == owner_scope]
    if owner_scope == "personal":
        owner_filters.extend(
            [
                AgentAuthCredential.owner_user_id == owner_user_id,
                AgentAuthCredential.organization_id.is_(None),
            ]
        )
    else:
        owner_filters.extend(
            [
                AgentAuthCredential.organization_id == organization_id,
                AgentAuthCredential.owner_user_id.is_(None),
            ]
        )
    row = (
        (
            await db.execute(
                select(AgentAuthCredential)
                .join(
                    AgentGatewayPolicy,
                    AgentGatewayPolicy.credential_id == AgentAuthCredential.id,
                )
                .where(
                    *owner_filters,
                    AgentAuthCredential.agent_kind == agent_kind,
                    AgentAuthCredential.credential_kind == "managed_gateway",
                    AgentAuthCredential.revoked_at.is_(None),
                    AgentAuthCredential.status != "revoked",
                    AgentGatewayPolicy.policy_kind == "proliferate_managed",
                )
                .order_by(AgentAuthCredential.created_at.asc())
                .with_for_update()
            )
        )
        .scalars()
        .first()
    )
    return _credential_record(row) if row is not None else None


async def get_gateway_policy(
    db: AsyncSession,
    policy_id: UUID,
) -> AgentGatewayPolicyRecord | None:
    row = await db.get(AgentGatewayPolicy, policy_id)
    return _policy_record(row) if row is not None else None


async def list_gateway_policies_for_reconciliation(
    db: AsyncSession,
    *,
    limit: int,
) -> tuple[AgentGatewayPolicyRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayPolicy)
                .join(
                    AgentAuthCredential,
                    AgentAuthCredential.id == AgentGatewayPolicy.credential_id,
                )
                .where(
                    AgentGatewayPolicy.status != "revoked",
                    AgentAuthCredential.status != "revoked",
                    AgentAuthCredential.revoked_at.is_(None),
                    or_(
                        AgentGatewayPolicy.status != "ready",
                        AgentGatewayPolicy.litellm_sync_status != "synced",
                        AgentGatewayPolicy.last_litellm_reconciled_at.is_(None),
                    ),
                )
                .order_by(
                    AgentGatewayPolicy.last_litellm_reconciled_at.asc().nullsfirst(),
                    AgentGatewayPolicy.updated_at.asc(),
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_policy_record(row) for row in rows)


async def upsert_provider_credential(
    db: AsyncSession,
    *,
    policy_id: UUID,
    provider_kind: str,
    payload_ciphertext: str,
    payload_ciphertext_key_id: str,
    redacted_summary_json: str,
    validation_status: str,
    validated_at: datetime | None,
    validation_error_code: str | None,
    validation_error_message: str | None,
) -> AgentGatewayProviderCredentialRecord:
    row = (
        await db.execute(
            select(AgentGatewayProviderCredential)
            .where(AgentGatewayProviderCredential.policy_id == policy_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentGatewayProviderCredential(
            policy_id=policy_id,
            provider_kind=provider_kind,
            payload_ciphertext=payload_ciphertext,
            payload_ciphertext_key_id=payload_ciphertext_key_id,
            redacted_summary_json=redacted_summary_json,
            validation_status=validation_status,
            validated_at=validated_at,
            validation_error_code=validation_error_code,
            validation_error_message=validation_error_message,
            revision=1,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.provider_kind = provider_kind
        row.payload_ciphertext = payload_ciphertext
        row.payload_ciphertext_key_id = payload_ciphertext_key_id
        row.redacted_summary_json = redacted_summary_json
        row.validation_status = validation_status
        row.validated_at = validated_at
        row.validation_error_code = validation_error_code
        row.validation_error_message = validation_error_message
        row.revision += 1
        row.updated_at = now
    await db.flush()
    return _provider_credential_record(row)


async def get_provider_credential_for_policy(
    db: AsyncSession,
    policy_id: UUID,
) -> AgentGatewayProviderCredentialRecord | None:
    row = (
        await db.execute(
            select(AgentGatewayProviderCredential).where(
                AgentGatewayProviderCredential.policy_id == policy_id
            )
        )
    ).scalar_one_or_none()
    return _provider_credential_record(row) if row is not None else None
