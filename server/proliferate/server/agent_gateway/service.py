"""Business logic for the agent model gateway."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from collections.abc import Mapping

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    AGENT_GATEWAY_RUNTIME_GRANT_TOKEN_DOMAIN,
    AGENT_GATEWAY_TOKEN_HASH_KEY_ID,
)
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayPolicyRecord,
    AgentGatewayRuntimeGrantRecord,
)
from proliferate.integrations.litellm import (
    LiteLLMIntegrationError,
    LiteLLMRuntimeClient,
    LiteLLMRuntimeStatusError,
)
from proliferate.server.agent_gateway.domain.protocols import (
    allowed_models_for_agent,
    litellm_body_for_gateway_request,
    litellm_path_for_gateway_path,
    litellm_protocol_headers_for_gateway_request,
    litellm_query_string_for_gateway_request,
    model_from_body,
    protocol_for_path,
    request_wants_stream,
)
from proliferate.server.agent_gateway.errors import AgentGatewayError
from proliferate.server.agent_gateway.models import (
    AuthorizedGatewayRequest,
    GatewayForwardResponse,
    GatewayForwardStream,
    GatewayModelsResponse,
)
from proliferate.server.cloud.agent_auth.domain.byok_policy import gateway_byok_policy_verdict
from proliferate.utils.crypto import decrypt_text
from proliferate.utils.time import duration_ms, utcnow

logger = logging.getLogger("proliferate.agent_gateway")


async def list_gateway_models(
    db: AsyncSession,
    *,
    raw_token: str,
    gateway_path: str,
) -> GatewayModelsResponse:
    authorized = await authorize_gateway_request(
        db,
        raw_token=raw_token,
        gateway_path=gateway_path,
        request_model=None,
    )
    return GatewayModelsResponse(
        protocol_facade=authorized.protocol_facade,
        model_ids=authorized.allowed_model_ids,
    )


async def forward_gateway_request(
    db: AsyncSession,
    *,
    raw_token: str,
    gateway_path: str,
    query_string: str,
    method: str,
    body: bytes,
    content_type: str | None,
    protocol_headers: Mapping[str, str],
) -> GatewayForwardResponse | GatewayForwardStream:
    started = time.perf_counter()
    authorized: AuthorizedGatewayRequest | None = None
    request_model: str | None = None
    stream = False
    try:
        if len(body) > settings.agent_gateway_max_request_bytes:
            raise AgentGatewayError(
                "Gateway request body is too large.",
                code="gateway_request_too_large",
                status_code=413,
            )
        body_json = _json_body(body)
        request_model = model_from_body(body_json)
        if request_model is None:
            raise AgentGatewayError(
                "Gateway request model is required.",
                code="invalid_model",
                status_code=400,
            )
        stream = request_wants_stream(body_json)
        authorized = await authorize_gateway_request(
            db,
            raw_token=raw_token,
            gateway_path=gateway_path,
            request_model=request_model,
        )
        client = LiteLLMRuntimeClient()
        metadata = _metadata_for_request(authorized)
        litellm_path = litellm_path_for_gateway_path(gateway_path)
        litellm_query_string = litellm_query_string_for_gateway_request(
            gateway_path,
            query_string,
        )
        litellm_protocol_headers = litellm_protocol_headers_for_gateway_request(
            gateway_path,
            protocol_headers,
        )
        litellm_body = litellm_body_for_gateway_request(gateway_path, body_json, body)
        if stream:
            response_stream = await client.open_stream(
                method=method,
                path=litellm_path,
                query_string=litellm_query_string,
                body=litellm_body,
                litellm_key=authorized.litellm_key,
                content_type=content_type,
                protocol_headers=litellm_protocol_headers,
                metadata=metadata,
            )
            _log_gateway_request(
                started=started,
                gateway_path=gateway_path,
                method=method,
                request_model=request_model,
                stream=stream,
                authorized=authorized,
                outcome="success",
                status_code=response_stream.status_code,
            )
            return GatewayForwardStream(
                status_code=response_stream.status_code,
                headers=response_stream.headers,
                chunks=response_stream.chunks,
            )
        response = await client.forward(
            method=method,
            path=litellm_path,
            query_string=litellm_query_string,
            body=litellm_body,
            litellm_key=authorized.litellm_key,
            content_type=content_type,
            protocol_headers=litellm_protocol_headers,
            metadata=metadata,
        )
        _log_gateway_request(
            started=started,
            gateway_path=gateway_path,
            method=method,
            request_model=request_model,
            stream=stream,
            authorized=authorized,
            outcome="success",
            status_code=response.status_code,
        )
        return GatewayForwardResponse(
            status_code=response.status_code,
            headers=response.headers,
            content=response.content,
        )
    except AgentGatewayError as exc:
        _log_gateway_request(
            started=started,
            gateway_path=gateway_path,
            method=method,
            request_model=request_model,
            stream=stream,
            authorized=authorized,
            outcome="error",
            status_code=exc.status_code,
            error_code=exc.code,
        )
        raise
    except LiteLLMRuntimeStatusError as exc:
        mapped = _map_litellm_error(exc)
        if mapped.code == "credits_exhausted" and authorized is not None:
            await _mark_authorized_budget_exhausted(db, authorized)
        _log_gateway_request(
            started=started,
            gateway_path=gateway_path,
            method=method,
            request_model=request_model,
            stream=stream,
            authorized=authorized,
            outcome="error",
            status_code=mapped.status_code,
            error_code=mapped.code,
        )
        raise mapped from exc
    except LiteLLMIntegrationError as exc:
        mapped = AgentGatewayError(
            "LiteLLM is unavailable.",
            code="litellm_unavailable",
            status_code=503,
        )
        _log_gateway_request(
            started=started,
            gateway_path=gateway_path,
            method=method,
            request_model=request_model,
            stream=stream,
            authorized=authorized,
            outcome="error",
            status_code=mapped.status_code,
            error_code=mapped.code,
        )
        raise mapped from exc


async def authorize_gateway_request(
    db: AsyncSession,
    *,
    raw_token: str,
    gateway_path: str,
    request_model: str | None,
) -> AuthorizedGatewayRequest:
    if not settings.agent_gateway_enabled:
        raise AgentGatewayError(
            "Agent gateway is disabled.",
            code="gateway_route_unavailable",
            status_code=503,
        )
    if not raw_token:
        raise AgentGatewayError(
            "Missing gateway token.",
            code="invalid_gateway_token",
            status_code=401,
        )
    grant = await _load_grant(db, raw_token)
    requested_protocol = protocol_for_path(gateway_path)
    if requested_protocol == "unknown" or grant.protocol_facade != requested_protocol:
        raise AgentGatewayError(
            "Gateway token is not valid for this protocol.",
            code="protocol_not_supported",
            status_code=403,
        )
    profile = await store.get_sandbox_profile(db, grant.sandbox_profile_id)
    if profile is None:
        raise AgentGatewayError(
            "Agent auth is not configured.",
            code="agent_auth_not_configured",
            status_code=403,
        )
    if profile.primary_target_id is not None and grant.target_id != profile.primary_target_id:
        raise AgentGatewayError(
            "Gateway token is stale.",
            code="invalid_gateway_token",
            status_code=401,
        )
    if grant.issued_profile_revision != profile.agent_auth_revision:
        raise AgentGatewayError(
            "Gateway token is stale.",
            code="invalid_gateway_token",
            status_code=401,
        )
    target_state = await store.get_target_state(
        db,
        sandbox_profile_id=grant.sandbox_profile_id,
        target_id=grant.target_id,
    )
    if (
        target_state is None
        or target_state.status != "applied"
        or target_state.applied_revision is None
        or target_state.applied_revision < grant.issued_profile_revision
        or target_state.active_sandbox_id != grant.cloud_sandbox_id
        or target_state.slot_generation != grant.slot_generation
    ):
        raise AgentGatewayError(
            "Gateway token is stale.",
            code="invalid_gateway_token",
            status_code=401,
        )
    selection = await store.get_selection(db, grant.selection_id)
    if selection is None or selection.status != "active":
        raise AgentGatewayError(
            "Agent auth selection is not active.",
            code="agent_auth_not_configured",
            status_code=403,
        )
    if selection.credential_id != grant.credential_id or selection.agent_kind != grant.agent_kind:
        raise AgentGatewayError(
            "Gateway token is stale.",
            code="invalid_gateway_token",
            status_code=401,
        )
    credential = await store.get_credential(db, grant.credential_id)
    if (
        credential is None
        or credential.status != "ready"
        or credential.revoked_at is not None
        or selection.selected_revision != credential.revision
    ):
        raise AgentGatewayError(
            "Agent auth credential is not ready.",
            code="agent_auth_not_configured",
            status_code=403,
        )
    policy = await store.get_gateway_policy(db, grant.policy_id)
    if policy is None or policy.credential_id != credential.id:
        raise AgentGatewayError(
            "Agent gateway policy is not configured.",
            code="agent_auth_not_configured",
            status_code=403,
        )
    _require_policy_ready(policy)
    await _require_gateway_policy_launchable(db, policy)
    await _require_budget_ready(db, policy)
    allowed_models = allowed_models_for_agent(grant.agent_kind)
    if grant.agent_kind == "opencode" and not settings.agent_gateway_opencode_enabled:
        allowed_models = ()
    if not allowed_models:
        raise AgentGatewayError(
            "Gateway route is unavailable for this agent.",
            code="gateway_route_unavailable",
            status_code=403,
        )
    if request_model is not None and request_model not in allowed_models:
        raise AgentGatewayError(
            "Model is not available for this gateway policy.",
            code="model_not_available",
            status_code=404,
        )
    if not policy.litellm_virtual_key_ciphertext:
        raise AgentGatewayError(
            "Agent gateway policy is not configured.",
            code="agent_auth_not_configured",
            status_code=403,
        )
    await store.mark_runtime_grant_used(db, grant.id)
    return AuthorizedGatewayRequest(
        litellm_key=decrypt_text(policy.litellm_virtual_key_ciphertext),
        agent_kind=grant.agent_kind,
        protocol_facade=grant.protocol_facade,
        policy_id=policy.id,
        organization_id=grant.organization_id,
        user_id=grant.user_id,
        target_id=grant.target_id,
        sandbox_profile_id=grant.sandbox_profile_id,
        allowed_model_ids=allowed_models,
    )


async def _load_grant(
    db: AsyncSession,
    raw_token: str,
) -> AgentGatewayRuntimeGrantRecord:
    token_hash = _hash_token(raw_token)
    grant = await store.get_runtime_grant_by_token_hash(db, token_hash)
    if grant is None or grant.hash_key_id != AGENT_GATEWAY_TOKEN_HASH_KEY_ID:
        raise AgentGatewayError(
            "Invalid gateway token.",
            code="invalid_gateway_token",
            status_code=401,
        )
    now = utcnow()
    if grant.revoked_at is not None:
        raise AgentGatewayError(
            "Invalid gateway token.",
            code="invalid_gateway_token",
            status_code=401,
        )
    if grant.expires_at <= now:
        raise AgentGatewayError(
            "Gateway token expired.",
            code="gateway_token_expired",
            status_code=401,
        )
    return grant


def _require_policy_ready(policy: AgentGatewayPolicyRecord) -> None:
    if policy.status != "ready" or policy.litellm_sync_status != "synced":
        raise AgentGatewayError(
            "Gateway route is unavailable.",
            code="gateway_route_unavailable",
            status_code=503,
        )


async def _require_gateway_policy_launchable(
    db: AsyncSession,
    policy: AgentGatewayPolicyRecord,
) -> None:
    if policy.policy_kind == "proliferate_managed":
        return
    if policy.policy_kind not in {"org_byok", "personal_byok"}:
        raise AgentGatewayError(
            "Gateway policy kind is not supported.",
            code="gateway_route_unavailable",
            status_code=503,
        )
    verdict = gateway_byok_policy_verdict(
        policy_kind=policy.policy_kind,
        gateway_byok_enabled=settings.agent_gateway_byok_enabled,
        personal_byok_enabled=settings.agent_gateway_personal_byok_enabled,
        litellm_topology=settings.agent_gateway_litellm_topology,
        customer_secret_isolation_verified=(
            settings.agent_gateway_litellm_customer_secret_isolation_verified
        ),
    )
    if not verdict.allowed:
        raise AgentGatewayError(
            verdict.message or "Gateway BYOK provider credentials are disabled.",
            code=verdict.code or "gateway_byok_disabled",
            status_code=403,
        )
    provider_credential = await store.get_provider_credential_for_policy(db, policy.id)
    if provider_credential is None:
        raise AgentGatewayError(
            "Gateway route is unavailable.",
            code="gateway_route_unavailable",
            status_code=503,
        )
    if not _gateway_byok_provider_enabled(provider_credential.provider_kind):
        raise AgentGatewayError(
            "Gateway BYOK provider credentials are disabled.",
            code="gateway_byok_disabled",
            status_code=403,
        )


def _gateway_byok_provider_enabled(provider_kind: str) -> bool:
    if not settings.agent_gateway_byok_enabled:
        return False
    if provider_kind == "anthropic_api_key":
        return settings.agent_gateway_anthropic_byok_enabled
    if provider_kind == "openai_api_key":
        return settings.agent_gateway_openai_byok_enabled
    if provider_kind == "bedrock_assume_role":
        return settings.agent_gateway_bedrock_byok_enabled
    if provider_kind == "openai_compatible":
        return settings.agent_gateway_openai_compatible_byok_enabled
    return False


async def _require_budget_ready(
    db: AsyncSession,
    policy: AgentGatewayPolicyRecord,
) -> None:
    if policy.budget_subject_id is None:
        return
    budget = await store.get_budget_subject(db, policy.budget_subject_id)
    if budget is None or budget.litellm_sync_status != "synced":
        raise AgentGatewayError(
            "Gateway route is unavailable.",
            code="gateway_route_unavailable",
            status_code=503,
        )
    if budget.status == "exhausted":
        raise AgentGatewayError(
            "Managed credits are exhausted.",
            code="credits_exhausted",
            status_code=402,
        )
    if budget.status != "ready":
        raise AgentGatewayError(
            "Gateway route is unavailable.",
            code="gateway_route_unavailable",
            status_code=503,
        )


async def _mark_authorized_budget_exhausted(
    db: AsyncSession,
    authorized: AuthorizedGatewayRequest,
) -> None:
    policy = await store.get_gateway_policy(db, authorized.policy_id)
    if policy is None or policy.budget_subject_id is None:
        return
    budget = await store.get_budget_subject(db, policy.budget_subject_id)
    if budget is None:
        return
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
        last_error_code="credits_exhausted",
        last_error_message="Managed credits are exhausted.",
    )
    if budget.owner_scope != "personal":
        return
    entitlement = await store.get_free_credit_entitlement_for_budget(
        db,
        budget.id,
        source=budget.entitlement_source,
        period_key=budget.entitlement_period_key,
    )
    if entitlement is None:
        return
    await store.ensure_free_credit_entitlement(
        db,
        user_id=entitlement.user_id,
        source=entitlement.source,
        period_key=entitlement.period_key,
        included_budget_usd=entitlement.included_budget_usd,
        budget_subject_id=budget.id,
        status="exhausted",
        last_error_code="credits_exhausted",
        last_error_message="Managed credits are exhausted.",
    )


def _json_body(body: bytes) -> dict[str, object]:
    if not body:
        return {}
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AgentGatewayError(
            "Gateway request body must be a JSON object.",
            code="gateway_route_unavailable",
            status_code=400,
        ) from exc
    if not isinstance(parsed, dict):
        raise AgentGatewayError(
            "Gateway request body must be a JSON object.",
            code="gateway_route_unavailable",
            status_code=400,
        )
    return parsed


def _metadata_for_request(authorized: AuthorizedGatewayRequest) -> dict[str, str]:
    metadata = {
        "target_id": str(authorized.target_id),
        "sandbox_profile_id": str(authorized.sandbox_profile_id),
        "agent_kind": authorized.agent_kind,
        "policy_id": str(authorized.policy_id),
    }
    if authorized.organization_id is not None:
        metadata["org_id"] = str(authorized.organization_id)
    if authorized.user_id is not None:
        metadata["user_id"] = str(authorized.user_id)
    return metadata


def _log_gateway_request(
    *,
    started: float,
    gateway_path: str,
    method: str,
    request_model: str | None,
    stream: bool,
    authorized: AuthorizedGatewayRequest | None,
    outcome: str,
    status_code: int,
    error_code: str | None = None,
) -> None:
    logger.info(
        "agent gateway request completed",
        extra={
            "event": "agent_gateway_request",
            "outcome": outcome,
            "status_code": status_code,
            "error_code": error_code,
            "elapsed_ms": duration_ms(started),
            "method": method,
            "protocol_facade": (
                authorized.protocol_facade if authorized else protocol_for_path(gateway_path)
            ),
            "stream": stream,
            "model_hash": _privacy_hash(request_model),
            "agent_kind": authorized.agent_kind if authorized else None,
            "policy_hash": _privacy_hash_id("policy", authorized.policy_id)
            if authorized
            else None,
            "organization_hash": _privacy_hash_id("organization", authorized.organization_id)
            if authorized and authorized.organization_id is not None
            else None,
            "user_hash": _privacy_hash_id("user", authorized.user_id)
            if authorized and authorized.user_id is not None
            else None,
            "target_hash": _privacy_hash_id("target", authorized.target_id)
            if authorized
            else None,
            "sandbox_profile_hash": _privacy_hash_id(
                "sandbox_profile",
                authorized.sandbox_profile_id,
            )
            if authorized
            else None,
        },
    )


def _privacy_hash(value: str | None) -> str | None:
    if value is None:
        return None
    return hashlib.sha256(f"agent-gateway:{value}".encode()).hexdigest()[:16]


def _privacy_hash_id(scope: str, value: object) -> str:
    return _privacy_hash(f"{scope}:{value}") or ""


def _map_litellm_error(error: LiteLLMRuntimeStatusError) -> AgentGatewayError:
    body_text = error.body.decode("utf-8", errors="replace").lower()
    if "budget" in body_text or "max_budget" in body_text or "credit" in body_text:
        return AgentGatewayError(
            "Managed credits are exhausted.",
            code="credits_exhausted",
            status_code=402,
        )
    if error.status_code in {401, 403}:
        return AgentGatewayError(
            "Provider authentication failed.",
            code="provider_auth_failed",
            status_code=502,
        )
    if error.status_code == 404:
        return AgentGatewayError(
            "Model is not available.",
            code="model_not_available",
            status_code=404,
        )
    if error.status_code == 429:
        return AgentGatewayError(
            "Provider rate limit reached.",
            code="provider_rate_limited",
            status_code=429,
        )
    return AgentGatewayError(
        "LiteLLM is unavailable.",
        code="litellm_unavailable",
        status_code=503,
    )


def _hash_token(raw_token: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{AGENT_GATEWAY_RUNTIME_GRANT_TOKEN_DOMAIN}:{raw_token}".encode(),
        hashlib.sha256,
    ).hexdigest()
