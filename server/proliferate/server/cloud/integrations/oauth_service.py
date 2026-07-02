"""OAuth authorization-flow lifecycle for cloud integrations.

Ported from the old ``server/cloud/mcp_oauth/service.py`` (commit ``4b54c9f2b``)
and adapted onto the new integration stores/models:

- flows/clients/accounts live in ``proliferate.db.store.integrations``
- discovery/DCR/token machinery lives in
  ``proliferate.integrations.integration_oauth``
- launch URL comes from the definition's ``config_json`` via
  ``render_mcp_url`` (no MCP catalog).

There is no runtime-config refresh here — that subsystem is gone.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings as app_settings
from proliferate.db.store.integrations.accounts import set_account_credentials
from proliferate.db.store.integrations.definitions import IntegrationDefinitionRecord
from proliferate.db.store.integrations.oauth_clients import (
    IntegrationOAuthClientRecord,
    delete_oauth_client,
    get_oauth_client,
    upsert_oauth_client,
)
from proliferate.db.store.integrations.oauth_flows import (
    IntegrationOAuthFlowRecord,
    cancel_oauth_flow_for_user,
    claim_active_oauth_flow_by_state_hash,
    complete_oauth_flow,
    create_oauth_flow_canceling_existing,
    expire_oauth_flow,
    fail_oauth_flow,
    get_oauth_flow_by_state_hash,
    get_oauth_flow_for_user,
)
from proliferate.integrations.integration_oauth import (
    IntegrationOAuthProviderError,
    build_authorization_url,
    discover_authorization_server_metadata,
    discover_protected_resource_metadata,
    exchange_token,
    normalize_resource_url,
    random_urlsafe,
    register_client,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.config import parse_definition_config, render_mcp_url
from proliferate.utils.crypto import decrypt_text, encrypt_json, encrypt_text

# Callback path appended to the API base URL for the shared OAuth callback.
OAUTH_CALLBACK_PATH = "/v1/cloud/integrations/oauth/callback"
# How long an in-flight authorization stays valid before it expires.
OAUTH_FLOW_TTL = timedelta(minutes=10)

OAUTH_CALLBACK_SURFACES = {"desktop", "web"}
OAUTH_FINAL_SURFACES = {"desktop", "web"}
OAUTH_WEB_COMPLETION_PATH = "/plugins/connect/complete"
# Static-client auth methods this deployment can drive.
SUPPORTED_STATIC_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS = {
    "none",
    "client_secret_post",
    "client_secret_basic",
}


# --------------------------------------------------------------------------- #
# Result shapes
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class OAuthFlowStart:
    flow_id: UUID
    authorization_url: str
    status: str
    expires_at: datetime


@dataclass(frozen=True)
class OAuthFlowStatus:
    flow: IntegrationOAuthFlowRecord
    include_authorization_url: bool


@dataclass(frozen=True)
class OAuthCallbackResult:
    ok: bool
    status: str
    flow_id: UUID | None
    failure_code: str | None
    callback_surface: str
    final_surface: str
    return_path: str | None


@dataclass(frozen=True)
class _ReturnTarget:
    callback_surface: str
    final_surface: str
    return_path: str | None


@dataclass(frozen=True)
class _StaticOAuthClientConfig:
    client_id: str
    client_secret: str | None
    token_endpoint_auth_method: str


# --------------------------------------------------------------------------- #
# Small domain helpers (ported from the old flow_rules / static_clients)
# --------------------------------------------------------------------------- #


def _state_hash(state: str) -> str:
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def _redirect_uri() -> str:
    base = app_settings.api_base_url.strip().rstrip("/")
    return f"{base}{OAUTH_CALLBACK_PATH}"


def _oauth_flow_is_expired(*, expires_at: datetime, now: datetime) -> bool:
    return expires_at <= now


def _status_includes_authorization_url(status: str) -> bool:
    return status == "active"


def _requested_scopes_json(challenged_scope: str | None) -> str:
    return json.dumps(challenged_scope.split() if challenged_scope else [])


def _should_drop_cached_oauth_client_on_token_error(error_code: str) -> bool:
    return error_code == "invalid_client"


def _validate_frontend_base_url(frontend_base_url: str) -> str:
    base = frontend_base_url.strip().rstrip("/")
    parts = urlsplit(base)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise CloudApiError(
            "invalid_payload", "Frontend base URL is not configured correctly.", status_code=400
        )
    return base


def _normalize_return_path(return_path: str | None) -> str | None:
    if return_path is None:
        return None
    path = return_path.strip()
    if not path:
        return None
    if path != OAUTH_WEB_COMPLETION_PATH:
        raise CloudApiError(
            "invalid_payload", "OAuth return path is not allowed.", status_code=400
        )
    return path


def _normalize_return_target(
    *,
    callback_surface: str | None,
    final_surface: str | None,
    return_path: str | None,
) -> _ReturnTarget:
    resolved_callback_surface = (callback_surface or "desktop").strip()
    if resolved_callback_surface not in OAUTH_CALLBACK_SURFACES:
        raise CloudApiError(
            "invalid_payload", "Unsupported OAuth callback surface.", status_code=400
        )

    resolved_final_surface = (final_surface or resolved_callback_surface).strip()
    if resolved_final_surface not in OAUTH_FINAL_SURFACES:
        raise CloudApiError("invalid_payload", "Unsupported OAuth final surface.", status_code=400)

    normalized_return_path = _normalize_return_path(return_path)
    if resolved_callback_surface == "desktop":
        if resolved_final_surface != "desktop":
            raise CloudApiError(
                "invalid_payload", "Desktop callback must return to desktop.", status_code=400
            )
        if normalized_return_path is not None:
            raise CloudApiError(
                "invalid_payload",
                "Desktop callback does not accept a return path.",
                status_code=400,
            )
    else:
        if not app_settings.frontend_base_url.strip():
            raise CloudApiError(
                "invalid_payload",
                "Web OAuth callback requires a frontend base URL.",
                status_code=400,
            )
        _validate_frontend_base_url(app_settings.frontend_base_url)
        if normalized_return_path != OAUTH_WEB_COMPLETION_PATH:
            raise CloudApiError(
                "invalid_payload",
                "Web OAuth callback requires the plugin completion path.",
                status_code=400,
            )

    return _ReturnTarget(
        callback_surface=resolved_callback_surface,
        final_surface=resolved_final_surface,
        return_path=normalized_return_path,
    )


def _build_oauth_bundle(
    *,
    issuer: str | None,
    resource: str | None,
    client_id: str,
    access_token: str,
    refresh_token: str | None,
    expires_at: datetime | None,
    scopes: tuple[str, ...],
    token_endpoint: str | None,
    redirect_uri: str,
) -> dict[str, Any]:
    return {
        "issuer": issuer,
        "resource": resource,
        "clientId": client_id,
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresAt": expires_at.isoformat() if expires_at else None,
        "scopes": list(scopes),
        "tokenEndpoint": token_endpoint,
        "redirectUri": redirect_uri,
    }


def _static_oauth_client_config(namespace: str) -> _StaticOAuthClientConfig | None:
    if namespace != "slack":
        return None
    if not app_settings.cloud_mcp_slack_enabled:
        return None
    client_id = app_settings.cloud_mcp_slack_client_id.strip()
    if not client_id:
        return None
    auth_method = app_settings.cloud_mcp_slack_token_endpoint_auth_method.strip()
    if auth_method not in SUPPORTED_STATIC_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS:
        return None
    client_secret = app_settings.cloud_mcp_slack_client_secret.strip() or None
    if not client_secret:
        return None
    return _StaticOAuthClientConfig(
        client_id=client_id,
        client_secret=client_secret,
        token_endpoint_auth_method=auth_method,
    )


# --------------------------------------------------------------------------- #
# OAuth client resolution (DCR vs static)
# --------------------------------------------------------------------------- #


async def _get_or_register_dcr_client(
    db: AsyncSession,
    *,
    definition_id: UUID,
    issuer: str,
    redirect_uri: str,
    resource: str,
) -> IntegrationOAuthClientRecord:
    cached = await get_oauth_client(
        db,
        issuer=issuer,
        redirect_uri=redirect_uri,
        definition_id=definition_id,
    )
    if cached is not None:
        return cached

    metadata = await discover_authorization_server_metadata(issuer)
    registered = await register_client(metadata, redirect_uri)
    return await upsert_oauth_client(
        db,
        definition_id=definition_id,
        issuer=issuer,
        redirect_uri=redirect_uri,
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
    definition: IntegrationDefinitionRecord,
    issuer: str,
    redirect_uri: str,
    resource: str,
) -> IntegrationOAuthClientRecord:
    config = _static_oauth_client_config(definition.namespace)
    if config is None:
        raise IntegrationOAuthProviderError(
            "missing_static_oauth_client",
            "This deployment is missing static OAuth client configuration.",
        )
    cached = await get_oauth_client(
        db,
        issuer=issuer,
        redirect_uri=redirect_uri,
        definition_id=definition.id,
    )
    if cached is not None:
        cached_secret = (
            decrypt_text(cached.client_secret_ciphertext)
            if cached.client_secret_ciphertext
            else None
        )
        if (
            cached.resource == resource
            and cached.client_id == config.client_id
            and cached_secret == config.client_secret
            and cached.token_endpoint_auth_method == config.token_endpoint_auth_method
            and cached.registration_client_uri is None
            and cached.registration_access_token_ciphertext is None
        ):
            return cached
    return await upsert_oauth_client(
        db,
        definition_id=definition.id,
        issuer=issuer,
        redirect_uri=redirect_uri,
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
    definition: IntegrationDefinitionRecord,
    issuer: str,
    redirect_uri: str,
    resource: str,
) -> IntegrationOAuthClientRecord:
    if definition.oauth_client_mode == "static":
        return await _get_static_client(
            db,
            definition=definition,
            issuer=issuer,
            redirect_uri=redirect_uri,
            resource=resource,
        )
    return await _get_or_register_dcr_client(
        db,
        definition_id=definition.id,
        issuer=issuer,
        redirect_uri=redirect_uri,
        resource=resource,
    )


# --------------------------------------------------------------------------- #
# Public flow lifecycle
# --------------------------------------------------------------------------- #


async def start_oauth_flow(
    db: AsyncSession,
    *,
    user_id: UUID,
    definition: IntegrationDefinitionRecord,
    account_id: UUID | None,
    settings: dict[str, Any],
    callback_surface: str | None = None,
    final_surface: str | None = None,
    return_path: str | None = None,
) -> OAuthFlowStart:
    """Begin an OAuth authorization flow for ``definition``.

    Discovers the provider, resolves (or registers) an OAuth client, mints a
    PKCE state/verifier pair, persists the flow (canceling any prior active
    flow for this user+definition), and returns the authorization URL.
    """
    if definition.auth_kind != "oauth2":
        raise CloudApiError("invalid_payload", "Integration does not use OAuth.", status_code=400)
    return_target = _normalize_return_target(
        callback_surface=callback_surface,
        final_surface=final_surface,
        return_path=return_path,
    )
    try:
        config = parse_definition_config(definition.config_json)
        server_url = render_mcp_url(config, settings)
    except ValueError as exc:
        raise CloudApiError("invalid_payload", str(exc), status_code=400) from exc

    try:
        protected = await discover_protected_resource_metadata(server_url)
        issuer = protected.authorization_servers[0]
        auth_metadata = await discover_authorization_server_metadata(issuer)
        resource = normalize_resource_url(protected.resource or server_url)
        redirect_uri = _redirect_uri()
        client = await _get_oauth_client(
            db,
            definition=definition,
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
    except IntegrationOAuthProviderError as exc:
        raise CloudApiError(
            exc.code,
            "Could not start OAuth for this integration.",
            status_code=400,
        ) from exc

    flow = await create_oauth_flow_canceling_existing(
        db,
        account_id=account_id,
        owner_user_id=user_id,
        definition_id=definition.id,
        state_hash=_state_hash(state),
        code_verifier_ciphertext=encrypt_text(verifier),
        issuer=auth_metadata.issuer,
        resource=resource,
        client_id=client.client_id,
        token_endpoint=auth_metadata.token_endpoint,
        requested_scopes=_requested_scopes_json(protected.challenged_scope),
        redirect_uri=redirect_uri,
        authorization_url=authorization_url,
        callback_surface=return_target.callback_surface,
        final_surface=return_target.final_surface,
        return_path=return_target.return_path,
        expires_at=datetime.now(UTC) + OAUTH_FLOW_TTL,
    )
    return OAuthFlowStart(
        flow_id=flow.id,
        authorization_url=flow.authorization_url,
        status=flow.status,
        expires_at=flow.expires_at,
    )


async def get_oauth_flow_status(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> OAuthFlowStatus:
    flow = await get_oauth_flow_for_user(db, user_id=user_id, flow_id=flow_id)
    if flow is None:
        raise CloudApiError("not_found", "OAuth flow was not found.", status_code=404)
    resolved = flow
    if flow.status == "active" and _oauth_flow_is_expired(
        expires_at=flow.expires_at,
        now=datetime.now(UTC),
    ):
        resolved = await expire_oauth_flow(db, flow_id=flow.id) or flow
    return OAuthFlowStatus(
        flow=resolved,
        include_authorization_url=_status_includes_authorization_url(resolved.status),
    )


async def cancel_oauth_flow(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> OAuthFlowStatus:
    flow = await cancel_oauth_flow_for_user(db, user_id=user_id, flow_id=flow_id)
    if flow is None:
        raise CloudApiError("not_found", "OAuth flow was not found.", status_code=404)
    return OAuthFlowStatus(flow=flow, include_authorization_url=False)


def _callback_result(
    flow: IntegrationOAuthFlowRecord | None,
    *,
    ok: bool,
    status: str,
    failure_code: str | None = None,
) -> OAuthCallbackResult:
    resolved_failure_code = failure_code
    if resolved_failure_code is None and flow is not None:
        resolved_failure_code = flow.failure_code
    return OAuthCallbackResult(
        ok=ok,
        status=status,
        flow_id=flow.id if flow is not None else None,
        failure_code=resolved_failure_code,
        callback_surface=flow.callback_surface if flow is not None else "desktop",
        final_surface=flow.final_surface if flow is not None else "desktop",
        return_path=flow.return_path if flow is not None else None,
    )


async def complete_oauth_callback(
    db: AsyncSession,
    *,
    state: str,
    code: str | None,
    provider_error: str | None = None,
) -> OAuthCallbackResult:
    """Finish an OAuth flow from the provider redirect and store credentials."""
    hashed = _state_hash(state)
    flow = await claim_active_oauth_flow_by_state_hash(db, hashed)
    if flow is None:
        stored_flow = await get_oauth_flow_by_state_hash(db, hashed)
        return _callback_result(
            stored_flow,
            ok=False,
            status=stored_flow.status if stored_flow is not None else "failed",
            failure_code=(
                stored_flow.failure_code if stored_flow is not None else "invalid_state"
            ),
        )
    if provider_error:
        failure_code = "access_denied" if provider_error == "access_denied" else "provider_error"
        failed = await fail_oauth_flow(db, flow_id=flow.id, failure_code=failure_code) or flow
        return _callback_result(failed, ok=False, status=failed.status)
    if not code:
        failed = (
            await fail_oauth_flow(db, flow_id=flow.id, failure_code="invalid_callback") or flow
        )
        return _callback_result(failed, ok=False, status="failed")
    if _oauth_flow_is_expired(expires_at=flow.expires_at, now=datetime.now(UTC)):
        expired = await expire_oauth_flow(db, flow_id=flow.id) or flow
        return _callback_result(expired, ok=False, status="expired")
    if not flow.token_endpoint or not flow.resource:
        failed = await fail_oauth_flow(db, flow_id=flow.id, failure_code="invalid_flow") or flow
        return _callback_result(failed, ok=False, status="failed")
    if flow.account_id is None:
        failed = await fail_oauth_flow(db, flow_id=flow.id, failure_code="account_missing") or flow
        return _callback_result(failed, ok=False, status="failed")

    oauth_client = await get_oauth_client(
        db,
        issuer=flow.issuer or "",
        redirect_uri=flow.redirect_uri,
        definition_id=flow.definition_id,
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
    except IntegrationOAuthProviderError as exc:
        if _should_drop_cached_oauth_client_on_token_error(exc.code) and oauth_client is not None:
            await delete_oauth_client(db, oauth_client.id)
        failed = await fail_oauth_flow(db, flow_id=flow.id, failure_code=exc.code) or flow
        return _callback_result(failed, ok=False, status="failed")

    await set_account_credentials(
        db,
        account_id=flow.account_id,
        credential_ciphertext=encrypt_json(
            _build_oauth_bundle(
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
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=token.expires_at,
    )
    completed = await complete_oauth_flow(db, flow_id=flow.id) or flow
    return _callback_result(completed, ok=True, status="completed")
