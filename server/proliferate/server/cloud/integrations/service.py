"""Service layer for integration management.

A thin API/service layer over the integration primitives (accounts,
definitions, policies stores + the OAuth flow lifecycle in
``oauth``). It authenticates a user's integration accounts, removes
them, and lets org admins manage which definitions their organization exposes.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import organizations as organization_store
from proliferate.db.store.integrations.accounts import (
    IntegrationAccountRecord,
    delete_account,
    get_account,
    set_account_credentials,
    upsert_account,
)
from proliferate.db.store.integrations.definitions import (
    IntegrationDefinitionRecord,
    create_org_custom_definition,
    get_definition,
    list_definitions_visible_to_org,
)
from proliferate.db.store.integrations.policies import (
    list_policies_for_org,
    upsert_policy,
)
from proliferate.db.store.integrations.tool_cache import delete_tool_cache
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.config import (
    IntegrationConfig,
    StaticUrl,
    parse_definition_config,
    serialize_definition_config,
)
from proliferate.server.cloud.integrations.models import (
    AdminIntegrationDefinitionResponse,
    AuthenticateIntegrationResponse,
    IntegrationAccountResponse,
)
from proliferate.server.cloud.integrations.oauth import (
    OAuthCallbackResult,
    OAuthFlowStatus,
    cancel_oauth_flow,
    complete_oauth_callback,
    get_oauth_flow_status,
    start_oauth_flow,
)
from proliferate.server.organizations.domain.policy import organization_admin_roles
from proliferate.utils.crypto import encrypt_json

_DEFAULT_SECRET_FIELD_ID = "api_key"

_NAMESPACE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _account_response(
    account: IntegrationAccountRecord,
    definition: IntegrationDefinitionRecord,
) -> IntegrationAccountResponse:
    return IntegrationAccountResponse(
        account_id=account.id,
        definition_id=account.definition_id,
        namespace=definition.namespace,
        display_name=definition.display_name,
        auth_kind=account.auth_kind,
        status=account.status,
        enabled=account.enabled,
    )


def _admin_definition_response(
    definition: IntegrationDefinitionRecord,
    *,
    policy_enabled: bool | None,
) -> AdminIntegrationDefinitionResponse:
    effective_enabled = (
        policy_enabled if policy_enabled is not None else definition.enabled_by_default
    )
    return AdminIntegrationDefinitionResponse(
        definition_id=definition.id,
        namespace=definition.namespace,
        display_name=definition.display_name,
        source=definition.source,
        organization_id=definition.organization_id,
        auth_kind=definition.auth_kind,
        enabled_by_default=definition.enabled_by_default,
        policy_enabled=policy_enabled,
        effective_enabled=effective_enabled,
    )


async def _require_org_admin(
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
    if membership.role not in organization_admin_roles():
        raise CloudApiError(
            "organization_permission_denied",
            "You do not have permission to manage organization integrations.",
            status_code=403,
        )


def _first_secret_field_id(definition: IntegrationDefinitionRecord) -> str:
    try:
        config = parse_definition_config(definition.config_json)
    except ValueError:
        return _DEFAULT_SECRET_FIELD_ID
    if config.secret_fields:
        return config.secret_fields[0].id
    return _DEFAULT_SECRET_FIELD_ID


# --------------------------------------------------------------------------- #
# User-facing authentication
# --------------------------------------------------------------------------- #


async def authenticate_integration(
    db: AsyncSession,
    *,
    user_id: UUID,
    definition_id: UUID,
    auth_kind: str,
    api_key: str | None = None,
    settings: dict[str, Any] | None = None,
    callback_surface: str | None = None,
    final_surface: str | None = None,
    return_path: str | None = None,
) -> AuthenticateIntegrationResponse:
    """Authenticate ``user_id`` against ``definition_id``.

    - ``none``: mark the account ready immediately.
    - ``api_key``: store the key under the definition's first secret field and
      mark the account ready.
    - ``oauth2``: create the account in ``setup_required`` and start an OAuth
      flow, returning the authorization URL for the browser handoff.
    """
    definition = await get_definition(db, definition_id)
    if definition is None:
        raise CloudApiError("not_found", "Integration was not found.", status_code=404)
    if auth_kind != definition.auth_kind:
        raise CloudApiError(
            "invalid_payload",
            "Requested auth kind does not match this integration.",
            status_code=400,
        )

    if auth_kind == "none":
        account = await upsert_account(
            db,
            user_id=user_id,
            definition_id=definition.id,
            auth_kind="none",
            status="ready",
        )
        return AuthenticateIntegrationResponse(account=_account_response(account, definition))

    if auth_kind == "api_key":
        secret = (api_key or "").strip()
        if not secret:
            raise CloudApiError("invalid_payload", "API key is required.", status_code=400)
        account = await upsert_account(
            db,
            user_id=user_id,
            definition_id=definition.id,
            auth_kind="api_key",
            status="setup_required",
        )
        field_id = _first_secret_field_id(definition)
        updated = await set_account_credentials(
            db,
            account_id=account.id,
            credential_ciphertext=encrypt_json({"secretFields": {field_id: secret}}),
            credential_format="secret-fields-v1",
            auth_status="ready",
            token_expires_at=None,
        )
        account = updated or account
        return AuthenticateIntegrationResponse(account=_account_response(account, definition))

    # oauth2
    account = await upsert_account(
        db,
        user_id=user_id,
        definition_id=definition.id,
        auth_kind="oauth2",
        status="setup_required",
    )
    flow = await start_oauth_flow(
        db,
        user_id=user_id,
        definition=definition,
        account_id=account.id,
        settings=settings or {},
        callback_surface=callback_surface,
        final_surface=final_surface,
        return_path=return_path,
    )
    return AuthenticateIntegrationResponse(
        account=_account_response(account, definition),
        oauth_flow_id=str(flow.flow_id),
        authorization_url=flow.authorization_url,
        expires_at=flow.expires_at,
    )


async def remove_integration_account(
    db: AsyncSession,
    *,
    user_id: UUID,
    account_id: UUID,
) -> None:
    """Delete an integration account (and its tool-schema cache) owned by ``user_id``."""
    account = await get_account(db, account_id)
    if account is None or account.owner_user_id != user_id:
        raise CloudApiError("not_found", "Integration account was not found.", status_code=404)
    await delete_tool_cache(db, account_id)
    await delete_account(db, account_id)


# --------------------------------------------------------------------------- #
# OAuth flow adapters (thin wrappers around the oauth package)
# --------------------------------------------------------------------------- #


async def get_integration_oauth_flow_status(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> OAuthFlowStatus:
    return await get_oauth_flow_status(db, user_id=user_id, flow_id=flow_id)


async def cancel_integration_oauth_flow(
    db: AsyncSession,
    *,
    user_id: UUID,
    flow_id: UUID,
) -> OAuthFlowStatus:
    return await cancel_oauth_flow(db, user_id=user_id, flow_id=flow_id)


async def complete_integration_oauth_callback(
    db: AsyncSession,
    *,
    state: str,
    code: str | None,
    provider_error: str | None = None,
) -> OAuthCallbackResult:
    return await complete_oauth_callback(
        db,
        state=state,
        code=code,
        provider_error=provider_error,
    )


# --------------------------------------------------------------------------- #
# Org-admin definition management
# --------------------------------------------------------------------------- #


async def list_admin_integration_definitions(
    db: AsyncSession,
    *,
    organization_id: UUID,
    actor_user_id: UUID,
) -> list[AdminIntegrationDefinitionResponse]:
    await _require_org_admin(db, user_id=actor_user_id, organization_id=organization_id)
    definitions = await list_definitions_visible_to_org(db, organization_id)
    policies = await list_policies_for_org(db, organization_id)
    policy_by_definition = {policy.definition_id: policy.enabled for policy in policies}
    return [
        _admin_definition_response(
            definition,
            policy_enabled=policy_by_definition.get(definition.id),
        )
        for definition in definitions
    ]


async def create_admin_integration_definition(
    db: AsyncSession,
    *,
    organization_id: UUID,
    actor_user_id: UUID,
    display_name: str,
    namespace: str,
    mcp_url: str,
) -> AdminIntegrationDefinitionResponse:
    await _require_org_admin(db, user_id=actor_user_id, organization_id=organization_id)
    display_name = display_name.strip()
    namespace = namespace.strip()
    mcp_url = mcp_url.strip()
    if not display_name:
        raise CloudApiError("invalid_payload", "Display name is required.", status_code=400)
    if not _NAMESPACE_PATTERN.fullmatch(namespace):
        raise CloudApiError(
            "invalid_payload",
            "Namespace must be 1-64 lowercase alphanumeric, '_' or '-' characters and "
            "start with a letter or digit.",
            status_code=400,
        )
    try:
        parsed_url = urlsplit(mcp_url)
    except ValueError:
        raise CloudApiError(
            "invalid_payload",
            "MCP URL must be a valid http(s) URL.",
            status_code=400,
        ) from None
    if parsed_url.scheme not in ("http", "https") or not parsed_url.netloc:
        raise CloudApiError(
            "invalid_payload",
            "MCP URL must be a valid http(s) URL.",
            status_code=400,
        )

    config = IntegrationConfig(
        transport="http",
        url=StaticUrl(mcp_url),
        display_url=mcp_url,
    )
    definition = await create_org_custom_definition(
        db,
        organization_id=organization_id,
        namespace=namespace,
        display_name=display_name,
        description=None,
        auth_kind="none",
        oauth_client_mode=None,
        config_json=serialize_definition_config(config),
    )
    await upsert_policy(
        db,
        organization_id=organization_id,
        definition_id=definition.id,
        enabled=True,
        updated_by_user_id=actor_user_id,
    )
    return _admin_definition_response(definition, policy_enabled=True)


async def set_admin_integration_enabled(
    db: AsyncSession,
    *,
    organization_id: UUID,
    definition_id: UUID,
    actor_user_id: UUID,
    enabled: bool,
) -> AdminIntegrationDefinitionResponse:
    await _require_org_admin(db, user_id=actor_user_id, organization_id=organization_id)
    definition = await get_definition(db, definition_id)
    if (
        definition is None
        or definition.archived_at is not None
        or (definition.source == "org_custom" and definition.organization_id != organization_id)
    ):
        raise CloudApiError("not_found", "Integration was not found.", status_code=404)
    await upsert_policy(
        db,
        organization_id=organization_id,
        definition_id=definition.id,
        enabled=enabled,
        updated_by_user_id=actor_user_id,
    )
    return _admin_definition_response(definition, policy_enabled=enabled)
