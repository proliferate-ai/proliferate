"""Persistence helpers for cloud agent-auth state."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import AGENT_GATEWAY_BUDGET_DURATION_V1
from proliferate.db.models.cloud.agent_auth import (
    AgentAuthAuditEvent,
    AgentAuthCredential,
    AgentAuthCredentialShare,
    AgentGatewayBudgetSubject,
    AgentGatewayFreeCreditEntitlement,
    AgentGatewayPolicy,
    AgentGatewayProviderCredential,
    AgentGatewayRuntimeGrant,
    SandboxAgentAuthSelection,
    SandboxProfile,
    SandboxProfileAgentAuthRevision,
    SandboxProfileTargetState,
)
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.store.billing import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthAuditEventRecord,
    AgentAuthCredentialRecord,
    AgentAuthCredentialShareRecord,
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayFreeCreditEntitlementRecord,
    AgentGatewayPolicyRecord,
    AgentGatewayProviderCredentialRecord,
    AgentGatewayRuntimeGrantRecord,
    SandboxAgentAuthSelectionRecord,
    SandboxProfileAgentAuthTargetStateRecord,
    SandboxProfileRecord,
    SandboxProfileTargetStateRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


def _profile_record(
    row: SandboxProfile,
    *,
    primary_target_id: UUID | None,
) -> SandboxProfileRecord:
    return SandboxProfileRecord(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        billing_subject_id=row.billing_subject_id,
        created_by_user_id=row.created_by_user_id,
        primary_target_id=primary_target_id,
        desired_agent_auth_revision=row.desired_agent_auth_revision,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
        deleted_at=row.deleted_at,
    )


def _credential_record(row: AgentAuthCredential) -> AgentAuthCredentialRecord:
    return AgentAuthCredentialRecord(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        created_by_user_id=row.created_by_user_id,
        agent_kind=row.agent_kind,
        credential_kind=row.credential_kind,
        display_name=row.display_name,
        redacted_summary_json=row.redacted_summary_json,
        status=row.status,
        revision=row.revision,
        payload_ciphertext=row.payload_ciphertext,
        payload_ciphertext_key_id=row.payload_ciphertext_key_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        revoked_at=row.revoked_at,
    )


def _share_record(row: AgentAuthCredentialShare) -> AgentAuthCredentialShareRecord:
    return AgentAuthCredentialShareRecord(
        id=row.id,
        credential_id=row.credential_id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        share_scope=row.share_scope,
        shared_by_user_id=row.shared_by_user_id,
        status=row.status,
        allowed_agent_kind=row.allowed_agent_kind,
        created_at=row.created_at,
        revoked_at=row.revoked_at,
        revoked_by_user_id=row.revoked_by_user_id,
    )


def _budget_subject_record(row: AgentGatewayBudgetSubject) -> AgentGatewayBudgetSubjectRecord:
    return AgentGatewayBudgetSubjectRecord(
        id=row.id,
        budget_kind=row.budget_kind,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        litellm_team_id=row.litellm_team_id,
        included_budget_usd=row.included_budget_usd,
        budget_duration=row.budget_duration,
        entitlement_source=row.entitlement_source,
        entitlement_period_key=row.entitlement_period_key,
        litellm_sync_status=row.litellm_sync_status,
        litellm_sync_fingerprint=row.litellm_sync_fingerprint,
        status=row.status,
        revision=row.revision,
        last_provisioned_at=row.last_provisioned_at,
        last_litellm_reconciled_at=row.last_litellm_reconciled_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _free_credit_entitlement_record(
    row: AgentGatewayFreeCreditEntitlement,
) -> AgentGatewayFreeCreditEntitlementRecord:
    return AgentGatewayFreeCreditEntitlementRecord(
        id=row.id,
        user_id=row.user_id,
        budget_subject_id=row.budget_subject_id,
        source=row.source,
        period_key=row.period_key,
        included_budget_usd=row.included_budget_usd,
        status=row.status,
        activated_at=row.activated_at,
        exhausted_at=row.exhausted_at,
        revoked_at=row.revoked_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _policy_record(row: AgentGatewayPolicy) -> AgentGatewayPolicyRecord:
    return AgentGatewayPolicyRecord(
        id=row.id,
        credential_id=row.credential_id,
        policy_kind=row.policy_kind,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        budget_subject_id=row.budget_subject_id,
        litellm_team_id=row.litellm_team_id,
        litellm_virtual_key_id=row.litellm_virtual_key_id,
        litellm_virtual_key_ciphertext=row.litellm_virtual_key_ciphertext,
        litellm_virtual_key_ciphertext_key_id=row.litellm_virtual_key_ciphertext_key_id,
        litellm_sync_status=row.litellm_sync_status,
        litellm_sync_fingerprint=row.litellm_sync_fingerprint,
        status=row.status,
        revision=row.revision,
        last_provisioned_at=row.last_provisioned_at,
        last_litellm_reconciled_at=row.last_litellm_reconciled_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _provider_credential_record(
    row: AgentGatewayProviderCredential,
) -> AgentGatewayProviderCredentialRecord:
    return AgentGatewayProviderCredentialRecord(
        id=row.id,
        policy_id=row.policy_id,
        provider_kind=row.provider_kind,
        payload_ciphertext=row.payload_ciphertext,
        payload_ciphertext_key_id=row.payload_ciphertext_key_id,
        redacted_summary_json=row.redacted_summary_json,
        validation_status=row.validation_status,
        validated_at=row.validated_at,
        validation_error_code=row.validation_error_code,
        validation_error_message=row.validation_error_message,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _selection_record(row: SandboxAgentAuthSelection) -> SandboxAgentAuthSelectionRecord:
    return SandboxAgentAuthSelectionRecord(
        id=row.id,
        sandbox_profile_id=row.sandbox_profile_id,
        owner_scope=row.owner_scope,
        agent_kind=row.agent_kind,
        credential_id=row.credential_id,
        credential_share_id=row.credential_share_id,
        materialization_mode=row.materialization_mode,
        selected_revision=row.selected_revision,
        status=row.status,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _target_state_record(
    row: SandboxProfileTargetState,
) -> SandboxProfileTargetStateRecord:
    return SandboxProfileTargetStateRecord(
        id=row.id,
        sandbox_profile_id=row.sandbox_profile_id,
        target_id=row.target_id,
        active_sandbox_id=row.active_sandbox_id,
        slot_generation=row.slot_generation,
        desired_agent_auth_revision=row.desired_agent_auth_revision,
        applied_agent_auth_revision=row.applied_agent_auth_revision,
        agent_auth_status=row.agent_auth_status,
        agent_auth_force_restart_required=row.agent_auth_force_restart_required,
        last_agent_auth_command_id=row.last_agent_auth_command_id,
        last_agent_auth_worker_id=row.last_agent_auth_worker_id,
        last_agent_auth_attempted_at=row.last_agent_auth_attempted_at,
        last_agent_auth_applied_at=row.last_agent_auth_applied_at,
        last_agent_auth_error_code=row.last_agent_auth_error_code,
        last_agent_auth_error_message=row.last_agent_auth_error_message,
        pending_agent_auth_cleanup_json=row.pending_agent_auth_cleanup_json,
        applied_runtime_config_sequence=row.applied_runtime_config_sequence,
        applied_runtime_config_revision_id=row.applied_runtime_config_revision_id,
        runtime_config_status=row.runtime_config_status,
        last_runtime_config_command_id=row.last_runtime_config_command_id,
        last_runtime_config_worker_id=row.last_runtime_config_worker_id,
        last_runtime_config_attempted_at=row.last_runtime_config_attempted_at,
        last_runtime_config_applied_at=row.last_runtime_config_applied_at,
        last_runtime_config_error_code=row.last_runtime_config_error_code,
        last_runtime_config_error_message=row.last_runtime_config_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _runtime_grant_record(row: AgentGatewayRuntimeGrant) -> AgentGatewayRuntimeGrantRecord:
    return AgentGatewayRuntimeGrantRecord(
        id=row.id,
        token_hash=row.token_hash,
        hash_key_id=row.hash_key_id,
        policy_id=row.policy_id,
        credential_id=row.credential_id,
        selection_id=row.selection_id,
        issued_profile_revision=row.issued_profile_revision,
        target_id=row.target_id,
        sandbox_profile_id=row.sandbox_profile_id,
        cloud_sandbox_id=row.cloud_sandbox_id,
        slot_generation=row.slot_generation,
        organization_id=row.organization_id,
        user_id=row.user_id,
        agent_kind=row.agent_kind,
        protocol_facade=row.protocol_facade,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        last_used_at=row.last_used_at,
        created_at=row.created_at,
    )


def _audit_event_record(row: AgentAuthAuditEvent) -> AgentAuthAuditEventRecord:
    return AgentAuthAuditEventRecord(
        id=row.id,
        action=row.action,
        actor_user_id=row.actor_user_id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        credential_id=row.credential_id,
        sandbox_profile_id=row.sandbox_profile_id,
        target_id=row.target_id,
        metadata_json=row.metadata_json,
        created_at=row.created_at,
    )


async def get_sandbox_profile(
    db: AsyncSession,
    sandbox_profile_id: UUID,
) -> SandboxProfileRecord | None:
    row = await db.get(SandboxProfile, sandbox_profile_id)
    if row is None or row.archived_at is not None:
        return None
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def get_active_personal_sandbox_profile_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> SandboxProfileRecord | None:
    row = (
        await db.execute(
            select(SandboxProfile).where(
                SandboxProfile.owner_scope == "personal",
                SandboxProfile.owner_user_id == user_id,
                SandboxProfile.archived_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def ensure_personal_sandbox_profile(
    db: AsyncSession,
    *,
    user_id: UUID,
    created_by_user_id: UUID | None = None,
) -> SandboxProfileRecord:
    row = (
        await db.execute(
            select(SandboxProfile)
            .where(
                SandboxProfile.owner_scope == "personal",
                SandboxProfile.owner_user_id == user_id,
                SandboxProfile.archived_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        billing_subject = await ensure_personal_billing_subject(db, user_id)
        row = SandboxProfile(
            owner_scope="personal",
            owner_user_id=user_id,
            organization_id=None,
            billing_subject_id=billing_subject.id,
            created_by_user_id=created_by_user_id or user_id,
            desired_agent_auth_revision=0,
            status="configuring",
            created_at=now,
            updated_at=now,
            archived_at=None,
            deleted_at=None,
        )
        db.add(row)
        await db.flush()
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def ensure_organization_sandbox_profile(
    db: AsyncSession,
    *,
    organization_id: UUID,
    created_by_user_id: UUID | None = None,
) -> SandboxProfileRecord:
    row = (
        await db.execute(
            select(SandboxProfile)
            .where(
                SandboxProfile.owner_scope == "organization",
                SandboxProfile.organization_id == organization_id,
                SandboxProfile.archived_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        billing_subject = await ensure_organization_billing_subject(db, organization_id)
        row = SandboxProfile(
            owner_scope="organization",
            owner_user_id=None,
            organization_id=organization_id,
            billing_subject_id=billing_subject.id,
            created_by_user_id=created_by_user_id,
            desired_agent_auth_revision=0,
            status="configuring",
            created_at=now,
            updated_at=now,
            archived_at=None,
            deleted_at=None,
        )
        db.add(row)
        await db.flush()
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def bump_sandbox_profile_agent_auth_revision(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    reason: str,
    actor_user_id: UUID | None,
    force_restart: bool,
) -> SandboxProfileRecord | None:
    row = (
        await db.execute(
            select(SandboxProfile)
            .where(
                SandboxProfile.id == sandbox_profile_id,
                SandboxProfile.archived_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    now = utcnow()
    row.desired_agent_auth_revision += 1
    row.updated_at = now
    db.add(
        SandboxProfileAgentAuthRevision(
            sandbox_profile_id=row.id,
            revision=row.desired_agent_auth_revision,
            reason=reason,
            force_restart=force_restart,
            created_by_user_id=actor_user_id,
            created_at=now,
        )
    )
    await db.flush()
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def _load_primary_target_id(db: AsyncSession, sandbox_profile_id: UUID) -> UUID | None:
    return await db.scalar(
        select(CloudTarget.id)
        .where(
            CloudTarget.sandbox_profile_id == sandbox_profile_id,
            CloudTarget.profile_target_role == "primary",
            CloudTarget.archived_at.is_(None),
        )
        .limit(1)
    )


async def list_visible_credentials(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID | None = None,
    agent_kind: str | None = None,
) -> tuple[AgentAuthCredentialRecord, ...]:
    filters = [
        AgentAuthCredential.revoked_at.is_(None),
        AgentAuthCredential.status != "revoked",
    ]
    if agent_kind is not None:
        filters.append(AgentAuthCredential.agent_kind == agent_kind)
    visibility = [
        AgentAuthCredential.owner_scope == "system",
        and_(
            AgentAuthCredential.owner_scope == "personal",
            AgentAuthCredential.owner_user_id == actor_user_id,
        ),
    ]
    if organization_id is not None:
        visibility.append(
            and_(
                AgentAuthCredential.owner_scope == "organization",
                AgentAuthCredential.organization_id == organization_id,
            )
        )
        shared_credential_ids = select(AgentAuthCredentialShare.credential_id).where(
            AgentAuthCredentialShare.organization_id == organization_id,
            AgentAuthCredentialShare.status == "active",
        )
        visibility.append(AgentAuthCredential.id.in_(shared_credential_ids))
    rows = (
        (
            await db.execute(
                select(AgentAuthCredential)
                .where(*filters, or_(*visibility))
                .order_by(
                    AgentAuthCredential.agent_kind.asc(),
                    AgentAuthCredential.owner_scope.asc(),
                    AgentAuthCredential.display_name.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return tuple(_credential_record(row) for row in rows)


async def get_credential(
    db: AsyncSession,
    credential_id: UUID,
) -> AgentAuthCredentialRecord | None:
    row = await db.get(AgentAuthCredential, credential_id)
    if row is None:
        return None
    return _credential_record(row)


async def get_selection(
    db: AsyncSession,
    selection_id: UUID,
) -> SandboxAgentAuthSelectionRecord | None:
    row = await db.get(SandboxAgentAuthSelection, selection_id)
    return _selection_record(row) if row is not None else None


async def get_credential_for_update(
    db: AsyncSession,
    credential_id: UUID,
) -> AgentAuthCredentialRecord | None:
    row = (
        await db.execute(
            select(AgentAuthCredential)
            .where(AgentAuthCredential.id == credential_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return _credential_record(row)


async def create_agent_auth_credential(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    created_by_user_id: UUID | None,
    agent_kind: str,
    credential_kind: str,
    display_name: str,
    redacted_summary_json: str,
    status: str,
    payload_ciphertext: str | None = None,
    payload_ciphertext_key_id: str | None = None,
) -> AgentAuthCredentialRecord:
    now = utcnow()
    row = AgentAuthCredential(
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        agent_kind=agent_kind,
        credential_kind=credential_kind,
        display_name=display_name,
        redacted_summary_json=redacted_summary_json,
        status=status,
        revision=1,
        payload_ciphertext=payload_ciphertext,
        payload_ciphertext_key_id=payload_ciphertext_key_id,
        created_at=now,
        updated_at=now,
        revoked_at=None,
    )
    db.add(row)
    await db.flush()
    return _credential_record(row)


async def update_credential_status(
    db: AsyncSession,
    *,
    credential_id: UUID,
    status: str,
    redacted_summary_json: str | None = None,
) -> AgentAuthCredentialRecord | None:
    row = await db.get(AgentAuthCredential, credential_id)
    if row is None:
        return None
    row.status = status
    row.revision += 1
    row.updated_at = utcnow()
    if redacted_summary_json is not None:
        row.redacted_summary_json = redacted_summary_json
    await db.flush()
    return _credential_record(row)


async def revoke_credential(
    db: AsyncSession,
    *,
    credential_id: UUID,
) -> AgentAuthCredentialRecord | None:
    row = (
        await db.execute(
            select(AgentAuthCredential)
            .where(AgentAuthCredential.id == credential_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    now = utcnow()
    row.status = "revoked"
    row.revoked_at = now
    row.updated_at = now
    row.revision += 1
    await db.flush()
    return _credential_record(row)


async def get_active_personal_synced_credential_for_update(
    db: AsyncSession,
    *,
    user_id: UUID,
    agent_kind: str,
) -> AgentAuthCredentialRecord | None:
    row = (
        (
            await db.execute(
                select(AgentAuthCredential)
                .where(
                    AgentAuthCredential.owner_scope == "personal",
                    AgentAuthCredential.owner_user_id == user_id,
                    AgentAuthCredential.organization_id.is_(None),
                    AgentAuthCredential.agent_kind == agent_kind,
                    AgentAuthCredential.credential_kind == "synced_path",
                    AgentAuthCredential.revoked_at.is_(None),
                    AgentAuthCredential.status != "revoked",
                )
                .order_by(AgentAuthCredential.created_at.asc())
                .with_for_update()
            )
        )
        .scalars()
        .first()
    )
    return _credential_record(row) if row is not None else None


async def update_synced_credential_payload(
    db: AsyncSession,
    *,
    credential_id: UUID,
    display_name: str,
    redacted_summary_json: str,
    payload_ciphertext: str,
    payload_ciphertext_key_id: str,
    status: str,
    increment_revision: bool,
) -> AgentAuthCredentialRecord | None:
    row = await db.get(AgentAuthCredential, credential_id)
    if row is None:
        return None
    row.display_name = display_name
    row.redacted_summary_json = redacted_summary_json
    row.payload_ciphertext = payload_ciphertext
    row.payload_ciphertext_key_id = payload_ciphertext_key_id
    row.status = status
    if increment_revision:
        row.revision += 1
    row.updated_at = utcnow()
    await db.flush()
    return _credential_record(row)


async def create_or_reactivate_credential_share(
    db: AsyncSession,
    *,
    credential_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID,
    shared_by_user_id: UUID,
    allowed_agent_kind: str,
) -> AgentAuthCredentialShareRecord:
    row = (
        await db.execute(
            select(AgentAuthCredentialShare)
            .where(
                AgentAuthCredentialShare.credential_id == credential_id,
                AgentAuthCredentialShare.organization_id == organization_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentAuthCredentialShare(
            credential_id=credential_id,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            share_scope="organization",
            shared_by_user_id=shared_by_user_id,
            status="active",
            allowed_agent_kind=allowed_agent_kind,
            created_at=now,
            revoked_at=None,
            revoked_by_user_id=None,
        )
        db.add(row)
    else:
        row.status = "active"
        row.allowed_agent_kind = allowed_agent_kind
        row.revoked_at = None
        row.revoked_by_user_id = None
    await db.flush()
    return _share_record(row)


async def get_active_credential_share(
    db: AsyncSession,
    *,
    credential_id: UUID,
    organization_id: UUID,
) -> AgentAuthCredentialShareRecord | None:
    row = (
        await db.execute(
            select(AgentAuthCredentialShare).where(
                AgentAuthCredentialShare.credential_id == credential_id,
                AgentAuthCredentialShare.organization_id == organization_id,
                AgentAuthCredentialShare.status == "active",
            )
        )
    ).scalar_one_or_none()
    return _share_record(row) if row is not None else None


async def get_credential_share(
    db: AsyncSession,
    share_id: UUID,
) -> AgentAuthCredentialShareRecord | None:
    row = await db.get(AgentAuthCredentialShare, share_id)
    return _share_record(row) if row is not None else None


async def revoke_credential_share(
    db: AsyncSession,
    *,
    share_id: UUID,
    revoked_by_user_id: UUID,
) -> AgentAuthCredentialShareRecord | None:
    row = (
        await db.execute(
            select(AgentAuthCredentialShare)
            .where(AgentAuthCredentialShare.id == share_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.status = "revoked"
    row.revoked_at = utcnow()
    row.revoked_by_user_id = revoked_by_user_id
    await db.flush()
    return _share_record(row)


async def list_active_selections_for_credential_or_share(
    db: AsyncSession,
    *,
    credential_id: UUID | None = None,
    credential_share_id: UUID | None = None,
) -> tuple[SandboxAgentAuthSelectionRecord, ...]:
    filters = [SandboxAgentAuthSelection.status == "active"]
    if credential_id is not None:
        filters.append(SandboxAgentAuthSelection.credential_id == credential_id)
    if credential_share_id is not None:
        filters.append(SandboxAgentAuthSelection.credential_share_id == credential_share_id)
    rows = (await db.execute(select(SandboxAgentAuthSelection).where(*filters))).scalars().all()
    return tuple(_selection_record(row) for row in rows)


async def ensure_managed_budget_subject(
    db: AsyncSession,
    *,
    organization_id: UUID,
    included_budget_usd: str,
    litellm_team_id: str | None,
    litellm_sync_status: str,
    litellm_sync_fingerprint: str | None,
    status: str,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
) -> AgentGatewayBudgetSubjectRecord:
    return await ensure_managed_budget_subject_for_owner(
        db,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
        included_budget_usd=included_budget_usd,
        budget_duration=AGENT_GATEWAY_BUDGET_DURATION_V1,
        entitlement_source=None,
        entitlement_period_key=None,
        litellm_team_id=litellm_team_id,
        litellm_sync_status=litellm_sync_status,
        litellm_sync_fingerprint=litellm_sync_fingerprint,
        status=status,
        last_error_code=last_error_code,
        last_error_message=last_error_message,
    )


async def ensure_managed_budget_subject_for_owner(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    included_budget_usd: str,
    budget_duration: str | None,
    entitlement_source: str | None,
    entitlement_period_key: str | None,
    litellm_team_id: str | None,
    litellm_sync_status: str,
    litellm_sync_fingerprint: str | None,
    status: str,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
) -> AgentGatewayBudgetSubjectRecord:
    owner_filters = [
        AgentGatewayBudgetSubject.owner_scope == owner_scope,
        AgentGatewayBudgetSubject.budget_kind == "proliferate_managed",
        AgentGatewayBudgetSubject.status != "revoked",
    ]
    if owner_scope == "personal":
        owner_filters.extend(
            [
                AgentGatewayBudgetSubject.owner_user_id == owner_user_id,
                AgentGatewayBudgetSubject.organization_id.is_(None),
            ]
        )
    else:
        owner_filters.extend(
            [
                AgentGatewayBudgetSubject.organization_id == organization_id,
                AgentGatewayBudgetSubject.owner_user_id.is_(None),
            ]
        )
    row = (
        await db.execute(select(AgentGatewayBudgetSubject).where(*owner_filters).with_for_update())
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentGatewayBudgetSubject(
            budget_kind="proliferate_managed",
            owner_scope=owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            litellm_team_id=litellm_team_id,
            included_budget_usd=included_budget_usd,
            budget_duration=budget_duration,
            entitlement_source=entitlement_source,
            entitlement_period_key=entitlement_period_key,
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
            row.litellm_team_id != litellm_team_id
            or row.included_budget_usd != included_budget_usd
            or row.budget_duration != budget_duration
            or row.entitlement_source != entitlement_source
            or row.entitlement_period_key != entitlement_period_key
            or row.litellm_sync_status != litellm_sync_status
            or row.litellm_sync_fingerprint != litellm_sync_fingerprint
            or row.status != status
            or row.last_error_code != last_error_code
            or row.last_error_message != last_error_message
        )
        row.litellm_team_id = litellm_team_id
        row.included_budget_usd = included_budget_usd
        row.budget_duration = budget_duration
        row.entitlement_source = entitlement_source
        row.entitlement_period_key = entitlement_period_key
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
    return _budget_subject_record(row)


async def get_managed_budget_subject(
    db: AsyncSession,
    organization_id: UUID,
) -> AgentGatewayBudgetSubjectRecord | None:
    return await get_managed_budget_subject_for_owner(
        db,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
    )


async def get_managed_budget_subject_for_owner(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
) -> AgentGatewayBudgetSubjectRecord | None:
    owner_filters = [
        AgentGatewayBudgetSubject.owner_scope == owner_scope,
        AgentGatewayBudgetSubject.budget_kind == "proliferate_managed",
        AgentGatewayBudgetSubject.status != "revoked",
    ]
    if owner_scope == "personal":
        owner_filters.extend(
            [
                AgentGatewayBudgetSubject.owner_user_id == owner_user_id,
                AgentGatewayBudgetSubject.organization_id.is_(None),
            ]
        )
    else:
        owner_filters.extend(
            [
                AgentGatewayBudgetSubject.organization_id == organization_id,
                AgentGatewayBudgetSubject.owner_user_id.is_(None),
            ]
        )
    row = (
        await db.execute(select(AgentGatewayBudgetSubject).where(*owner_filters))
    ).scalar_one_or_none()
    return _budget_subject_record(row) if row is not None else None


async def get_user_managed_budget_subject(
    db: AsyncSession,
    user_id: UUID,
) -> AgentGatewayBudgetSubjectRecord | None:
    return await get_managed_budget_subject_for_owner(
        db,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
    )


async def ensure_free_credit_entitlement(
    db: AsyncSession,
    *,
    user_id: UUID,
    source: str,
    period_key: str,
    included_budget_usd: str,
    status: str,
    budget_subject_id: UUID | None = None,
    last_error_code: str | None = None,
    last_error_message: str | None = None,
) -> AgentGatewayFreeCreditEntitlementRecord:
    row = (
        await db.execute(
            select(AgentGatewayFreeCreditEntitlement)
            .where(
                AgentGatewayFreeCreditEntitlement.user_id == user_id,
                AgentGatewayFreeCreditEntitlement.source == source,
                AgentGatewayFreeCreditEntitlement.period_key == period_key,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentGatewayFreeCreditEntitlement(
            user_id=user_id,
            budget_subject_id=budget_subject_id,
            source=source,
            period_key=period_key,
            included_budget_usd=included_budget_usd,
            status=status,
            activated_at=now if status == "active" else None,
            exhausted_at=now if status == "exhausted" else None,
            revoked_at=now if status == "revoked" else None,
            last_error_code=last_error_code,
            last_error_message=last_error_message,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        changed = (
            row.budget_subject_id != budget_subject_id
            or row.included_budget_usd != included_budget_usd
            or row.status != status
            or row.last_error_code != last_error_code
            or row.last_error_message != last_error_message
        )
        row.budget_subject_id = budget_subject_id
        row.included_budget_usd = included_budget_usd
        row.status = status
        row.last_error_code = last_error_code
        row.last_error_message = last_error_message
        if status == "active" and row.activated_at is None:
            row.activated_at = now
        if status == "exhausted" and row.exhausted_at is None:
            row.exhausted_at = now
        if status == "revoked" and row.revoked_at is None:
            row.revoked_at = now
        if changed:
            row.updated_at = now
    await db.flush()
    return _free_credit_entitlement_record(row)


async def get_free_credit_entitlement(
    db: AsyncSession,
    *,
    user_id: UUID,
    source: str,
    period_key: str,
) -> AgentGatewayFreeCreditEntitlementRecord | None:
    row = (
        await db.execute(
            select(AgentGatewayFreeCreditEntitlement).where(
                AgentGatewayFreeCreditEntitlement.user_id == user_id,
                AgentGatewayFreeCreditEntitlement.source == source,
                AgentGatewayFreeCreditEntitlement.period_key == period_key,
            )
        )
    ).scalar_one_or_none()
    return _free_credit_entitlement_record(row) if row is not None else None


async def get_free_credit_entitlement_for_budget(
    db: AsyncSession,
    budget_subject_id: UUID,
    *,
    source: str | None = None,
    period_key: str | None = None,
) -> AgentGatewayFreeCreditEntitlementRecord | None:
    filters = [
        AgentGatewayFreeCreditEntitlement.budget_subject_id == budget_subject_id,
        AgentGatewayFreeCreditEntitlement.status != "revoked",
    ]
    if source is not None:
        filters.append(AgentGatewayFreeCreditEntitlement.source == source)
    if period_key is not None:
        filters.append(AgentGatewayFreeCreditEntitlement.period_key == period_key)
    row = (
        (
            await db.execute(
                select(AgentGatewayFreeCreditEntitlement)
                .where(*filters)
                .order_by(AgentGatewayFreeCreditEntitlement.updated_at.desc())
            )
        )
        .scalars()
        .first()
    )
    return _free_credit_entitlement_record(row) if row is not None else None


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


async def get_budget_subject(
    db: AsyncSession,
    budget_subject_id: UUID,
) -> AgentGatewayBudgetSubjectRecord | None:
    row = await db.get(AgentGatewayBudgetSubject, budget_subject_id)
    return _budget_subject_record(row) if row is not None else None


async def list_managed_budget_subjects_for_reconciliation(
    db: AsyncSession,
    *,
    limit: int,
) -> tuple[AgentGatewayBudgetSubjectRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayBudgetSubject)
                .where(
                    AgentGatewayBudgetSubject.status != "revoked",
                    or_(
                        AgentGatewayBudgetSubject.litellm_sync_status != "synced",
                        AgentGatewayBudgetSubject.last_litellm_reconciled_at.is_(None),
                    ),
                )
                .order_by(
                    AgentGatewayBudgetSubject.last_litellm_reconciled_at.asc().nullsfirst(),
                    AgentGatewayBudgetSubject.updated_at.asc(),
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_budget_subject_record(row) for row in rows)


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


async def list_selections_for_profile(
    db: AsyncSession,
    sandbox_profile_id: UUID,
) -> tuple[SandboxAgentAuthSelectionRecord, ...]:
    rows = (
        (
            await db.execute(
                select(SandboxAgentAuthSelection)
                .where(SandboxAgentAuthSelection.sandbox_profile_id == sandbox_profile_id)
                .order_by(SandboxAgentAuthSelection.agent_kind.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_selection_record(row) for row in rows)


async def list_selected_personal_synced_credentials_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> tuple[AgentAuthCredentialRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentAuthCredential)
                .join(
                    SandboxAgentAuthSelection,
                    SandboxAgentAuthSelection.credential_id == AgentAuthCredential.id,
                )
                .join(
                    SandboxProfile,
                    SandboxProfile.id == SandboxAgentAuthSelection.sandbox_profile_id,
                )
                .where(
                    SandboxProfile.owner_scope == "personal",
                    SandboxProfile.owner_user_id == user_id,
                    SandboxProfile.archived_at.is_(None),
                    AgentAuthCredential.owner_scope == "personal",
                    AgentAuthCredential.owner_user_id == user_id,
                    AgentAuthCredential.credential_kind == "synced_path",
                    AgentAuthCredential.status == "ready",
                    AgentAuthCredential.revoked_at.is_(None),
                    SandboxAgentAuthSelection.status == "active",
                    SandboxAgentAuthSelection.materialization_mode == "synced_files",
                    SandboxAgentAuthSelection.selected_revision == AgentAuthCredential.revision,
                )
                .order_by(AgentAuthCredential.agent_kind.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_credential_record(row) for row in rows)


async def upsert_selection(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    owner_scope: str,
    agent_kind: str,
    credential_id: UUID,
    credential_share_id: UUID | None,
    materialization_mode: str,
    selected_revision: int,
    status: str,
    last_error_code: str | None,
    last_error_message: str | None,
) -> SandboxAgentAuthSelectionRecord:
    row = (
        await db.execute(
            select(SandboxAgentAuthSelection)
            .where(
                SandboxAgentAuthSelection.sandbox_profile_id == sandbox_profile_id,
                SandboxAgentAuthSelection.agent_kind == agent_kind,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = SandboxAgentAuthSelection(
            sandbox_profile_id=sandbox_profile_id,
            owner_scope=owner_scope,
            agent_kind=agent_kind,
            credential_id=credential_id,
            credential_share_id=credential_share_id,
            materialization_mode=materialization_mode,
            selected_revision=selected_revision,
            status=status,
            last_error_code=last_error_code,
            last_error_message=last_error_message,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.owner_scope = owner_scope
        row.credential_id = credential_id
        row.credential_share_id = credential_share_id
        row.materialization_mode = materialization_mode
        row.selected_revision = selected_revision
        row.status = status
        row.last_error_code = last_error_code
        row.last_error_message = last_error_message
        row.updated_at = now
    await db.flush()
    return _selection_record(row)


async def mark_selection_invalid(
    db: AsyncSession,
    *,
    selection_id: UUID,
    error_code: str,
    error_message: str,
) -> SandboxAgentAuthSelectionRecord | None:
    row = await db.get(SandboxAgentAuthSelection, selection_id)
    if row is None:
        return None
    row.status = "invalid"
    row.last_error_code = error_code
    row.last_error_message = error_message
    row.updated_at = utcnow()
    await db.flush()
    return _selection_record(row)


async def list_target_states_for_profile(
    db: AsyncSession,
    sandbox_profile_id: UUID,
) -> tuple[SandboxProfileAgentAuthTargetStateRecord, ...]:
    rows = (
        (
            await db.execute(
                select(SandboxProfileTargetState)
                .where(SandboxProfileTargetState.sandbox_profile_id == sandbox_profile_id)
                .order_by(SandboxProfileTargetState.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_target_state_record(row) for row in rows)


async def get_target_state(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> SandboxProfileAgentAuthTargetStateRecord | None:
    row = (
        await db.execute(
            select(SandboxProfileTargetState).where(
                SandboxProfileTargetState.sandbox_profile_id == sandbox_profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
        )
    ).scalar_one_or_none()
    return _target_state_record(row) if row is not None else None


async def upsert_target_state(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    desired_revision: int,
    applied_revision: int | None,
    status: str,
    force_restart_required: bool,
    last_command_id: UUID | None,
    last_worker_id: UUID | None,
    last_error_code: str | None,
    last_error_message: str | None,
    pending_cleanup_json: str | None | object = _UNSET,
) -> SandboxProfileAgentAuthTargetStateRecord:
    row = (
        await db.execute(
            select(SandboxProfileTargetState)
            .where(
                SandboxProfileTargetState.sandbox_profile_id == sandbox_profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    attempted_at = now if status in {"materializing", "failed", "applied"} else None
    applied_at = now if status == "applied" else None
    active_sandbox_id: UUID | None = None
    slot_generation: int | None = None
    if status == "applied":
        active_slot = (
            await db.execute(
                select(CloudSandbox).where(
                    CloudSandbox.sandbox_profile_id == sandbox_profile_id,
                    CloudSandbox.target_id == target_id,
                    CloudSandbox.superseded_at.is_(None),
                    CloudSandbox.status.in_(
                        ("creating", "provisioning", "running", "paused", "blocked")
                    ),
                )
            )
        ).scalar_one_or_none()
        if active_slot is not None:
            active_sandbox_id = active_slot.id
            slot_generation = active_slot.slot_generation
    if row is None:
        row = SandboxProfileTargetState(
            sandbox_profile_id=sandbox_profile_id,
            target_id=target_id,
            active_sandbox_id=active_sandbox_id,
            slot_generation=slot_generation,
            desired_agent_auth_revision=desired_revision,
            applied_agent_auth_revision=applied_revision,
            agent_auth_status=status,
            agent_auth_force_restart_required=force_restart_required,
            last_agent_auth_command_id=last_command_id,
            last_agent_auth_worker_id=last_worker_id,
            last_agent_auth_attempted_at=attempted_at,
            last_agent_auth_applied_at=applied_at,
            last_agent_auth_error_code=last_error_code,
            last_agent_auth_error_message=last_error_message,
            pending_agent_auth_cleanup_json=(
                None if pending_cleanup_json is _UNSET else pending_cleanup_json
            ),
            applied_runtime_config_sequence=0,
            applied_runtime_config_revision_id=None,
            runtime_config_status="applied",
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.desired_agent_auth_revision = desired_revision
        row.applied_agent_auth_revision = applied_revision
        if status == "applied":
            row.active_sandbox_id = active_sandbox_id
            row.slot_generation = slot_generation
        row.agent_auth_status = status
        row.agent_auth_force_restart_required = force_restart_required
        row.last_agent_auth_command_id = last_command_id
        row.last_agent_auth_worker_id = last_worker_id
        if attempted_at is not None:
            row.last_agent_auth_attempted_at = attempted_at
        if applied_at is not None:
            row.last_agent_auth_applied_at = applied_at
        row.last_agent_auth_error_code = last_error_code
        row.last_agent_auth_error_message = last_error_message
        if pending_cleanup_json is not _UNSET:
            row.pending_agent_auth_cleanup_json = pending_cleanup_json
        elif status == "applied":
            row.pending_agent_auth_cleanup_json = None
        row.updated_at = now
    await db.flush()
    return _target_state_record(row)


async def mark_runtime_config_pending(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    sequence: int,
    revision_id: UUID,
) -> SandboxProfileAgentAuthTargetStateRecord:
    row = await _get_or_create_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        runtime_config_status="pending",
    )
    if (
        row.applied_runtime_config_revision_id != str(revision_id)
        or row.applied_runtime_config_sequence < sequence
    ):
        row.runtime_config_status = "pending"
        row.updated_at = utcnow()
    await db.flush()
    return _target_state_record(row)


async def mark_runtime_config_failed(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    sequence: int,
    revision_id: UUID,
    error_code: str,
    error_message: str,
) -> SandboxProfileAgentAuthTargetStateRecord:
    row = await _get_or_create_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        runtime_config_status="failed",
    )
    row.runtime_config_status = "failed"
    row.last_runtime_config_attempted_at = utcnow()
    row.last_runtime_config_error_code = error_code
    row.last_runtime_config_error_message = error_message
    if (
        row.applied_runtime_config_revision_id == str(revision_id)
        and row.applied_runtime_config_sequence >= sequence
    ):
        row.applied_runtime_config_sequence = 0
        row.applied_runtime_config_revision_id = None
    row.updated_at = utcnow()
    await db.flush()
    return _target_state_record(row)


async def record_runtime_config_command(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    command_id: UUID,
) -> SandboxProfileAgentAuthTargetStateRecord | None:
    row = await _load_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if row is None:
        return None
    row.last_runtime_config_command_id = command_id
    row.runtime_config_status = "pending"
    row.updated_at = utcnow()
    await db.flush()
    return _target_state_record(row)


async def record_runtime_config_worker_status(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    sequence: int,
    revision_id: UUID,
    worker_id: UUID,
    status: str,
    error_code: str | None,
    error_message: str | None,
) -> SandboxProfileAgentAuthTargetStateRecord:
    row = await _get_or_create_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        runtime_config_status=status,
    )
    now = utcnow()
    row.runtime_config_status = status
    row.last_runtime_config_worker_id = worker_id
    row.last_runtime_config_attempted_at = now
    row.last_runtime_config_error_code = error_code
    row.last_runtime_config_error_message = error_message
    if status == "applied":
        row.applied_runtime_config_sequence = sequence
        row.applied_runtime_config_revision_id = str(revision_id)
        row.last_runtime_config_applied_at = now
        row.last_runtime_config_error_code = None
        row.last_runtime_config_error_message = None
    row.updated_at = now
    await db.flush()
    return _target_state_record(row)


async def _load_target_state_for_update(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> SandboxProfileTargetState | None:
    return (
        await db.execute(
            select(SandboxProfileTargetState)
            .where(
                SandboxProfileTargetState.sandbox_profile_id == sandbox_profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()


async def _get_or_create_target_state_for_update(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    runtime_config_status: str,
) -> SandboxProfileTargetState:
    row = await _load_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if row is not None:
        return row
    now = utcnow()
    row = SandboxProfileTargetState(
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        desired_agent_auth_revision=0,
        applied_agent_auth_revision=None,
        agent_auth_status="applied",
        agent_auth_force_restart_required=False,
        applied_runtime_config_sequence=0,
        applied_runtime_config_revision_id=None,
        runtime_config_status=runtime_config_status,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    return row


async def create_runtime_grant(
    db: AsyncSession,
    *,
    token_hash: str,
    hash_key_id: str,
    policy_id: UUID,
    credential_id: UUID,
    selection_id: UUID,
    issued_profile_revision: int,
    target_id: UUID,
    sandbox_profile_id: UUID,
    cloud_sandbox_id: UUID | None,
    slot_generation: int | None,
    organization_id: UUID | None,
    user_id: UUID | None,
    agent_kind: str,
    protocol_facade: str,
    expires_at: datetime,
) -> AgentGatewayRuntimeGrantRecord:
    now = utcnow()
    row = AgentGatewayRuntimeGrant(
        token_hash=token_hash,
        hash_key_id=hash_key_id,
        policy_id=policy_id,
        credential_id=credential_id,
        selection_id=selection_id,
        issued_profile_revision=issued_profile_revision,
        target_id=target_id,
        sandbox_profile_id=sandbox_profile_id,
        cloud_sandbox_id=cloud_sandbox_id,
        slot_generation=slot_generation,
        organization_id=organization_id,
        user_id=user_id,
        agent_kind=agent_kind,
        protocol_facade=protocol_facade,
        expires_at=expires_at,
        revoked_at=None,
        last_used_at=None,
        created_at=now,
    )
    db.add(row)
    await db.flush()
    return _runtime_grant_record(row)


async def get_runtime_grant_by_token_hash(
    db: AsyncSession,
    token_hash: str,
) -> AgentGatewayRuntimeGrantRecord | None:
    row = (
        await db.execute(
            select(AgentGatewayRuntimeGrant).where(
                AgentGatewayRuntimeGrant.token_hash == token_hash
            )
        )
    ).scalar_one_or_none()
    return _runtime_grant_record(row) if row is not None else None


async def list_active_runtime_grants_for_route(
    db: AsyncSession,
    *,
    policy_id: UUID,
    target_id: UUID,
    sandbox_profile_id: UUID,
    agent_kind: str,
    now: datetime,
) -> tuple[AgentGatewayRuntimeGrantRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant)
                .where(
                    AgentGatewayRuntimeGrant.policy_id == policy_id,
                    AgentGatewayRuntimeGrant.target_id == target_id,
                    AgentGatewayRuntimeGrant.sandbox_profile_id == sandbox_profile_id,
                    AgentGatewayRuntimeGrant.agent_kind == agent_kind,
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                    AgentGatewayRuntimeGrant.expires_at > now,
                )
                .order_by(AgentGatewayRuntimeGrant.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_runtime_grant_record(row) for row in rows)


async def list_runtime_grants_needing_rotation(
    db: AsyncSession,
    *,
    now: datetime,
    expires_before: datetime,
    limit: int,
) -> tuple[AgentGatewayRuntimeGrantRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant)
                .join(
                    SandboxAgentAuthSelection,
                    SandboxAgentAuthSelection.id == AgentGatewayRuntimeGrant.selection_id,
                )
                .join(
                    AgentAuthCredential,
                    AgentAuthCredential.id == AgentGatewayRuntimeGrant.credential_id,
                )
                .join(
                    AgentGatewayPolicy,
                    AgentGatewayPolicy.id == AgentGatewayRuntimeGrant.policy_id,
                )
                .join(
                    SandboxProfile,
                    SandboxProfile.id == AgentGatewayRuntimeGrant.sandbox_profile_id,
                )
                .where(
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                    AgentGatewayRuntimeGrant.expires_at > now,
                    AgentGatewayRuntimeGrant.expires_at <= expires_before,
                    SandboxAgentAuthSelection.status == "active",
                    SandboxAgentAuthSelection.selected_revision == AgentAuthCredential.revision,
                    AgentAuthCredential.status == "ready",
                    AgentAuthCredential.revoked_at.is_(None),
                    AgentGatewayPolicy.status == "ready",
                    AgentGatewayPolicy.litellm_sync_status == "synced",
                    SandboxProfile.archived_at.is_(None),
                    SandboxProfile.deleted_at.is_(None),
                )
                .order_by(AgentGatewayRuntimeGrant.expires_at.asc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_runtime_grant_record(row) for row in rows)


async def lock_runtime_grant_route(
    db: AsyncSession,
    *,
    policy_id: UUID,
    target_id: UUID,
    sandbox_profile_id: UUID,
    agent_kind: str,
) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {
            "lock_key": (
                "agent_gateway_runtime_grant:"
                f"{policy_id}:{target_id}:{sandbox_profile_id}:{agent_kind}"
            )
        },
    )


async def mark_runtime_grant_used(
    db: AsyncSession,
    grant_id: UUID,
) -> AgentGatewayRuntimeGrantRecord | None:
    row = await db.get(AgentGatewayRuntimeGrant, grant_id)
    if row is None:
        return None
    row.last_used_at = utcnow()
    await db.flush()
    return _runtime_grant_record(row)


async def revoke_runtime_grants_for_selection(
    db: AsyncSession,
    *,
    selection_id: UUID,
) -> int:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant).where(
                    AgentGatewayRuntimeGrant.selection_id == selection_id,
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.revoked_at = now
    return len(rows)


async def revoke_runtime_grants_by_ids(
    db: AsyncSession,
    grant_ids: set[UUID],
) -> int:
    if not grant_ids:
        return 0
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant).where(
                    AgentGatewayRuntimeGrant.id.in_(grant_ids),
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.revoked_at = now
    await db.flush()
    return len(rows)


async def revoke_runtime_grants_for_profile_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> int:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant).where(
                    AgentGatewayRuntimeGrant.sandbox_profile_id == sandbox_profile_id,
                    AgentGatewayRuntimeGrant.target_id == target_id,
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.revoked_at = now
    await db.flush()
    return len(rows)


async def record_audit_event(
    db: AsyncSession,
    *,
    action: str,
    actor_user_id: UUID | None,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    credential_id: UUID | None = None,
    sandbox_profile_id: UUID | None = None,
    target_id: UUID | None = None,
    metadata_json: str = "{}",
) -> AgentAuthAuditEventRecord:
    row = AgentAuthAuditEvent(
        action=action,
        actor_user_id=actor_user_id,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        credential_id=credential_id,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        metadata_json=metadata_json,
        created_at=utcnow(),
    )
    db.add(row)
    await db.flush()
    return _audit_event_record(row)


async def try_acquire_agent_gateway_reconciler_lock(db: AsyncSession) -> bool:
    result = await db.scalar(
        text("SELECT pg_try_advisory_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": "agent_gateway_litellm_reconciler"},
    )
    return bool(result)


async def release_agent_gateway_reconciler_lock(db: AsyncSession) -> None:
    await db.execute(
        text("SELECT pg_advisory_unlock(hashtextextended(:lock_key, 0))"),
        {"lock_key": "agent_gateway_litellm_reconciler"},
    )
