"""OAuth client resolution for cloud integrations (DCR vs static).

Resolves the OAuth client used to authorize against a provider: dynamically
registered clients (RFC 7591) are registered once and cached per
(issuer, redirect_uri, definition); statically configured clients (e.g. Slack)
are verified snapshots of deployment settings.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings as app_settings
from proliferate.db.store.integrations.definitions import IntegrationDefinitionRecord
from proliferate.db.store.integrations.oauth_clients import (
    IntegrationOAuthClientRecord,
    get_oauth_client,
    upsert_oauth_client,
)
from proliferate.integrations.integration_oauth import (
    IntegrationOAuthProviderError,
    discover_authorization_server_metadata,
    register_client,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text

# Static-client auth methods this deployment can drive.
# Static-client auth methods this deployment can drive.
SUPPORTED_STATIC_OAUTH_TOKEN_ENDPOINT_AUTH_METHODS = {
    "none",
    "client_secret_post",
    "client_secret_basic",
}


@dataclass(frozen=True)
class _StaticOAuthClientConfig:
    client_id: str
    client_secret: str | None
    token_endpoint_auth_method: str


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


async def resolve_oauth_client(
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
