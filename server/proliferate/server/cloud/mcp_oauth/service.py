from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud_mcp import CLOUD_MCP_OAUTH_FLOW_TTL
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.analytics import (
    CloudMcpConnectionEventInsert,
    record_cloud_mcp_connection_event,
)
from proliferate.db.store.cloud_mcp.auth import upsert_connection_auth
from proliferate.db.store.cloud_mcp.connections import (
    get_user_connection_by_db_id,
)
from proliferate.db.store.cloud_mcp.oauth_clients import (
    delete_oauth_client,
    get_oauth_client,
    upsert_oauth_client,
)
from proliferate.db.store.cloud_mcp.oauth_flows import (
    cancel_oauth_flow_for_user,
    claim_active_oauth_flow_by_state_hash,
    complete_oauth_flow,
    create_oauth_flow_canceling_existing,
    fail_oauth_flow,
    get_oauth_flow_for_user,
)
from proliferate.db.store.cloud_mcp.types import (
    CloudMcpConnectionRecord,
    CloudMcpOAuthClientRecord,
    CloudMcpOAuthFlowRecord,
)
from proliferate.integrations.mcp_oauth import (
    McpOAuthProviderError,
    build_authorization_url,
    discover_authorization_server_metadata,
    discover_protected_resource_metadata,
    exchange_token,
    normalize_resource_url,
    random_urlsafe,
    register_client,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import get_catalog_entry
from proliferate.server.cloud.mcp_catalog.domain.rendering import (
    parse_settings,
    render_oauth_resource_url,
    validate_settings,
)
from proliferate.server.cloud.mcp_catalog.domain.types import (
    CatalogConfigurationError,
    CatalogEntry,
)
from proliferate.server.cloud.mcp_oauth.domain.flow_rules import (
    build_oauth_auth_payload,
    oauth_flow_is_expired,
    oauth_redirect_uri,
    oauth_requested_scopes_json,
    oauth_state_hash,
    oauth_status_includes_authorization_url,
    should_drop_cached_oauth_client_on_token_error,
)
from proliferate.server.cloud.mcp_oauth.domain.static_client_rules import (
    cached_static_client_matches,
)
from proliferate.server.cloud.mcp_oauth.static_clients import (
    get_static_oauth_client_config,
)
from proliferate.utils.crypto import decrypt_text, encrypt_json, encrypt_text


@dataclass(frozen=True)
class CloudMcpOAuthFlowStatus:
    flow: CloudMcpOAuthFlowRecord
    include_authorization_url: bool


@dataclass(frozen=True)
class CloudMcpOAuthCallbackResult:
    ok: bool
    status: str


def _cloud_mcp_enabled_or_raise() -> None:
    if not settings.cloud_mcp_enabled:
        raise CloudApiError("cloud_mcp_disabled", "Cloud MCP is disabled.", status_code=403)


def _redirect_uri() -> str:
    return oauth_redirect_uri(
        configured_callback_base_url=settings.cloud_mcp_oauth_callback_base_url,
        api_base_url=settings.api_base_url,
        fallback_callback_base_url=settings.cloud_mcp_oauth_callback_fallback_base_url,
    )


async def _get_or_register_dcr_client(
    db: AsyncSession,
    *,
    issuer: str,
    redirect_uri: str,
    catalog_entry_id: str,
    resource: str,
) -> CloudMcpOAuthClientRecord:
    cached = await get_oauth_client(
        db,
        issuer=issuer,
        redirect_uri=redirect_uri,
        catalog_entry_id=catalog_entry_id,
    )
    if cached is not None:
        return cached

    metadata = await discover_authorization_server_metadata(issuer)
    registered = await register_client(metadata, redirect_uri)
    return await upsert_oauth_client(
        db,
        issuer=issuer,
        redirect_uri=redirect_uri,
        catalog_entry_id=catalog_entry_id,
        resource=resource,
        client_id=registered.client_id,
        client_secret_ciphertext=(
            encrypt_text(registered.client_secret) if registered.client_secret else None
        ),
        client_secret_expires_at=registered.client_secret_expires_at,
        token_endpoint_auth_method=registered.token_endpoint_auth_method,
        registration_client_uri=registered.registration_client_uri,
        registration_access_token_ciphertext=(
            encrypt_text(registered.registration_access_token)
            if registered.registration_access_token
            else None
        ),
    )


async def _get_static_client(
    db: AsyncSession,
    *,
    entry: CatalogEntry,
    issuer: str,
    redirect_uri: str,
    resource: str,
) -> CloudMcpOAuthClientRecord:
    config = get_static_oauth_client_config(entry.id)
    if config is None:
        raise McpOAuthProviderError(
            "missing_static_oauth_client",
            "This deployment is missing static OAuth client configuration.",
        )
    cached = await get_oauth_client(
        db,
        issuer=issuer,
        redirect_uri=redirect_uri,
        catalog_entry_id=entry.id,
    )
    if cached is not None:
        cached_secret = (
            decrypt_text(cached.client_secret_ciphertext)
            if cached.client_secret_ciphertext
            else None
        )
        if cached_static_client_matches(
            cached_resource=cached.resource,
            cached_client_id=cached.client_id,
            cached_client_secret=cached_secret,
            cached_token_endpoint_auth_method=cached.token_endpoint_auth_method,
            cached_registration_client_uri=cached.registration_client_uri,
            cached_registration_access_token_ciphertext=(
                cached.registration_access_token_ciphertext
            ),
            configured_resource=resource,
            configured_client_id=config.client_id,
            configured_client_secret=config.client_secret,
            configured_token_endpoint_auth_method=config.token_endpoint_auth_method,
        ):
            return cached
    return await upsert_oauth_client(
        db,
        issuer=issuer,
        redirect_uri=redirect_uri,
        catalog_entry_id=entry.id,
        resource=resource,
        client_id=config.client_id,
        client_secret_ciphertext=(
            encrypt_text(config.client_secret) if config.client_secret else None
        ),
        client_secret_expires_at=None,
        token_endpoint_auth_method=config.token_endpoint_auth_method,
        registration_client_uri=None,
        registration_access_token_ciphertext=None,
    )


async def _get_oauth_client(
    db: AsyncSession,
    *,
    entry: CatalogEntry,
    issuer: str,
    redirect_uri: str,
    resource: str,
) -> CloudMcpOAuthClientRecord:
    if entry.oauth_client_mode == "static":
        return await _get_static_client(
            db,
            entry=entry,
            issuer=issuer,
            redirect_uri=redirect_uri,
            resource=resource,
        )
    return await _get_or_register_dcr_client(
        db,
        issuer=issuer,
        redirect_uri=redirect_uri,
        catalog_entry_id=entry.id,
        resource=resource,
    )


async def start_cloud_mcp_oauth_flow(
    db: AsyncSession,
    *,
    connection: CloudMcpConnectionRecord,
) -> CloudMcpOAuthFlowRecord:
    _cloud_mcp_enabled_or_raise()
    entry = get_catalog_entry(connection.catalog_entry_id)
    if entry is None or entry.auth_kind != "oauth":
        raise CloudApiError(
            "invalid_payload",
            "MCP connection does not use OAuth.",
            status_code=400,
        )
    if not catalog_entry_is_configured(entry):
        raise CloudApiError(
            "invalid_payload",
            "MCP connector is not configured for this deployment.",
            status_code=400,
        )
    try:
        server_url = render_oauth_resource_url(
            entry,
            validate_settings(entry, parse_settings(connection.settings_json)),
        )
    except CatalogConfigurationError as exc:
        raise CloudApiError(
            "invalid_payload",
            str(exc),
            status_code=400,
        ) from exc
    try:
        protected = await discover_protected_resource_metadata(server_url)
        issuer = protected.authorization_servers[0]
        auth_metadata = await discover_authorization_server_metadata(issuer)
        resource = normalize_resource_url(protected.resource or server_url)
        redirect_uri = _redirect_uri()
        client = await _get_oauth_client(
            db,
            entry=entry,
            issuer=auth_metadata.issuer,
            redirect_uri=redirect_uri,
            resource=resource,
        )
        state = random_urlsafe(32)
        verifier = random_urlsafe(48)
        authorization_url = build_authorization_url(
            metadata=auth_metadata,
            client_id=client.client_id,
            redirect_uri=redirect_uri,
            state=state,
            verifier=verifier,
            resource=resource,
            scope=protected.challenged_scope,
        )
    except McpOAuthProviderError as exc:
        raise CloudApiError(
            exc.code,
            "Could not start OAuth for this connector.",
            status_code=400,
        ) from exc

    flow = await create_oauth_flow_canceling_existing(
        db,
        connection_db_id=connection.id,
        user_id=connection.user_id,
        state_hash=oauth_state_hash(state),
        code_verifier_ciphertext=encrypt_text(verifier),
        issuer=auth_metadata.issuer,
        resource=resource,
        client_id=client.client_id,
        token_endpoint=auth_metadata.token_endpoint,
        requested_scopes=oauth_requested_scopes_json(protected.challenged_scope),
        redirect_uri=redirect_uri,
        authorization_url=authorization_url,
        expires_at=datetime.now(UTC) + CLOUD_MCP_OAUTH_FLOW_TTL,
    )
    return flow


async def get_cloud_mcp_oauth_flow_status(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> CloudMcpOAuthFlowStatus:
    flow = await get_oauth_flow_for_user(db, user_id=user_id, flow_id=flow_id)
    if flow is None:
        raise CloudApiError("not_found", "OAuth flow was not found.", status_code=404)
    status = flow
    if flow.status == "active" and oauth_flow_is_expired(
        expires_at=flow.expires_at,
        now=datetime.now(UTC),
    ):
        status = await fail_oauth_flow(db, flow_id=flow.id, failure_code="expired") or flow
        connection = await get_user_connection_by_db_id(db, flow.user_id, flow.connection_db_id)
        if connection is not None:
            await _record_oauth_connection_event(
                db,
                connection,
                event_type="auth_failed",
                failure_code="expired",
            )
    return CloudMcpOAuthFlowStatus(
        flow=status,
        include_authorization_url=oauth_status_includes_authorization_url(status.status),
    )


async def cancel_cloud_mcp_oauth_flow(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> CloudMcpOAuthFlowStatus:
    flow = await cancel_oauth_flow_for_user(db, user_id=user_id, flow_id=flow_id)
    if flow is None:
        raise CloudApiError("not_found", "OAuth flow was not found.", status_code=404)
    return CloudMcpOAuthFlowStatus(flow=flow, include_authorization_url=False)


async def complete_cloud_mcp_oauth_callback(
    db: AsyncSession,
    *,
    state: str,
    code: str,
) -> CloudMcpOAuthCallbackResult:
    _cloud_mcp_enabled_or_raise()
    hashed = oauth_state_hash(state)
    flow = await claim_active_oauth_flow_by_state_hash(db, hashed)
    if flow is None:
        return CloudMcpOAuthCallbackResult(ok=False, status="failed")
    connection = await get_user_connection_by_db_id(db, flow.user_id, flow.connection_db_id)
    if oauth_flow_is_expired(expires_at=flow.expires_at, now=datetime.now(UTC)):
        await fail_oauth_flow(db, flow_id=flow.id, failure_code="expired")
        if connection is not None:
            await _record_oauth_connection_event(
                db,
                connection,
                event_type="auth_failed",
                failure_code="expired",
            )
        return CloudMcpOAuthCallbackResult(ok=False, status="expired")
    if not flow.token_endpoint or not flow.resource:
        await fail_oauth_flow(db, flow_id=flow.id, failure_code="invalid_flow")
        if connection is not None:
            await _record_oauth_connection_event(
                db,
                connection,
                event_type="auth_failed",
                failure_code="invalid_flow",
            )
        return CloudMcpOAuthCallbackResult(ok=False, status="failed")
    if connection is None:
        await fail_oauth_flow(db, flow_id=flow.id, failure_code="invalid_flow")
        return CloudMcpOAuthCallbackResult(ok=False, status="failed")
    oauth_client = await get_oauth_client(
        db,
        issuer=flow.issuer or "",
        redirect_uri=flow.redirect_uri,
        catalog_entry_id=connection.catalog_entry_id,
    )
    client_secret = (
        decrypt_text(oauth_client.client_secret_ciphertext)
        if oauth_client and oauth_client.client_secret_ciphertext
        else None
    )

    try:
        token = await exchange_token(
            token_endpoint=flow.token_endpoint,
            client_id=flow.client_id,
            code=code,
            code_verifier=decrypt_text(flow.code_verifier_ciphertext),
            redirect_uri=flow.redirect_uri,
            resource=flow.resource,
            client_secret=client_secret,
            token_endpoint_auth_method=(
                oauth_client.token_endpoint_auth_method if oauth_client else None
            ),
        )
    except McpOAuthProviderError as exc:
        if should_drop_cached_oauth_client_on_token_error(exc.code) and flow.issuer:
            await delete_oauth_client(
                db,
                issuer=flow.issuer,
                redirect_uri=flow.redirect_uri,
                catalog_entry_id=connection.catalog_entry_id if connection else "",
            )
        await fail_oauth_flow(db, flow_id=flow.id, failure_code=exc.code)
        await _record_oauth_connection_event(
            db,
            connection,
            event_type="auth_failed",
            failure_code=exc.code,
        )
        return CloudMcpOAuthCallbackResult(ok=False, status="failed")

    was_ready = connection.auth is not None and connection.auth.auth_status == "ready"
    await upsert_connection_auth(
        db,
        connection_db_id=flow.connection_db_id,
        auth_kind="oauth",
        auth_status="ready",
        payload_ciphertext=encrypt_json(
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
        payload_format="oauth-bundle-v1",
        token_expires_at=token.expires_at,
    )
    await complete_oauth_flow(db, flow_id=flow.id)
    await _record_oauth_connection_event(
        db,
        connection,
        event_type="reconnected" if was_ready else "auth_ready",
        auth_status="ready",
    )
    from proliferate.server.cloud.runtime_config.service import (  # noqa: PLC0415
        refresh_profile_runtime_config,
    )

    profile = await sandbox_profile_store.ensure_personal_sandbox_profile(
        db,
        user_id=connection.user_id,
        created_by_user_id=connection.user_id,
    )
    await refresh_profile_runtime_config(
        db,
        sandbox_profile_id=profile.id,
        actor_user_id=connection.user_id,
        reason="mcp_oauth_completed",
    )
    if connection.public_organization_id is not None:
        org_profile = await sandbox_profile_store.ensure_organization_sandbox_profile(
            db,
            organization_id=connection.public_organization_id,
            created_by_user_id=connection.user_id,
        )
        await refresh_profile_runtime_config(
            db,
            sandbox_profile_id=org_profile.id,
            actor_user_id=connection.user_id,
            reason="mcp_oauth_completed",
        )
    return CloudMcpOAuthCallbackResult(ok=True, status="completed")


async def _record_oauth_connection_event(
    db: AsyncSession,
    connection: CloudMcpConnectionRecord,
    *,
    event_type: str,
    auth_status: str | None = None,
    failure_code: str | None = None,
) -> None:
    await record_cloud_mcp_connection_event(
        db,
        CloudMcpConnectionEventInsert(
            user_id=connection.user_id,
            org_id=connection.org_id,
            connection_id=connection.connection_id,
            catalog_entry_id=connection.catalog_entry_id,
            event_type=event_type,
            auth_kind="oauth",
            auth_status=auth_status
            or (connection.auth.auth_status if connection.auth is not None else None),
            enabled=connection.enabled,
            failure_code=failure_code,
        ),
    )
