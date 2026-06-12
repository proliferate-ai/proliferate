"""Agent-auth credentials concern."""

from __future__ import annotations

import json
from datetime import timedelta
from uuid import UUID

from cryptography.fernet import InvalidToken
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
    SUPPORTED_CLOUD_CREDENTIAL_SYNC_AGENTS,
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentGatewayProviderCredentialRecord,
)
from proliferate.server.cloud.agent_auth.access_control import (
    _require_organization_admin,
    _require_organization_member,
)
from proliferate.server.cloud.agent_auth.byok_gates import (
    _require_gateway_byok_create_allowed,
    _require_gateway_byok_enabled,
)
from proliferate.server.cloud.agent_auth.byok_validation import _validate_provider_payload
from proliferate.server.cloud.agent_auth.deployment_plans import (
    _gateway_deployments_for_credential,
)
from proliferate.server.cloud.agent_auth.domain.policy import (
    SelectionPlan,
    selection_plan_for_credential,
)
from proliferate.server.cloud.agent_auth.domain.synced_payload import (
    normalize_synced_credential_payload,
    redacted_synced_payload_summary,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.gateway_policies import (
    _provision_policy,
    _validate_policy_owner_scope,
)
from proliferate.server.cloud.agent_auth.models import (
    CreateGatewayCredentialRequest,
    SyncSyncedCredentialRequest,
)
from proliferate.server.cloud.agent_auth.refresh import _mark_target_pending_and_queue_refresh
from proliferate.server.cloud.agent_auth.registry import (
    auth_slot,
    credential_provider_id_for_provider_kind,
    default_auth_slot_id,
)
from proliferate.server.cloud.agent_auth.results import (
    CreateGatewayCredentialResult,
    CredentialListItem,
    SyncSyncedCredentialResult,
)
from proliferate.server.cloud.agent_auth.value_redaction import (
    _clean_display_name,
    _safe_error_message,
)
from proliferate.utils.crypto import decrypt_json, encrypt_json
from proliferate.utils.time import utcnow

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_DEFAULT_MANAGED_CREDIT_AGENT_KINDS: tuple[CloudAgentKind, ...] = ("claude",)
_USER_FREE_CREDIT_SOURCE = "signup_free_credit"
_CLEANUP_SELECTION_ERROR_CODES = {
    "credential_revoked",
    "credential_share_revoked",
}
_MANAGED_CODEX_HOME = "/home/user/.proliferate/anyharness/agent-auth/codex"
_OPENCODE_ALLOWED_AUTH_FILES: frozenset[str] = frozenset({".config/opencode/auth.json"})
_TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES = frozenset(
    {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
)


async def list_credentials(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID | None,
    credential_provider_id: str | None,
) -> tuple[AgentAuthCredentialRecord, ...]:
    if organization_id is not None:
        await _require_organization_member(db, actor_user_id, organization_id)
    return await store.list_visible_credentials(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        credential_provider_id=credential_provider_id,
    )


async def list_credentials_for_response(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID | None,
    credential_provider_id: str | None,
) -> tuple[CredentialListItem, ...]:
    credentials = await list_credentials(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        credential_provider_id=credential_provider_id,
    )
    items: list[CredentialListItem] = []
    for credential in credentials:
        active_share = None
        if (
            organization_id is not None
            and credential.owner_scope == "personal"
            and credential.credential_kind == "synced_path"
        ):
            active_share = await store.get_active_credential_share(
                db,
                credential_id=credential.id,
                organization_id=organization_id,
            )
        items.append(CredentialListItem(credential=credential, active_share=active_share))
    return tuple(items)


async def sync_synced_credential_for_user(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    agent_kind: CloudAgentKind,
    body: SyncSyncedCredentialRequest,
) -> SyncSyncedCredentialResult:
    if agent_kind not in SUPPORTED_CLOUD_CREDENTIAL_SYNC_AGENTS:
        raise AgentAuthError(
            "Native auth sync is not supported for this agent.",
            code="unsupported_synced_agent_kind",
            status_code=400,
        )
    auth_slot_id = default_auth_slot_id(agent_kind)
    slot = auth_slot(agent_kind, auth_slot_id or "")
    if auth_slot_id is None or slot is None or not slot.credential_provider_ids:
        raise AgentAuthError(
            "Native auth sync is not configured for this agent.",
            code="unsupported_synced_agent_kind",
            status_code=400,
        )
    credential_provider_id = slot.credential_provider_ids[0]
    normalized = normalize_synced_credential_payload(
        agent_kind=agent_kind,
        auth_mode=body.auth_mode,
        env_vars=getattr(body, "env_vars", None),
        files=getattr(body, "files", None),
    )
    normalized.payload["provider"] = credential_provider_id
    redacted_summary = redacted_synced_payload_summary(
        agent_kind=agent_kind,
        payload=normalized.payload,
    )
    redacted_summary_json = json.dumps(redacted_summary, sort_keys=True)
    payload_ciphertext = encrypt_json(normalized.payload)

    profile = await store.ensure_personal_sandbox_profile(
        db,
        user_id=actor_user_id,
        created_by_user_id=actor_user_id,
    )
    existing = await store.get_active_personal_synced_credential_for_update(
        db,
        user_id=actor_user_id,
        credential_provider_id=credential_provider_id,
    )
    payload_changed = True
    if existing is not None and existing.payload_ciphertext:
        try:
            existing_payload = decrypt_json(existing.payload_ciphertext)
        except (InvalidToken, ValueError):
            payload_changed = True
        else:
            payload_changed = (
                existing.status != "ready"
                or existing_payload != normalized.payload
                or existing.redacted_summary_json != redacted_summary_json
            )

    display_name = f"Synced {agent_kind} auth"
    if existing is None:
        credential = await store.create_agent_auth_credential(
            db,
            owner_scope="personal",
            owner_user_id=actor_user_id,
            organization_id=None,
            created_by_user_id=actor_user_id,
            credential_provider_id=credential_provider_id,
            credential_kind="synced_path",
            display_name=display_name,
            redacted_summary_json=redacted_summary_json,
            status="ready",
            payload_ciphertext=payload_ciphertext,
            payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        )
    else:
        credential = await store.update_synced_credential_payload(
            db,
            credential_id=existing.id,
            display_name=display_name,
            redacted_summary_json=redacted_summary_json,
            payload_ciphertext=payload_ciphertext,
            payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
            status="ready",
            increment_revision=payload_changed,
        )
        if credential is None:
            raise AgentAuthError(
                "Credential not found.",
                code="credential_not_found",
                status_code=404,
            )

    plan = selection_plan_for_credential(
        agent_kind=agent_kind,
        auth_slot_id=auth_slot_id,
        credential_provider_id=credential.credential_provider_id,
        credential_kind=credential.credential_kind,
        synced_source_agent_kind=agent_kind,
    )
    if not isinstance(plan, SelectionPlan):
        raise AgentAuthError(plan.message, code=plan.code, status_code=plan.status_code)
    if plan.materialization_mode != "synced_files":
        raise AgentAuthError(
            "Synced credentials must materialize as files.",
            code="invalid_materialization_mode",
            status_code=500,
        )

    selections = {
        (selection.agent_kind, selection.auth_slot_id): selection
        for selection in await store.list_selections_for_profile(db, profile.id)
    }
    existing_selection = selections.get((agent_kind, auth_slot_id))
    selection_changed = (
        existing_selection is None
        or existing_selection.status != "active"
        or existing_selection.credential_id != credential.id
        or existing_selection.credential_share_id is not None
        or existing_selection.materialization_mode != plan.materialization_mode
        or existing_selection.selected_revision != credential.revision
    )
    selection = await store.upsert_selection(
        db,
        sandbox_profile_id=profile.id,
        owner_scope="personal",
        agent_kind=agent_kind,
        auth_slot_id=auth_slot_id,
        credential_id=credential.id,
        credential_share_id=None,
        materialization_mode=plan.materialization_mode,
        selected_revision=credential.revision,
        status="active",
        last_error_code=None,
        last_error_message=None,
    )

    changed = payload_changed or selection_changed
    if changed:
        updated_profile = await store.bump_sandbox_profile_agent_auth_revision(
            db,
            sandbox_profile_id=profile.id,
            reason="synced_credential_sync",
            actor_user_id=actor_user_id,
            force_restart=False,
        )
        if updated_profile is None:
            raise AgentAuthError(
                "Sandbox profile not found.",
                code="sandbox_profile_not_found",
                status_code=404,
            )
        await _mark_target_pending_and_queue_refresh(
            db,
            profile=updated_profile,
            actor_user_id=actor_user_id,
            reason="synced_credential_sync",
            force_restart=False,
        )

    await store.record_audit_event(
        db,
        action="credential.sync",
        actor_user_id=actor_user_id,
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=None,
        credential_id=credential.id,
        sandbox_profile_id=profile.id,
        metadata_json=json.dumps(
            {
                "agentKind": agent_kind,
                "authSlotId": auth_slot_id,
                "authMode": normalized.auth_mode,
                "changed": changed,
                "selectionChanged": selection_changed,
            },
            sort_keys=True,
        ),
    )
    return SyncSyncedCredentialResult(
        credential=credential,
        selection=selection,
        changed=changed,
    )


async def create_gateway_credential(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    body: CreateGatewayCredentialRequest,
) -> CreateGatewayCredentialResult:
    if body.owner_scope == "organization":
        if body.organization_id is None:
            raise AgentAuthError(
                "organizationId is required.", code="missing_organization_id", status_code=400
            )
        await _require_organization_admin(db, actor_user_id, body.organization_id)
        owner_user_id = None
        organization_id = body.organization_id
    else:
        if body.organization_id is not None:
            raise AgentAuthError(
                "organizationId is not valid for personal credentials.",
                code="invalid_owner_scope",
                status_code=400,
            )
        owner_user_id = actor_user_id
        organization_id = None

    _validate_policy_owner_scope(body.policy_kind, body.owner_scope)
    _require_gateway_byok_enabled(body.provider_kind)
    _require_gateway_byok_create_allowed(body.policy_kind)
    expected_credential_provider_id = credential_provider_id_for_provider_kind(body.provider_kind)
    if (
        body.credential_provider_id is not None
        and body.credential_provider_id != expected_credential_provider_id
    ):
        raise AgentAuthError(
            "credentialProviderId does not match providerKind.",
            code="credential_provider_mismatch",
            status_code=400,
        )
    credential_provider_id = expected_credential_provider_id

    validation = _validate_provider_payload(body.provider_kind, body.payload)
    credential = await store.create_agent_auth_credential(
        db,
        owner_scope=body.owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=actor_user_id,
        credential_provider_id=credential_provider_id,
        credential_kind="managed_gateway",
        display_name=_clean_display_name(body.display_name),
        redacted_summary_json=json.dumps(validation.redacted_summary, sort_keys=True),
        status="pending",
    )
    await store.record_audit_event(
        db,
        action="credential.create",
        actor_user_id=actor_user_id,
        owner_scope=body.owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        credential_id=credential.id,
        metadata_json=json.dumps(
            {
                "credentialProviderId": credential_provider_id,
                "credentialKind": "managed_gateway",
                "providerKind": body.provider_kind,
            },
            sort_keys=True,
        ),
    )
    provider_credential: AgentGatewayProviderCredentialRecord | None = None
    if validation.status != "valid":
        policy = await store.ensure_gateway_policy(
            db,
            credential_id=credential.id,
            policy_kind=body.policy_kind,
            owner_scope=body.owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            budget_subject_id=None,
            litellm_team_id=None,
            litellm_virtual_key_id=None,
            litellm_virtual_key_ciphertext=None,
            litellm_virtual_key_ciphertext_key_id=None,
            litellm_sync_status="failed",
            litellm_sync_fingerprint=None,
            status="invalid",
            last_error_code=validation.error_code,
            last_error_message=_safe_error_message(validation.error_message, body.payload),
        )
        sync_status = "failed"
        status = "invalid"
        error_code = validation.error_code
        error_message = _safe_error_message(validation.error_message, body.payload)
    else:
        policy = await store.ensure_gateway_policy(
            db,
            credential_id=credential.id,
            policy_kind=body.policy_kind,
            owner_scope=body.owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            budget_subject_id=None,
            litellm_team_id=None,
            litellm_virtual_key_id=None,
            litellm_virtual_key_ciphertext=None,
            litellm_virtual_key_ciphertext_key_id=None,
            litellm_sync_status="pending",
            litellm_sync_fingerprint=None,
            status="provisioning",
            last_error_code=None,
            last_error_message=None,
        )
        provider_credential = await store.upsert_provider_credential(
            db,
            policy_id=policy.id,
            provider_kind=body.provider_kind,
            payload_ciphertext=encrypt_json(dict(body.payload)),
            payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
            redacted_summary_json=json.dumps(validation.redacted_summary, sort_keys=True),
            validation_status=validation.status,
            validated_at=utcnow(),
            validation_error_code=None,
            validation_error_message=None,
        )
        policy, sync_status, status, error_code, error_message = await _provision_policy(
            db,
            credential=credential,
            policy_kind=body.policy_kind,
            owner_scope=body.owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            budget_subject_id=None,
            provider_kind=body.provider_kind,
            provider_payload=body.payload,
            model_deployments=_gateway_deployments_for_credential(
                credential_provider_id=credential_provider_id,
                provider_kind=body.provider_kind,
            ),
            existing_policy=policy,
        )
    if provider_credential is None:
        provider_credential = await store.upsert_provider_credential(
            db,
            policy_id=policy.id,
            provider_kind=body.provider_kind,
            payload_ciphertext=encrypt_json(dict(body.payload)),
            payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
            redacted_summary_json=json.dumps(validation.redacted_summary, sort_keys=True),
            validation_status=validation.status,
            validated_at=utcnow() if validation.status == "valid" else None,
            validation_error_code=validation.error_code,
            validation_error_message=_safe_error_message(validation.error_message, body.payload),
        )
    credential = await store.update_credential_status(
        db,
        credential_id=credential.id,
        status="ready" if sync_status == "synced" and status == "ready" else "invalid",
        redacted_summary_json=json.dumps(validation.redacted_summary, sort_keys=True),
    )
    if credential is None:
        raise AgentAuthError("Credential disappeared during creation.", code="credential_missing")
    if error_code is not None:
        await store.record_audit_event(
            db,
            action="credential.validate",
            actor_user_id=actor_user_id,
            owner_scope=body.owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            credential_id=credential.id,
            metadata_json=json.dumps(
                {"status": "failed", "errorCode": error_code, "errorMessage": error_message},
                sort_keys=True,
            ),
        )
    return CreateGatewayCredentialResult(
        credential=credential,
        policy=policy,
        provider_credential=provider_credential,
    )
