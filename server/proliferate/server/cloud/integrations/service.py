from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud_mcp import CLOUD_MCP_OAUTH_FLOW_TTL
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.cloud_integrations import accounts as account_store
from proliferate.db.store.cloud_integrations import definitions as definition_store
from proliferate.db.store.cloud_integrations import oauth_clients as oauth_client_store
from proliferate.db.store.cloud_integrations import oauth_flows as oauth_flow_store
from proliferate.db.store.cloud_integrations import tool_schema_cache as tool_cache_store
from proliferate.db.store.cloud_integrations.types import (
    IntegrationAccountRecord,
    IntegrationAccountWithDefinitionRecord,
    IntegrationDefinitionRecord,
    IntegrationOAuthClientRecord,
    IntegrationOAuthFlowRecord,
    IntegrationToolSchemaCacheRecord,
)
from proliferate.integrations import mcp_remote
from proliferate.integrations.mcp_oauth import (
    AuthorizationServerMetadata,
    McpOAuthProviderError,
    build_authorization_url,
    discover_authorization_server_metadata,
    discover_protected_resource_metadata,
    exchange_token,
    normalize_resource_url,
    random_urlsafe,
    refresh_token,
    register_client,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.catalog_sync import sync_seed_integration_catalog
from proliferate.server.cloud.integrations.domain.cache_keys import tool_schema_cache_key
from proliferate.server.cloud.integrations.domain.catalog_schema import (
    IntegrationAuthMode,
    auth_modes_from_config,
    content_hash,
    custom_definition_config_json,
    parse_definition_config,
    render_mcp_url,
)
from proliferate.server.cloud.integrations.domain.credential_strategy import (
    ProviderAccess,
    api_key_headers,
    oauth_headers,
)
from proliferate.server.cloud.integrations.domain.dynamic_validation import (
    validate_dynamic_http_mcp_definition,
)
from proliferate.server.cloud.integrations.domain.oauth_strategy import (
    choose_oauth_mode,
    static_oauth_client_config,
)
from proliferate.server.cloud.integrations.domain.tool_names import gateway_tool_name
from proliferate.server.cloud.integrations.models import (
    IntegrationAccountResponse,
    IntegrationAuthModeModel,
    IntegrationAvailabilityItem,
    IntegrationDefinitionResponse,
    IntegrationSettingModel,
    IntegrationSettingOptionModel,
    IntegrationToolMetadata,
    IntegrationToolMetadataTool,
)
from proliferate.server.cloud.mcp_oauth.domain.flow_rules import (
    OAuthReturnTarget,
    OAuthReturnTargetError,
    build_oauth_auth_payload,
    normalize_oauth_return_target,
    oauth_flow_is_expired,
    oauth_requested_scopes_json,
    oauth_state_hash,
    oauth_status_includes_authorization_url,
    should_drop_cached_oauth_client_on_token_error,
)
from proliferate.utils.crypto import decrypt_json, decrypt_text, encrypt_json, encrypt_text
from proliferate.utils.time import utcnow

_INTEGRATION_OAUTH_CALLBACK_PATH = "/v1/cloud/integrations/oauth/callback"


@dataclass(frozen=True)
class IntegrationOAuthFlowStatus:
    flow: IntegrationOAuthFlowRecord
    include_authorization_url: bool


@dataclass(frozen=True)
class IntegrationOAuthCallbackResult:
    ok: bool
    status: str
    flow_id: UUID | None
    failure_code: str | None
    callback_surface: str
    final_surface: str
    return_path: str | None


async def list_integration_definitions(
    db: AsyncSession,
    *,
    organization_id: UUID | None,
) -> list[IntegrationDefinitionResponse]:
    await sync_seed_integration_catalog(db)
    records = await definition_store.list_visible_definitions(
        db,
        organization_id=organization_id,
    )
    return [_definition_response(record) for record in records]


async def create_org_custom_definition(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    display_name: str,
    namespace: str,
    mcp_url: str,
) -> IntegrationDefinitionResponse:
    await _require_organization_admin(db, user_id=user_id, organization_id=organization_id)
    validation = await validate_dynamic_http_mcp_definition(
        display_name=display_name,
        namespace=namespace,
        mcp_url=mcp_url,
    )
    key = f"org_custom_{validation.namespace}_{uuid.uuid4().hex[:8]}"
    config_json = custom_definition_config_json(
        mcp_url=validation.mcp_url,
        client_strategy=validation.client_strategy,
    )
    record = await definition_store.create_org_custom_definition(
        db,
        organization_id=organization_id,
        created_by_user_id=user_id,
        key=key,
        content_hash=content_hash(
            {
                "displayName": validation.display_name,
                "namespace": validation.namespace,
                "mcpUrl": validation.mcp_url,
                "issuer": validation.issuer,
                "resource": validation.resource,
                "clientStrategy": validation.client_strategy,
            }
        ),
        display_name=validation.display_name,
        namespace=validation.namespace,
        config_json=config_json,
    )
    return _definition_response(record)


async def list_integration_accounts(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[IntegrationAccountResponse]:
    records = await account_store.list_accounts_for_user(db, user_id)
    return [_account_response(record) for record in records]


async def create_personal_integration_account(
    db: AsyncSession,
    *,
    user_id: UUID,
    definition_id: UUID,
    auth_kind: str,
    api_key: str | None,
    settings_payload: dict[str, object] | None,
) -> IntegrationAccountResponse:
    definition = await _load_definition(db, definition_id)
    config = parse_definition_config(definition.config_json)
    auth_mode = _require_auth_mode(config, auth_kind)
    settings_json = _settings_json(config, settings_payload)
    credential_ciphertext: str | None = None
    token_expires_at: datetime | None = None
    status = "setup_required"
    if auth_kind == "api_key":
        if definition.source != "seed":
            raise CloudApiError(
                "integration_auth_unsupported",
                "Custom integrations support OAuth only.",
                status_code=409,
            )
        if api_key:
            credential_ciphertext = encrypt_json({"kind": "api_key", "apiKey": api_key})
            status = "ready"
    elif auth_kind == "none":
        status = "ready"
    elif auth_kind == "oauth2":
        if auth_mode.kind != "oauth2":
            raise CloudApiError(
                "integration_auth_unsupported",
                "This integration does not support OAuth.",
                status_code=409,
            )
    record = await account_store.upsert_personal_account(
        db,
        user_id=user_id,
        definition_id=definition.id,
        auth_kind=auth_kind,
        status=status,
        settings_json=settings_json,
        credential_ciphertext=credential_ciphertext,
        token_expires_at=token_expires_at,
        last_error_code=None,
    )
    account = await account_store.get_account_with_definition(db, record.id)
    if account is None:
        raise CloudApiError(
            "integration_account_missing", "Integration account missing.", status_code=500
        )
    return _account_response(account)


async def patch_integration_account(
    db: AsyncSession,
    *,
    user_id: UUID,
    account_id: UUID,
    enabled: bool | None,
    api_key: str | None,
    settings_payload: dict[str, object] | None,
) -> IntegrationAccountResponse:
    account = await _load_account_for_user(db, user_id=user_id, account_id=account_id)
    config = parse_definition_config(account.definition.config_json)
    credential_ciphertext: str | None | object = account_store._UNSET  # noqa: SLF001
    status: str | None = None
    if api_key is not None:
        if account.definition.source != "seed" or account.account.auth_kind != "api_key":
            raise CloudApiError(
                "integration_auth_unsupported",
                "API-key updates are only supported for seeded API-key accounts.",
                status_code=409,
            )
        credential_ciphertext = encrypt_json({"kind": "api_key", "apiKey": api_key})
        status = "ready"
    settings_json = (
        _settings_json(config, settings_payload) if settings_payload is not None else None
    )
    patched = await account_store.patch_account(
        db,
        account_id=account.account.id,
        enabled=enabled,
        status=status,
        settings_json=settings_json,
        credential_ciphertext=credential_ciphertext,
        last_error_code=None if api_key is not None else account_store._UNSET,  # noqa: SLF001
    )
    if patched is None:
        raise CloudApiError(
            "integration_account_not_found", "Integration account not found.", status_code=404
        )
    await tool_cache_store.mark_tool_schema_cache_stale(db, account_id=account.account.id)
    refreshed = await account_store.get_account_with_definition(db, patched.id)
    if refreshed is None:
        raise CloudApiError(
            "integration_account_missing", "Integration account missing.", status_code=500
        )
    return _account_response(refreshed)


async def delete_integration_account(
    db: AsyncSession,
    *,
    user_id: UUID,
    account_id: UUID,
) -> None:
    account = await _load_account_for_user(db, user_id=user_id, account_id=account_id)
    await account_store.delete_account(db, account.account.id)


async def start_integration_oauth_flow(
    db: AsyncSession,
    *,
    user_id: UUID,
    account_id: UUID,
    callback_surface: str | None,
    final_surface: str | None,
    return_path: str | None,
    client_strategy: str | None,
) -> IntegrationOAuthFlowRecord:
    account = await _load_account_for_user(db, user_id=user_id, account_id=account_id)
    if account.account.auth_kind != "oauth2":
        raise CloudApiError(
            "integration_oauth_unavailable",
            "This integration account is not configured for OAuth.",
            status_code=409,
        )
    config = parse_definition_config(account.definition.config_json)
    auth_mode = choose_oauth_mode(
        auth_modes_from_config(config),
        requested_kind=client_strategy,
    )
    target = _oauth_return_target_or_raise(
        callback_surface=callback_surface,
        final_surface=final_surface,
        return_path=return_path,
    )
    mcp_url = render_mcp_url(config, _json_object(account.account.settings_json))
    resource_metadata = await discover_protected_resource_metadata(mcp_url)
    issuer = resource_metadata.authorization_servers[0]
    authorization_metadata = await discover_authorization_server_metadata(issuer)
    redirect_uri = _redirect_uri()
    resource = normalize_resource_url(resource_metadata.resource or mcp_url)
    client_record = await _get_oauth_client(
        db,
        definition=account.definition,
        mode=auth_mode,
        issuer=authorization_metadata.issuer,
        redirect_uri=redirect_uri,
        resource=resource,
        authorization_metadata=authorization_metadata,
    )
    state = random_urlsafe()
    verifier = random_urlsafe(64)
    authorization_url = build_authorization_url(
        metadata=authorization_metadata,
        client_id=client_record.client_id,
        redirect_uri=redirect_uri,
        state=state,
        verifier=verifier,
        resource=resource,
        scope=resource_metadata.challenged_scope,
    )
    return await oauth_flow_store.create_oauth_flow_canceling_existing(
        db,
        account_id=account.account.id,
        user_id=user_id,
        state_hash=oauth_state_hash(state),
        code_verifier_ciphertext=encrypt_text(verifier),
        issuer=authorization_metadata.issuer,
        resource=resource,
        client_id=client_record.client_id,
        client_strategy=client_record.client_strategy,
        token_endpoint=authorization_metadata.token_endpoint,
        requested_scopes=oauth_requested_scopes_json(resource_metadata.challenged_scope),
        redirect_uri=redirect_uri,
        authorization_url=authorization_url,
        callback_surface=target.callback_surface,
        final_surface=target.final_surface,
        return_path=target.return_path,
        expires_at=utcnow() + CLOUD_MCP_OAUTH_FLOW_TTL,
    )


async def get_integration_oauth_flow_status(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> IntegrationOAuthFlowStatus:
    flow = await oauth_flow_store.get_oauth_flow_for_user(db, user_id=user_id, flow_id=flow_id)
    if flow is None:
        raise CloudApiError("oauth_flow_not_found", "OAuth flow was not found.", status_code=404)
    if flow.status == "active" and oauth_flow_is_expired(expires_at=flow.expires_at, now=utcnow()):
        flow = await oauth_flow_store.expire_oauth_flow(db, flow_id=flow.id) or flow
    return IntegrationOAuthFlowStatus(
        flow=flow,
        include_authorization_url=oauth_status_includes_authorization_url(flow.status),
    )


async def cancel_integration_oauth_flow(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> IntegrationOAuthFlowStatus:
    flow = await oauth_flow_store.cancel_oauth_flow_for_user(
        db,
        user_id=user_id,
        flow_id=flow_id,
    )
    if flow is None:
        raise CloudApiError("oauth_flow_not_found", "OAuth flow was not found.", status_code=404)
    return IntegrationOAuthFlowStatus(flow=flow, include_authorization_url=False)


async def complete_integration_oauth_callback(
    db: AsyncSession,
    *,
    state: str,
    code: str | None,
    provider_error: str | None,
) -> IntegrationOAuthCallbackResult:
    flow = await oauth_flow_store.claim_active_oauth_flow_by_state_hash(
        db,
        state_hash=oauth_state_hash(state),
    )
    if flow is None:
        raise CloudApiError("oauth_flow_not_found", "OAuth flow was not found.", status_code=404)
    if provider_error:
        failed = (
            await oauth_flow_store.fail_oauth_flow(
                db,
                flow_id=flow.id,
                failure_code=provider_error,
            )
            or flow
        )
        return _callback_result(failed, ok=False, status="failed")
    if not code:
        failed = (
            await oauth_flow_store.fail_oauth_flow(
                db,
                flow_id=flow.id,
                failure_code="missing_code",
            )
            or flow
        )
        return _callback_result(failed, ok=False, status="failed")
    if oauth_flow_is_expired(expires_at=flow.expires_at, now=utcnow()):
        expired = await oauth_flow_store.expire_oauth_flow(db, flow_id=flow.id) or flow
        return _callback_result(expired, ok=False, status="expired")
    account = (
        await account_store.get_account_with_definition(db, flow.account_id)
        if flow.account_id
        else None
    )
    if account is None:
        failed = (
            await oauth_flow_store.fail_oauth_flow(
                db,
                flow_id=flow.id,
                failure_code="integration_account_not_found",
            )
            or flow
        )
        return _callback_result(failed, ok=False, status="failed")
    client_record = await oauth_client_store.get_oauth_client(
        db,
        definition_id=account.definition.id,
        issuer=flow.issuer or "",
        redirect_uri=flow.redirect_uri,
        resource=flow.resource,
    )
    client_secret = (
        decrypt_text(client_record.client_secret_ciphertext)
        if client_record and client_record.client_secret_ciphertext
        else None
    )
    try:
        token = await exchange_token(
            token_endpoint=flow.token_endpoint or "",
            client_id=flow.client_id,
            code=code,
            code_verifier=decrypt_text(flow.code_verifier_ciphertext),
            redirect_uri=flow.redirect_uri,
            resource=flow.resource or "",
            client_secret=client_secret,
            token_endpoint_auth_method=client_record.token_endpoint_auth_method
            if client_record
            else None,
        )
    except McpOAuthProviderError as exc:
        if should_drop_cached_oauth_client_on_token_error(exc.code) and client_record is not None:
            await oauth_client_store.delete_oauth_client(db, client_id=client_record.id)
        failed = (
            await oauth_flow_store.fail_oauth_flow(
                db,
                flow_id=flow.id,
                failure_code=exc.code,
            )
            or flow
        )
        return _callback_result(failed, ok=False, status="failed")
    await account_store.patch_account(
        db,
        account_id=account.account.id,
        status="ready",
        credential_ciphertext=encrypt_json(
            build_oauth_auth_payload(
                issuer=flow.issuer,
                resource=flow.resource,
                client_id=flow.client_id,
                access_token=token.access_token,
                refresh_token=token.refresh_token,
                expires_at=token.expires_at,
                scopes=token.scopes,
                token_endpoint=flow.token_endpoint,
                redirect_uri=flow.redirect_uri,
            )
        ),
        token_expires_at=token.expires_at,
        last_error_code=None,
    )
    await tool_cache_store.mark_tool_schema_cache_stale(db, account_id=account.account.id)
    completed = await oauth_flow_store.complete_oauth_flow(db, flow_id=flow.id) or flow
    return _callback_result(completed, ok=True, status="completed")


async def ensure_provider_access(
    db: AsyncSession,
    account: IntegrationAccountWithDefinitionRecord,
) -> ProviderAccess:
    config = parse_definition_config(account.definition.config_json)
    if account.account.auth_kind == "none":
        return ProviderAccess(headers={}, token_expires_at=None)
    if account.account.auth_kind == "api_key":
        mode = _require_auth_mode(config, "api_key")
        payload = _decrypt_account_payload(account.account)
        api_key = payload.get("apiKey")
        if not isinstance(api_key, str) or not api_key:
            raise CloudApiError(
                "integration_auth_required", "Integration API key is missing.", status_code=409
            )
        return ProviderAccess(headers=api_key_headers(mode, token=api_key), token_expires_at=None)
    if account.account.auth_kind != "oauth2":
        raise CloudApiError(
            "integration_auth_required", "Integration authentication is missing.", status_code=409
        )
    bundle = _decrypt_account_payload(account.account)
    access_token = bundle.get("accessToken")
    expires_at = _parse_optional_datetime(bundle.get("expiresAt"))
    if isinstance(access_token, str) and (
        expires_at is None or expires_at > datetime.now(UTC) + timedelta(minutes=5)
    ):
        return ProviderAccess(
            headers=oauth_headers(access_token=access_token), token_expires_at=expires_at
        )
    refresh_token_value = bundle.get("refreshToken")
    if not isinstance(refresh_token_value, str) or not refresh_token_value:
        await _mark_reauth_required(db, account.account.id, "refresh_token_missing")
        raise CloudApiError(
            "integration_reauth_required", "Integration must be reconnected.", status_code=409
        )
    client_record = await oauth_client_store.get_oauth_client(
        db,
        definition_id=account.definition.id,
        issuer=str(bundle.get("issuer") or ""),
        redirect_uri=str(bundle.get("redirectUri") or ""),
        resource=str(bundle.get("resource") or ""),
    )
    client_secret = (
        decrypt_text(client_record.client_secret_ciphertext)
        if client_record and client_record.client_secret_ciphertext
        else None
    )
    try:
        refreshed = await refresh_token(
            token_endpoint=str(bundle.get("tokenEndpoint") or ""),
            client_id=str(bundle.get("clientId") or ""),
            refresh_token_value=refresh_token_value,
            resource=str(bundle.get("resource") or ""),
            client_secret=client_secret,
            token_endpoint_auth_method=client_record.token_endpoint_auth_method
            if client_record
            else None,
        )
    except McpOAuthProviderError as exc:
        await _mark_reauth_required(db, account.account.id, exc.code)
        raise CloudApiError(
            "integration_reauth_required",
            "Integration must be reconnected.",
            status_code=409,
        ) from exc
    await account_store.patch_account(
        db,
        account_id=account.account.id,
        status="ready",
        credential_ciphertext=encrypt_json(
            build_oauth_auth_payload(
                issuer=bundle.get("issuer") if isinstance(bundle.get("issuer"), str) else None,
                resource=bundle.get("resource")
                if isinstance(bundle.get("resource"), str)
                else None,
                client_id=str(bundle.get("clientId") or ""),
                access_token=refreshed.access_token,
                refresh_token=refreshed.refresh_token or refresh_token_value,
                expires_at=refreshed.expires_at,
                scopes=refreshed.scopes,
                token_endpoint=bundle.get("tokenEndpoint")
                if isinstance(bundle.get("tokenEndpoint"), str)
                else None,
                redirect_uri=str(bundle.get("redirectUri") or ""),
            )
        ),
        token_expires_at=refreshed.expires_at,
        last_error_code=None,
    )
    return ProviderAccess(
        headers=oauth_headers(access_token=refreshed.access_token),
        token_expires_at=refreshed.expires_at,
    )


async def get_or_refresh_tool_cache(
    db: AsyncSession,
    account: IntegrationAccountWithDefinitionRecord,
) -> IntegrationToolSchemaCacheRecord:
    cache_key = tool_schema_cache_key(account=account.account, definition=account.definition)
    cached = await tool_cache_store.get_tool_schema_cache(
        db,
        account_id=account.account.id,
        cache_key=cache_key,
    )
    if cached is not None and cached.status == "ready":
        return cached
    access = await ensure_provider_access(db, account)
    config = parse_definition_config(account.definition.config_json)
    tools = await mcp_remote.list_tools(
        url=render_mcp_url(config, _json_object(account.account.settings_json)),
        headers=access.headers,
    )
    tools_json = json.dumps(
        [
            {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.input_schema,
            }
            for tool in tools
        ],
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return await tool_cache_store.upsert_tool_schema_cache(
        db,
        account_id=account.account.id,
        cache_key=cache_key,
        tools_json=tools_json,
        status="ready",
        last_error_code=None,
    )


async def list_integration_availability(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID | None,
) -> list[IntegrationAvailabilityItem]:
    definitions = await list_integration_definitions(db, organization_id=organization_id)
    accounts = await account_store.list_accounts_for_user(db, user_id)
    accounts_by_definition = {str(account.definition.id): account for account in accounts}
    result: list[IntegrationAvailabilityItem] = []
    for definition in definitions:
        account = accounts_by_definition.get(definition.id)
        tool_count: int | None = None
        if account is not None and account.account.status == "ready":
            cache_key = tool_schema_cache_key(
                account=account.account,
                definition=account.definition,
            )
            cache = await tool_cache_store.get_tool_schema_cache(
                db,
                account_id=account.account.id,
                cache_key=cache_key,
            )
            tool_count = (
                len(_tools_from_cache(cache)) if cache and cache.status == "ready" else None
            )
        result.append(
            IntegrationAvailabilityItem(
                definitionId=definition.id,
                accountId=str(account.account.id) if account else None,
                namespace=definition.namespace,
                displayName=definition.display_name,
                iconId=definition.icon_id,
                status=account.account.status if account else "setup_required",
                authModes=[mode.kind for mode in definition.auth_modes],
                selectedAuthKind=account.account.auth_kind if account else None,
                toolCount=tool_count,
                reconnectUrl=None,
                lastErrorCode=account.account.last_error_code if account else None,
            )
        )
    return result


async def list_integration_tool_metadata(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[IntegrationToolMetadata]:
    accounts = await account_store.list_ready_accounts_for_personal_profile(db, user_id)
    result: list[IntegrationToolMetadata] = []
    for account in accounts:
        cache = await get_or_refresh_tool_cache(db, account)
        config = parse_definition_config(account.definition.config_json)
        tools = _tools_from_cache(cache)
        result.append(
            IntegrationToolMetadata(
                namespace=account.definition.namespace,
                displayName=account.definition.display_name,
                iconId=config.get("iconId") if isinstance(config.get("iconId"), str) else None,
                tools=[
                    IntegrationToolMetadataTool(
                        gatewayToolName=gateway_tool_name(
                            account.definition.namespace, tool["name"]
                        ),
                        upstreamToolName=tool["name"],
                        displayName=str(tool.get("description") or tool["name"]),
                    )
                    for tool in tools
                    if isinstance(tool.get("name"), str)
                ],
            )
        )
    return result


def client_metadata_document(*, definition_id: UUID) -> dict[str, object]:
    metadata_url = _client_metadata_document_url(definition_id)
    return {
        "client_name": "Proliferate",
        "application_type": "web",
        "redirect_uris": [_redirect_uri()],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "client_uri": metadata_url,
    }


async def _get_oauth_client(
    db: AsyncSession,
    *,
    definition: IntegrationDefinitionRecord,
    mode: IntegrationAuthMode,
    issuer: str,
    redirect_uri: str,
    resource: str,
    authorization_metadata: AuthorizationServerMetadata,
) -> IntegrationOAuthClientRecord:
    cached = await oauth_client_store.get_oauth_client(
        db,
        definition_id=definition.id,
        issuer=issuer,
        redirect_uri=redirect_uri,
        resource=resource,
    )
    if cached is not None and cached.client_strategy == mode.client_strategy:
        return cached
    if mode.client_strategy == "static":
        config = static_oauth_client_config(mode)
        return await oauth_client_store.upsert_oauth_client(
            db,
            definition_id=definition.id,
            issuer=issuer,
            redirect_uri=redirect_uri,
            resource=resource,
            client_strategy="static",
            client_id=config.client_id,
            client_secret_ciphertext=encrypt_text(config.client_secret)
            if config.client_secret
            else None,
            registration_metadata_json="{}",
            token_endpoint_auth_method=config.token_endpoint_auth_method,
        )
    if mode.client_strategy == "client_metadata_document":
        client_id = _client_metadata_document_url(definition.id)
        return await oauth_client_store.upsert_oauth_client(
            db,
            definition_id=definition.id,
            issuer=issuer,
            redirect_uri=redirect_uri,
            resource=resource,
            client_strategy="client_metadata_document",
            client_id=client_id,
            client_secret_ciphertext=None,
            registration_metadata_json=json.dumps(
                client_metadata_document(definition_id=definition.id)
            ),
            token_endpoint_auth_method="none",
        )
    registered = await register_client(authorization_metadata, redirect_uri)
    return await oauth_client_store.upsert_oauth_client(
        db,
        definition_id=definition.id,
        issuer=issuer,
        redirect_uri=redirect_uri,
        resource=resource,
        client_strategy="dcr",
        client_id=registered.client_id,
        client_secret_ciphertext=encrypt_text(registered.client_secret)
        if registered.client_secret
        else None,
        registration_metadata_json=json.dumps(
            {
                "registrationClientUri": registered.registration_client_uri,
                "registrationAccessTokenPresent": registered.registration_access_token is not None,
                "clientSecretExpiresAt": (
                    registered.client_secret_expires_at.isoformat()
                    if registered.client_secret_expires_at
                    else None
                ),
            }
        ),
        token_endpoint_auth_method=registered.token_endpoint_auth_method,
    )


def _definition_response(record: IntegrationDefinitionRecord) -> IntegrationDefinitionResponse:
    config = parse_definition_config(record.config_json)
    settings_payload = config.get("settings")
    return IntegrationDefinitionResponse(
        id=str(record.id),
        key=record.key,
        source=record.source,
        organizationId=str(record.organization_id) if record.organization_id else None,
        displayName=record.display_name,
        namespace=record.namespace,
        providerGroup=record.provider_group,
        transport=record.transport,
        implementation=record.implementation,
        enabledByDefault=record.enabled_by_default,
        authModes=[
            IntegrationAuthModeModel(
                kind=mode.kind,
                clientStrategy=mode.client_strategy,
                label=mode.label,
            )
            for mode in auth_modes_from_config(config)
        ],
        settings=[
            IntegrationSettingModel(
                id=str(setting["id"]),
                label=str(setting["label"]),
                default=str(setting["default"]),
                options=[
                    IntegrationSettingOptionModel(
                        value=str(option["value"]),
                        label=str(option["label"]),
                    )
                    for option in setting.get("options", [])
                    if isinstance(option, dict)
                    and isinstance(option.get("value"), str)
                    and isinstance(option.get("label"), str)
                ],
            )
            for setting in (settings_payload if isinstance(settings_payload, list) else [])
            if isinstance(setting, dict)
            and isinstance(setting.get("id"), str)
            and isinstance(setting.get("label"), str)
            and isinstance(setting.get("default"), str)
        ],
        flags=config.get("flags") if isinstance(config.get("flags"), dict) else {},
        iconId=config.get("iconId") if isinstance(config.get("iconId"), str) else None,
        toolSurfaceKind=str(config.get("toolSurfaceKind") or "standard"),
        archivedAt=record.archived_at,
    )


def _account_response(
    record: IntegrationAccountWithDefinitionRecord,
) -> IntegrationAccountResponse:
    return IntegrationAccountResponse(
        id=str(record.account.id),
        definitionId=str(record.definition.id),
        ownerScope=record.account.owner_scope,
        ownerUserId=str(record.account.owner_user_id) if record.account.owner_user_id else None,
        organizationId=str(record.account.organization_id)
        if record.account.organization_id
        else None,
        authKind=record.account.auth_kind,
        status=record.account.status,
        settings=_json_object(record.account.settings_json),
        authVersion=record.account.auth_version,
        tokenExpiresAt=record.account.token_expires_at,
        lastErrorCode=record.account.last_error_code,
        enabled=record.account.enabled,
        definition=_definition_response(record.definition),
    )


async def _load_definition(db: AsyncSession, definition_id: UUID) -> IntegrationDefinitionRecord:
    definition = await definition_store.get_definition(db, definition_id)
    if definition is None or definition.archived_at is not None:
        raise CloudApiError(
            "integration_definition_not_found",
            "Integration definition not found.",
            status_code=404,
        )
    return definition


async def _load_account_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    account_id: UUID,
) -> IntegrationAccountWithDefinitionRecord:
    account = await account_store.get_account_with_definition(db, account_id)
    if account is None or account.account.owner_user_id != user_id:
        raise CloudApiError(
            "integration_account_not_found", "Integration account not found.", status_code=404
        )
    return account


async def _require_organization_admin(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )
    if membership is None:
        raise CloudApiError("organization_not_found", "Organization not found.", status_code=404)
    if membership.role not in {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}:
        raise CloudApiError(
            "organization_permission_denied",
            "You do not have permission to manage integrations for this organization.",
            status_code=403,
        )


def _client_metadata_document_url(definition_id: UUID) -> str:
    base = settings.api_base_url.rstrip("/")
    return f"{base}/v1/cloud/integrations/definitions/{definition_id}/client-metadata"


def _require_auth_mode(config: dict[str, object], auth_kind: str) -> IntegrationAuthMode:
    for mode in auth_modes_from_config(config):
        if mode.kind == auth_kind:
            return mode
    raise CloudApiError(
        "integration_auth_unsupported",
        "This integration does not support the requested auth kind.",
        status_code=409,
    )


def _settings_json(config: dict[str, object], payload: dict[str, object] | None) -> str:
    values = {
        key: value
        for key, value in _json_object(json.dumps(payload or {})).items()
        if isinstance(value, str | int | float | bool)
    }
    defaults = {}
    settings_payload = config.get("settings")
    if isinstance(settings_payload, list):
        for setting in settings_payload:
            if isinstance(setting, dict) and isinstance(setting.get("id"), str):
                default = setting.get("default")
                if isinstance(default, str):
                    defaults[str(setting["id"])] = default
    return json.dumps(
        {**defaults, **values}, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    )


def _json_object(value: str) -> dict[str, object]:
    try:
        parsed = json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _decrypt_account_payload(account: IntegrationAccountRecord) -> dict[str, object]:
    if not account.credential_ciphertext:
        return {}
    payload = decrypt_json(account.credential_ciphertext)
    return payload if isinstance(payload, dict) else {}


def _parse_optional_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


async def _mark_reauth_required(db: AsyncSession, account_id: UUID, code: str) -> None:
    await account_store.patch_account(
        db,
        account_id=account_id,
        status="reauth_required",
        last_error_code=code,
        bump_auth_version=True,
    )
    await tool_cache_store.mark_tool_schema_cache_stale(db, account_id=account_id)


def _oauth_return_target_or_raise(
    *,
    callback_surface: str | None,
    final_surface: str | None,
    return_path: str | None,
) -> OAuthReturnTarget:
    try:
        return normalize_oauth_return_target(
            callback_surface=callback_surface,
            final_surface=final_surface,
            return_path=return_path,
            frontend_base_url=settings.frontend_base_url,
        )
    except OAuthReturnTargetError as exc:
        raise CloudApiError("invalid_payload", str(exc), status_code=400) from exc


def _redirect_uri() -> str:
    base = (
        settings.cloud_mcp_oauth_callback_base_url.strip()
        or settings.api_base_url.strip()
        or settings.cloud_mcp_oauth_callback_fallback_base_url.strip()
    ).rstrip("/")
    return f"{base}{_INTEGRATION_OAUTH_CALLBACK_PATH}"


def _callback_result(
    flow: IntegrationOAuthFlowRecord | None,
    *,
    ok: bool,
    status: str,
    failure_code: str | None = None,
) -> IntegrationOAuthCallbackResult:
    return IntegrationOAuthCallbackResult(
        ok=ok,
        status=status,
        flow_id=flow.id if flow else None,
        failure_code=failure_code or (flow.failure_code if flow else None),
        callback_surface=flow.callback_surface if flow else "desktop",
        final_surface=flow.final_surface if flow else "desktop",
        return_path=flow.return_path if flow else None,
    )


def _tools_from_cache(cache: IntegrationToolSchemaCacheRecord | None) -> list[dict[str, object]]:
    if cache is None:
        return []
    try:
        parsed = json.loads(cache.tools_json or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [tool for tool in parsed if isinstance(tool, dict)]
