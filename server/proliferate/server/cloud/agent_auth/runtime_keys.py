"""Agent-auth runtime keys concern."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayPolicyRecord,
    AgentGatewayRuntimeGrantRecord,
    SandboxAgentAuthSelectionRecord,
    SandboxProfileRecord,
)
from proliferate.integrations.bifrost import (
    BifrostIntegrationError,
)
from proliferate.server.cloud.agent_auth.bifrost_clients import new_bifrost_admin_client
from proliferate.server.cloud.agent_auth.budget_reconciliation import (
    _reconcile_managed_budget_subject,
)
from proliferate.server.cloud.agent_auth.deployment_plans import (
    _bifrost_virtual_key_fingerprint,
    _gateway_deployments_for_credential,
)
from proliferate.server.cloud.agent_auth.domain.policy import (
    SelectionPlan,
    selection_plan_for_credential,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.gateway_policies import (
    _require_credential_ready_for_selection,
)
from proliferate.server.cloud.agent_auth.managed_credit_rules import (
    _managed_credit_provider_kind_for_provider,
)
from proliferate.server.cloud.agent_auth.models import (
    WorkerAgentAuthGatewayConfig,
)
from proliferate.server.cloud.agent_auth.provider_keys import (
    _bifrost_provider_name_for_provider_kind,
    _ensure_bifrost_policy_provider_key,
    _ensure_bifrost_provider_key_for_managed_budget,
)
from proliferate.server.cloud.agent_auth.results import BifrostRuntimeVirtualKeyResult
from proliferate.server.cloud.agent_auth.router_materializations import (
    _disable_bifrost_virtual_key_materialization,
    _disable_bifrost_virtual_keys_for_budget,
)
from proliferate.server.cloud.agent_auth.synced_files import (
    _reject_unallowed_selection_protected_env,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.utils.crypto import decrypt_text, encrypt_text
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
_GATEWAY_GRANT_REFRESH_WINDOW = timedelta(days=2)
_RUNTIME_GRANT_TOKEN_DOMAIN = "agent-gateway-runtime-grant"
_RUNTIME_GRANT_HASH_KEY_ID = "sha256-v1"


async def _issue_bifrost_runtime_virtual_key_for_selection(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    profile: SandboxProfileRecord,
    selection: SandboxAgentAuthSelectionRecord,
) -> BifrostRuntimeVirtualKeyResult:
    if selection.status != "active":
        raise AgentAuthError(
            "Selection is not active.", code="selection_not_active", status_code=409
        )
    credential = await store.get_credential(db, selection.credential_id)
    if credential is None or credential.revoked_at is not None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    if selection.selected_revision != credential.revision:
        raise AgentAuthError(
            "Selection is stale.", code="selection_revision_stale", status_code=409
        )
    await _require_credential_ready_for_selection(db, credential)
    policy = await store.get_gateway_policy_for_credential(db, credential.id)
    if policy is None or policy.status != "ready" or policy.litellm_sync_status != "synced":
        raise AgentAuthError(
            "Gateway policy is not ready.", code="gateway_policy_not_ready", status_code=409
        )
    plan = selection_plan_for_credential(
        agent_kind=selection.agent_kind,
        auth_slot_id=selection.auth_slot_id,
        credential_provider_id=credential.credential_provider_id,
        credential_kind=credential.credential_kind,
    )
    if not isinstance(plan, SelectionPlan) or plan.protocol_facade is None:
        raise AgentAuthError(
            "Selection does not use gateway auth.", code="not_gateway_selection", status_code=400
        )
    if selection.agent_kind == "opencode" and not settings.agent_gateway_opencode_enabled:
        raise AgentAuthError(
            "Gateway auth for OpenCode is not enabled.",
            code="gateway_not_supported_for_agent",
            status_code=400,
        )

    provider_key = await _bifrost_provider_key_for_policy(
        db,
        policy=policy,
        agent_kind=selection.agent_kind,
        credential_provider_id=credential.credential_provider_id,
    )
    provider = str(provider_key["provider"])
    provider_key_id = str(provider_key["key_id"])
    models = tuple(str(model) for model in provider_key.get("models", ()) if str(model))
    if not models:
        raise AgentAuthError(
            "Bifrost provider key does not expose any models.",
            code="bifrost_models_not_configured",
            status_code=409,
        )
    budget_limit = await _bifrost_budget_limit_for_runtime_key(db, policy=policy)
    fingerprint = _bifrost_virtual_key_fingerprint(
        provider=provider,
        provider_key_id=provider_key_id,
        provider_key_fingerprint=(
            str(provider_key["provider_key_fingerprint"])
            if provider_key.get("provider_key_fingerprint") is not None
            else None
        ),
        models=models,
        budget_limit=budget_limit,
        agent_kind=selection.agent_kind,
        auth_slot_id=selection.auth_slot_id,
        policy_id=policy.id,
    )
    await store.lock_runtime_grant_route(
        db,
        policy_id=policy.id,
        target_id=auth.target_id,
        sandbox_profile_id=profile.id,
        agent_kind=selection.agent_kind,
        auth_slot_id=selection.auth_slot_id,
    )
    existing = await store.get_runtime_router_materialization(
        db,
        router_kind="bifrost",
        selection_id=selection.id,
        target_id=auth.target_id,
    )
    now = utcnow()
    stale_grant_ids: set[UUID] = set()
    if (
        existing is not None
        and existing.status == "active"
        and existing.sync_status == "synced"
        and existing.sync_fingerprint == fingerprint
        and existing.router_object_id
        and existing.router_object_secret_ciphertext
    ):
        existing_secret = decrypt_text(existing.router_object_secret_ciphertext)
        existing_grant = await store.get_runtime_grant_by_token_hash(
            db,
            _runtime_grant_token_hash(existing_secret),
        )
        if _runtime_grant_reusable(
            existing_grant,
            now=now,
            policy_id=policy.id,
            credential_id=credential.id,
            selection_id=selection.id,
            target_id=auth.target_id,
            sandbox_profile_id=profile.id,
            agent_kind=selection.agent_kind,
            auth_slot_id=selection.auth_slot_id,
            issued_profile_revision=profile.agent_auth_revision,
        ):
            return BifrostRuntimeVirtualKeyResult(
                virtual_key=existing_secret,
                virtual_key_id=existing.router_object_id,
                expires_at_iso=existing_grant.expires_at.isoformat(),
            )
        if existing_grant is not None:
            stale_grant_ids.add(existing_grant.id)

    client = new_bifrost_admin_client()
    if (
        existing is not None
        and existing.status == "active"
        and existing.router_object_id
    ):
        await _disable_bifrost_virtual_key_materialization(
            db,
            client=client,
            materialization=existing,
            error_code="bifrost_virtual_key_rotation_failed",
            raise_on_failure=True,
        )
        await store.revoke_runtime_grants_by_ids(db, stale_grant_ids)
        existing = None

    provider_config: dict[str, object] = {
        "provider": provider,
        "weight": 1.0,
        "allowed_models": list(models),
        "blacklisted_models": [],
        "key_ids": [provider_key_id],
    }
    if budget_limit is not None:
        provider_config["budgets"] = [
            {
                "max_limit": float(Decimal(budget_limit)),
                "reset_duration": "100Y",
            }
        ]
    name = (
        f"proliferate-{selection.agent_kind}-{selection.id.hex[:12]}-"
        f"{profile.id.hex[:12]}-{auth.target_id.hex[:12]}-"
        f"r{profile.agent_auth_revision}-{secrets.token_hex(4)}"
    )
    description = json.dumps(
        {
            "credentialId": str(credential.id),
            "authSlotId": selection.auth_slot_id,
            "policyId": str(policy.id),
            "sandboxProfileId": str(profile.id),
            "targetId": str(auth.target_id),
            "issuedProfileRevision": profile.agent_auth_revision,
        },
        sort_keys=True,
    )
    secret: str | None = None
    result = await client.create_virtual_key(
        name=name,
        description=description,
        provider_configs=[provider_config],
        budgets=[],
        is_active=True,
    )
    if not result.virtual_key:
        raise BifrostIntegrationError("Bifrost did not return the new virtual key value.")
    secret = result.virtual_key
    virtual_key_id = result.virtual_key_id

    materialization = await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="virtual_key",
        object_scope="runtime_selection",
        policy_id=policy.id,
        provider_credential_id=None,
        budget_subject_id=policy.budget_subject_id,
        selection_id=selection.id,
        sandbox_profile_id=profile.id,
        target_id=auth.target_id,
        agent_kind=selection.agent_kind,
        protocol_facade=plan.protocol_facade,
        router_object_id=virtual_key_id,
        router_object_secret_ciphertext=encrypt_text(secret),
        router_object_secret_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        sync_status="synced",
        sync_fingerprint=fingerprint,
        status="active",
    )
    if not materialization.router_object_id:
        raise BifrostIntegrationError("Bifrost virtual key materialization is missing an id.")
    expires_at = utcnow() + _GATEWAY_GRANT_TTL
    await store.create_runtime_grant(
        db,
        token_hash=_runtime_grant_token_hash(secret),
        hash_key_id=_RUNTIME_GRANT_HASH_KEY_ID,
        policy_id=policy.id,
        credential_id=credential.id,
        selection_id=selection.id,
        issued_profile_revision=profile.agent_auth_revision,
        target_id=auth.target_id,
        sandbox_profile_id=profile.id,
        organization_id=policy.organization_id,
        user_id=policy.owner_user_id,
        agent_kind=selection.agent_kind,
        auth_slot_id=selection.auth_slot_id,
        protocol_facade=plan.protocol_facade,
        expires_at=expires_at,
    )
    return BifrostRuntimeVirtualKeyResult(
        virtual_key=secret,
        virtual_key_id=materialization.router_object_id,
        expires_at_iso=expires_at.isoformat(),
    )


def _runtime_grant_token_hash(token: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{_RUNTIME_GRANT_TOKEN_DOMAIN}:{token}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _runtime_grant_reusable(
    grant: AgentGatewayRuntimeGrantRecord | None,
    *,
    now: datetime,
    policy_id: UUID,
    credential_id: UUID,
    selection_id: UUID,
    target_id: UUID,
    sandbox_profile_id: UUID,
    agent_kind: str,
    auth_slot_id: str,
    issued_profile_revision: int,
) -> bool:
    return (
        grant is not None
        and grant.revoked_at is None
        and grant.expires_at > now + _GATEWAY_GRANT_REFRESH_WINDOW
        and grant.issued_profile_revision == issued_profile_revision
        and grant.policy_id == policy_id
        and grant.credential_id == credential_id
        and grant.selection_id == selection_id
        and grant.target_id == target_id
        and grant.sandbox_profile_id == sandbox_profile_id
        and grant.agent_kind == agent_kind
        and grant.auth_slot_id == auth_slot_id
    )


async def _bifrost_provider_key_for_policy(
    db: AsyncSession,
    *,
    policy: AgentGatewayPolicyRecord,
    agent_kind: str,
    credential_provider_id: str,
) -> dict[str, object]:
    if policy.policy_kind == "proliferate_managed":
        provider_kind = _managed_credit_provider_kind_for_provider(credential_provider_id)
        if policy.budget_subject_id is None:
            raise AgentAuthError(
                "Managed gateway policy is missing a budget subject.",
                code="managed_budget_missing",
                status_code=409,
            )
        budget = await store.get_budget_subject(db, policy.budget_subject_id)
        if budget is None or budget.status == "revoked":
            raise AgentAuthError(
                "Managed budget subject is not available.",
                code="managed_budget_missing",
                status_code=409,
            )
        if budget.litellm_sync_status != "synced":
            budget = await _reconcile_managed_budget_subject(db, budget=budget)
        if budget.status == "exhausted":
            await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)
            raise AgentAuthError(
                "Managed credits are exhausted.",
                code="managed_credits_exhausted",
                status_code=402,
            )
        if budget.status == "invalid":
            await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)
            raise AgentAuthError(
                "Managed credits need review.",
                code=budget.last_error_code or "managed_budget_invalid",
                status_code=409,
            )
        deployments = _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            credential_provider_id=credential_provider_id,
            provider_kind=provider_kind,
        )
        if not deployments:
            raise AgentAuthError(
                "No Bifrost managed-credit models are configured for this agent.",
                code="bifrost_models_not_configured",
                status_code=409,
            )
        materialization = await _ensure_bifrost_provider_key_for_managed_budget(
            db,
            budget=budget,
            deployments=deployments,
            provider_kind=provider_kind,
        )
        provider = _bifrost_provider_name_for_provider_kind(provider_kind)
    else:
        provider_credential = await store.get_provider_credential_for_policy(db, policy.id)
        if provider_credential is None:
            raise AgentAuthError(
                "Gateway provider credential is not configured.",
                code="provider_credential_missing",
                status_code=409,
            )
        provider_kind = provider_credential.provider_kind
        deployments = _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            credential_provider_id=credential_provider_id,
            provider_kind=provider_kind,
        )
        if not deployments:
            raise AgentAuthError(
                "No Bifrost BYOK models are configured for this agent/provider.",
                code="bifrost_models_not_configured",
                status_code=409,
            )
        materialization = await _ensure_bifrost_policy_provider_key(
            db,
            policy=policy,
            provider_credential=provider_credential,
            deployments=deployments,
        )
        provider = _bifrost_provider_name_for_provider_kind(provider_kind)
    if not materialization.router_object_id:
        raise AgentAuthError(
            "Bifrost provider key is not ready.",
            code="bifrost_provider_key_not_ready",
            status_code=409,
        )
    _ = provider_kind
    return {
        "provider": provider,
        "key_id": materialization.router_object_id,
        "models": tuple(deployment.provider_model for deployment in deployments),
        "provider_key_fingerprint": materialization.sync_fingerprint,
    }


async def _bifrost_budget_limit_for_runtime_key(
    db: AsyncSession,
    *,
    policy: AgentGatewayPolicyRecord,
) -> str | None:
    if policy.policy_kind != "proliferate_managed":
        return None
    if policy.budget_subject_id is None:
        raise AgentAuthError(
            "Managed gateway policy is missing a budget subject.",
            code="managed_budget_missing",
            status_code=409,
        )
    budget = await store.get_budget_subject(db, policy.budget_subject_id)
    if budget is None:
        raise AgentAuthError(
            "Managed budget subject is not available.",
            code="managed_budget_missing",
            status_code=409,
        )
    used = await store.sum_llm_usage_cost_for_budget_subject(
        db,
        budget_subject_id=budget.id,
    )
    remaining = Decimal(budget.included_budget_usd) - used
    if remaining <= 0:
        await store.ensure_managed_budget_subject_for_owner(
            db,
            owner_scope=budget.owner_scope,
            owner_user_id=budget.owner_user_id,
            organization_id=budget.organization_id,
            included_budget_usd=budget.included_budget_usd,
            budget_duration=budget.budget_duration,
            entitlement_source=budget.entitlement_source,
            entitlement_period_key=budget.entitlement_period_key,
            litellm_team_id=budget.litellm_team_id,
            litellm_sync_status=budget.litellm_sync_status,
            litellm_sync_fingerprint=budget.litellm_sync_fingerprint,
            status="exhausted",
            last_error_code="managed_credits_exhausted",
            last_error_message="Managed credits are exhausted.",
        )
        await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)
        raise AgentAuthError(
            "Managed credits are exhausted.",
            code="managed_credits_exhausted",
            status_code=402,
        )
    return format(remaining, "f")


async def _worker_gateway_config(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    profile: SandboxProfileRecord,
    selection: SandboxAgentAuthSelectionRecord,
) -> WorkerAgentAuthGatewayConfig:
    result = await _issue_bifrost_runtime_virtual_key_for_selection(
        db,
        auth=auth,
        profile=profile,
        selection=selection,
    )
    base = _bifrost_public_base_url()
    if selection.agent_kind == "claude":
        facade_base = f"{base}/anthropic"
        config = WorkerAgentAuthGatewayConfig(
            protocolFacade="anthropic",
            baseUrls={"anthropic": facade_base},
            runtimeGrantToken=result.virtual_key,
            expiresAt=result.expires_at_iso,
            protectedEnv={
                "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST": "1",
                "ANTHROPIC_BASE_URL": facade_base,
                "ANTHROPIC_CUSTOM_HEADERS": f"x-bf-vk: {result.virtual_key}",
                "ANTHROPIC_AUTH_TOKEN": result.virtual_key,
            },
            supportEnv={},
            protectedConfig={},
            supportConfig={},
        )
        _reject_unallowed_selection_protected_env(
            agent_kind=selection.agent_kind,
            auth_slot_id=selection.auth_slot_id,
            materialization_mode=selection.materialization_mode,
            protected_env=config.protected_env,
        )
        return config
    if selection.agent_kind == "codex":
        facade_base = f"{base}/openai/v1"
        config = WorkerAgentAuthGatewayConfig(
            protocolFacade="openai",
            baseUrls={"openai": facade_base},
            runtimeGrantToken=result.virtual_key,
            expiresAt=result.expires_at_iso,
            protectedEnv={
                "CODEX_API_KEY": result.virtual_key,
                "OPENAI_API_KEY": result.virtual_key,
                "CODEX_HOME": _MANAGED_CODEX_HOME,
            },
            supportEnv={},
            protectedConfig={
                "codex": {
                    "openai_base_url": facade_base,
                    "env_key": "CODEX_API_KEY",
                    "model_provider": "proliferate",
                    "model_providers": {
                        "proliferate": {
                            "name": "Proliferate Gateway",
                            "base_url": facade_base,
                            "env_key": "CODEX_API_KEY",
                            "wire_api": "responses",
                            "requires_openai_auth": False,
                        }
                    },
                }
            },
            supportConfig={},
        )
        _reject_unallowed_selection_protected_env(
            agent_kind=selection.agent_kind,
            auth_slot_id=selection.auth_slot_id,
            materialization_mode=selection.materialization_mode,
            protected_env=config.protected_env,
        )
        return config
    if selection.agent_kind == "opencode":
        if selection.auth_slot_id == "anthropic":
            facade_base = f"{base}/anthropic"
            config = WorkerAgentAuthGatewayConfig(
                protocolFacade="anthropic",
                baseUrls={"anthropic": facade_base},
                runtimeGrantToken=result.virtual_key,
                expiresAt=result.expires_at_iso,
                protectedEnv={
                    "ANTHROPIC_API_KEY": result.virtual_key,
                    "ANTHROPIC_AUTH_TOKEN": result.virtual_key,
                    "ANTHROPIC_BASE_URL": facade_base,
                },
                supportEnv={},
                protectedConfig={},
                supportConfig={},
            )
        elif selection.auth_slot_id == "gemini":
            facade_base = f"{base}/genai"
            config = WorkerAgentAuthGatewayConfig(
                protocolFacade="genai",
                baseUrls={"genai": facade_base},
                runtimeGrantToken=result.virtual_key,
                expiresAt=result.expires_at_iso,
                protectedEnv={
                    "GEMINI_API_KEY": result.virtual_key,
                    "GOOGLE_GEMINI_BASE_URL": facade_base,
                },
                supportEnv={},
                protectedConfig={},
                supportConfig={},
            )
        else:
            facade_base = f"{base}/openai/v1"
            config = WorkerAgentAuthGatewayConfig(
                protocolFacade="openai",
                baseUrls={"openai": facade_base},
                runtimeGrantToken=result.virtual_key,
                expiresAt=result.expires_at_iso,
                protectedEnv={
                    "OPENAI_API_KEY": result.virtual_key,
                    "OPENAI_BASE_URL": facade_base,
                },
                supportEnv={},
                protectedConfig={},
                supportConfig={},
            )
        _reject_unallowed_selection_protected_env(
            agent_kind=selection.agent_kind,
            auth_slot_id=selection.auth_slot_id,
            materialization_mode=selection.materialization_mode,
            protected_env=config.protected_env,
        )
        return config
    if selection.agent_kind == "gemini":
        facade_base = f"{base}/genai"
        config = WorkerAgentAuthGatewayConfig(
            protocolFacade="genai",
            baseUrls={"genai": facade_base},
            runtimeGrantToken=result.virtual_key,
            expiresAt=result.expires_at_iso,
            protectedEnv={
                "GEMINI_API_KEY": result.virtual_key,
                "GOOGLE_GEMINI_BASE_URL": facade_base,
            },
            supportEnv={},
            protectedConfig={},
            supportConfig={},
        )
        _reject_unallowed_selection_protected_env(
            agent_kind=selection.agent_kind,
            auth_slot_id=selection.auth_slot_id,
            materialization_mode=selection.materialization_mode,
            protected_env=config.protected_env,
        )
        return config
    raise AgentAuthError(
        "Gateway auth is not supported for this agent.",
        code="gateway_not_supported_for_agent",
        status_code=400,
    )


def _bifrost_public_base_url() -> str:
    base = settings.agent_gateway_bifrost_public_base_url.strip().rstrip("/")
    if not base:
        raise AgentAuthError(
            "Bifrost public base URL is not configured.",
            code="bifrost_public_base_url_missing",
            status_code=409,
        )
    return base
