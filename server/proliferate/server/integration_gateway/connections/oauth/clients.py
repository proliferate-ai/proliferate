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
from proliferate.lib.infra.encryption.fernet import decrypt_text, encrypt_text
from proliferate.server.integration_gateway.connections import (
    transactions as integration_transactions,
)

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


@dataclass(frozen=True)
class OAuthProviderAvailability:
    available: bool
    reason: str | None = None


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


def validate_oauth_provider_start_readiness(
    definition: IntegrationDefinitionRecord,
) -> None:
    """Fail closed before discovery when a static provider is not qualified.

    Slack Marketplace/distribution eligibility is independent of possessing a
    client id and secret.  Keep the release qualification as a distinct,
    default-off gate so a stale deployment secret can never advertise a usable
    authorization path on its own.
    """
    if definition.oauth_client_mode != "static" or definition.namespace != "slack":
        return
    if (
        not app_settings.cloud_mcp_slack_enabled
        or not app_settings.cloud_mcp_slack_distribution_ready
    ):
        raise IntegrationOAuthProviderError(
            "integration_provider_unavailable",
            "Slack OAuth distribution is not qualified for this deployment.",
        )
    if _static_oauth_client_config(definition.namespace) is None:
        raise IntegrationOAuthProviderError(
            "missing_static_oauth_client",
            "This deployment is missing static OAuth client configuration.",
        )


def oauth_provider_availability(
    definition: IntegrationDefinitionRecord,
) -> OAuthProviderAvailability:
    if definition.oauth_client_mode != "static" or definition.namespace != "slack":
        return OAuthProviderAvailability(available=True)
    if (
        not app_settings.cloud_mcp_slack_enabled
        or not app_settings.cloud_mcp_slack_distribution_ready
    ):
        return OAuthProviderAvailability(
            available=False,
            reason="distribution_required",
        )
    if _static_oauth_client_config(definition.namespace) is None:
        return OAuthProviderAvailability(
            available=False,
            reason="provider_configuration_missing",
        )
    return OAuthProviderAvailability(available=True)


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

    await integration_transactions.release_integration_transaction(db)
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
            encrypt_text(registered.client_secret, secret=app_settings.cloud_secret_key)
            if registered.client_secret
            else None
        ),
        client_secret_expires_at=registered.client_secret_expires_at,
        token_endpoint_auth_method=registered.token_endpoint_auth_method,
        registration_client_uri=registered.registration_client_uri,
        registration_access_token_ciphertext=(
            encrypt_text(
                registered.registration_access_token,
                secret=app_settings.cloud_secret_key,
            )
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
    validate_oauth_provider_start_readiness(definition)
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
            decrypt_text(cached.client_secret_ciphertext, secret=app_settings.cloud_secret_key)
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
            encrypt_text(config.client_secret, secret=app_settings.cloud_secret_key)
            if config.client_secret
            else None
        ),
        client_secret_expires_at=None,
        token_endpoint_auth_method=config.token_endpoint_auth_method,
        registration_client_uri=None,
        registration_access_token_ciphertext=None,
        replace_active=True,
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
