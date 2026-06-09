"""Agent-auth provider keys concern."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayPolicyRecord,
    AgentGatewayProviderCredentialRecord,
)
from proliferate.integrations.bifrost import (
    BifrostIntegrationError,
    bifrost_env_var,
)
from proliferate.server.cloud.agent_auth.bifrost_clients import new_bifrost_admin_client
from proliferate.server.cloud.agent_auth.models import (
    GatewayModelDeploymentRequest,
)
from proliferate.utils.crypto import decrypt_json

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


async def _ensure_bifrost_provider_key_for_managed_budget(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
    deployments: Sequence[GatewayModelDeploymentRequest],
    provider_kind: str,
) -> store.AgentGatewayRouterMaterializationRecord:
    key_plan = _bifrost_provider_key_plan(
        provider_kind=provider_kind,
        provider_payload={},
        deployments=deployments,
        object_id=str(budget.id),
        display_name=(
            "Proliferate managed "
            f"{_managed_provider_display_label(provider_kind)} credits {budget.id}"
        ),
    )
    fingerprint = _bifrost_provider_key_fingerprint(key_plan)
    existing = await store.get_router_materialization_by_object_id(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        router_object_id=str(key_plan["key_id"]),
    )
    if (
        existing is not None
        and existing.object_scope == "budget_subject"
        and existing.budget_subject_id == budget.id
        and existing.sync_status == "synced"
        and existing.sync_fingerprint == fingerprint
        and existing.router_object_id == key_plan["key_id"]
    ):
        return existing
    await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        object_scope="budget_subject",
        policy_id=None,
        provider_credential_id=None,
        budget_subject_id=budget.id,
        selection_id=None,
        sandbox_profile_id=None,
        target_id=None,
        agent_kind=None,
        protocol_facade=None,
        router_object_id=key_plan["key_id"],
        router_object_secret_ciphertext=None,
        router_object_secret_ciphertext_key_id=None,
        sync_status="pending",
        sync_fingerprint=fingerprint,
        status="active",
    )
    result = await new_bifrost_admin_client().upsert_provider_key(
        provider=str(key_plan["provider"]),
        key_id=str(key_plan["key_id"]),
        name=str(key_plan["name"]),
        value=key_plan.get("value") if isinstance(key_plan.get("value"), str) else None,
        models=tuple(str(item) for item in key_plan["models"]),
        aliases=key_plan.get("aliases") if isinstance(key_plan.get("aliases"), dict) else None,
        bedrock_key_config=(
            key_plan.get("bedrock_key_config")
            if isinstance(key_plan.get("bedrock_key_config"), dict)
            else None
        ),
        enabled=True,
    )
    return await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        object_scope="budget_subject",
        policy_id=None,
        provider_credential_id=None,
        budget_subject_id=budget.id,
        selection_id=None,
        sandbox_profile_id=None,
        target_id=None,
        agent_kind=None,
        protocol_facade=None,
        router_object_id=result.key_id,
        router_object_secret_ciphertext=None,
        router_object_secret_ciphertext_key_id=None,
        sync_status="synced",
        sync_fingerprint=fingerprint,
        status="active",
    )


async def _ensure_bifrost_policy_provider_key(
    db: AsyncSession,
    *,
    policy: AgentGatewayPolicyRecord,
    provider_credential: AgentGatewayProviderCredentialRecord,
    deployments: Sequence[GatewayModelDeploymentRequest],
) -> store.AgentGatewayRouterMaterializationRecord:
    payload = decrypt_json(provider_credential.payload_ciphertext)
    provider_payload = {str(key): str(value) for key, value in payload.items()}
    key_plan = _bifrost_provider_key_plan(
        provider_kind=provider_credential.provider_kind,
        provider_payload=provider_payload,
        deployments=deployments,
        object_id=str(policy.id),
        display_name=f"Credential {policy.credential_id}",
    )
    fingerprint = _bifrost_provider_key_fingerprint(key_plan)
    existing = await store.get_router_materialization_by_object_id(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        router_object_id=str(key_plan["key_id"]),
    )
    if (
        existing is not None
        and existing.object_scope == "policy"
        and existing.policy_id == policy.id
        and existing.sync_status == "synced"
        and existing.sync_fingerprint == fingerprint
        and existing.router_object_id == key_plan["key_id"]
    ):
        return existing
    await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        object_scope="policy",
        policy_id=policy.id,
        provider_credential_id=provider_credential.id,
        budget_subject_id=policy.budget_subject_id,
        selection_id=None,
        sandbox_profile_id=None,
        target_id=None,
        agent_kind=None,
        protocol_facade=None,
        router_object_id=key_plan["key_id"],
        router_object_secret_ciphertext=None,
        router_object_secret_ciphertext_key_id=None,
        sync_status="pending",
        sync_fingerprint=fingerprint,
        status="active",
    )
    result = await new_bifrost_admin_client().upsert_provider_key(
        provider=str(key_plan["provider"]),
        key_id=str(key_plan["key_id"]),
        name=str(key_plan["name"]),
        value=key_plan.get("value") if isinstance(key_plan.get("value"), str) else None,
        models=tuple(str(item) for item in key_plan["models"]),
        aliases=key_plan.get("aliases") if isinstance(key_plan.get("aliases"), dict) else None,
        bedrock_key_config=(
            key_plan.get("bedrock_key_config")
            if isinstance(key_plan.get("bedrock_key_config"), dict)
            else None
        ),
        enabled=True,
    )
    return await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        object_scope="policy",
        policy_id=policy.id,
        provider_credential_id=provider_credential.id,
        budget_subject_id=policy.budget_subject_id,
        selection_id=None,
        sandbox_profile_id=None,
        target_id=None,
        agent_kind=None,
        protocol_facade=None,
        router_object_id=result.key_id,
        router_object_secret_ciphertext=None,
        router_object_secret_ciphertext_key_id=None,
        sync_status="synced",
        sync_fingerprint=fingerprint,
        status="active",
    )


def _bifrost_provider_key_plan(
    *,
    provider_kind: str,
    provider_payload: dict[str, str],
    deployments: Sequence[GatewayModelDeploymentRequest],
    object_id: str,
    display_name: str,
) -> dict[str, object]:
    models = list(dict.fromkeys(deployment.provider_model for deployment in deployments))
    if provider_kind in {
        "proliferate_bedrock_pool",
        "proliferate_managed_anthropic",
        "proliferate_managed_openai",
        "proliferate_managed_gemini",
    }:
        return _bifrost_managed_provider_key_plan(
            provider_kind=provider_kind,
            object_id=object_id,
            display_name=display_name,
            models=models,
        )
    if provider_kind == "anthropic_api_key":
        return {
            "provider": "anthropic",
            "key_id": f"proliferate-policy-{object_id}",
            "name": display_name,
            "value": provider_payload["apiKey"],
            "models": models,
            "aliases": {},
        }
    if provider_kind == "openai_api_key":
        return {
            "provider": "openai",
            "key_id": f"proliferate-policy-{object_id}",
            "name": display_name,
            "value": provider_payload["apiKey"],
            "models": models,
            "aliases": {},
        }
    if provider_kind == "gemini_api_key":
        return {
            "provider": "gemini",
            "key_id": f"proliferate-policy-{object_id}",
            "name": display_name,
            "value": provider_payload["apiKey"],
            "models": models,
            "aliases": {},
        }
    if provider_kind == "bedrock_assume_role":
        return {
            "provider": "bedrock",
            "key_id": f"proliferate-policy-{object_id}",
            "name": display_name,
            "value": None,
            "models": models,
            "aliases": {},
            "bedrock_key_config": {
                "role_arn": bifrost_env_var(provider_payload["roleArn"]),
                "external_id": bifrost_env_var(provider_payload["externalId"]),
                "region": bifrost_env_var(provider_payload["region"]),
                "session_name": bifrost_env_var("proliferate-agent-gateway"),
            },
        }
    raise BifrostIntegrationError(f"Provider kind is not supported by Bifrost: {provider_kind}.")


def _bifrost_provider_name_for_provider_kind(provider_kind: str) -> str:
    if provider_kind == "proliferate_bedrock_pool":
        return "bedrock"
    if provider_kind == "proliferate_managed_anthropic":
        return "anthropic"
    if provider_kind == "proliferate_managed_openai":
        return "openai"
    if provider_kind == "proliferate_managed_gemini":
        return "gemini"
    if provider_kind == "anthropic_api_key":
        return "anthropic"
    if provider_kind == "openai_api_key":
        return "openai"
    if provider_kind == "gemini_api_key":
        return "gemini"
    if provider_kind == "bedrock_assume_role":
        return "bedrock"
    raise BifrostIntegrationError(f"Provider kind is not supported by Bifrost: {provider_kind}.")


def _managed_provider_display_label(provider_kind: str) -> str:
    if provider_kind == "proliferate_bedrock_pool":
        return "Bedrock"
    if provider_kind == "proliferate_managed_anthropic":
        return "Anthropic"
    if provider_kind == "proliferate_managed_openai":
        return "OpenAI"
    if provider_kind == "proliferate_managed_gemini":
        return "Gemini"
    raise BifrostIntegrationError(
        f"Provider kind is not supported by managed credits: {provider_kind}."
    )


def _bifrost_managed_provider_key_plan(
    *,
    provider_kind: str,
    object_id: str,
    display_name: str,
    models: Sequence[str],
) -> dict[str, object]:
    provider_slug = provider_kind.removeprefix("proliferate_managed_").replace("_", "-")
    key_id_prefix = f"proliferate-managed-{provider_slug}"
    if provider_kind == "proliferate_bedrock_pool":
        key_id_prefix = "proliferate-managed-bedrock"
    region = settings.agent_gateway_managed_bedrock_region.strip()
    role_arn = settings.agent_gateway_managed_bedrock_role_arn.strip()
    if provider_kind == "proliferate_bedrock_pool" and region and role_arn:
        config: dict[str, object] = {
            "role_arn": bifrost_env_var(role_arn),
            "region": bifrost_env_var(region),
            "session_name": bifrost_env_var("proliferate-managed-credits"),
        }
        external_id = settings.agent_gateway_managed_bedrock_external_id.strip()
        if external_id:
            config["external_id"] = bifrost_env_var(external_id)
        return {
            "provider": "bedrock",
            "key_id": f"{key_id_prefix}-{object_id}",
            "name": display_name,
            "value": None,
            "models": list(models),
            "aliases": {},
            "bedrock_key_config": config,
        }
    if (
        provider_kind == "proliferate_managed_anthropic"
        and settings.agent_gateway_managed_anthropic_api_key.strip()
    ):
        return {
            "provider": "anthropic",
            "key_id": f"{key_id_prefix}-{object_id}",
            "name": display_name,
            "value": settings.agent_gateway_managed_anthropic_api_key.strip(),
            "models": list(models),
            "aliases": {},
        }
    if (
        provider_kind == "proliferate_managed_openai"
        and settings.agent_gateway_managed_openai_api_key.strip()
    ):
        return {
            "provider": "openai",
            "key_id": f"{key_id_prefix}-{object_id}",
            "name": display_name,
            "value": settings.agent_gateway_managed_openai_api_key.strip(),
            "models": list(models),
            "aliases": {},
        }
    if (
        provider_kind == "proliferate_managed_gemini"
        and settings.agent_gateway_managed_gemini_api_key.strip()
    ):
        return {
            "provider": "gemini",
            "key_id": f"{key_id_prefix}-{object_id}",
            "name": display_name,
            "value": settings.agent_gateway_managed_gemini_api_key.strip(),
            "models": list(models),
            "aliases": {},
        }
    raise BifrostIntegrationError(
        f"No managed provider credential is configured for Bifrost provider kind: {provider_kind}."
    )


def _bifrost_provider_key_fingerprint(plan: dict[str, object]) -> str:
    payload = {
        key: value for key, value in plan.items() if key not in {"value", "bedrock_key_config"}
    }
    value = plan.get("value")
    if isinstance(value, str) and value:
        payload["value_sha256"] = hashlib.sha256(value.encode("utf-8")).hexdigest()
    if "bedrock_key_config" in plan:
        encoded_bedrock_config = json.dumps(
            plan["bedrock_key_config"],
            default=str,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        payload["bedrock_key_config_sha256"] = hashlib.sha256(encoded_bedrock_config).hexdigest()
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
