"""Service layer for integration management.

A thin API/service layer over the integration primitives (accounts,
definitions, policies stores + the OAuth flow lifecycle in
``oauth``). It authenticates a user's integration accounts, removes
them, and lets org admins manage which definitions their organization exposes.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings as app_settings
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.integrations.accounts import (
    IntegrationAccountRecord,
    delete_account,
    get_account,
    get_account_for_owner_locked,
    get_account_for_user_definition,
)
from proliferate.db.store.integrations.authorization_attempts import (
    acquire_authorization_attempt_lock,
    commit_authorization_attempt,
    create_authorization_attempt,
    supersede_authorization_attempts,
    terminalize_authorization_attempt,
)
from proliferate.db.store.integrations.definition_security_revisions import (
    ensure_current_definition_security_revision,
)
from proliferate.db.store.integrations.definitions import (
    IntegrationDefinitionRecord,
    create_org_custom_definition,
    get_definition,
    list_definitions_visible_to_org,
    list_seed_definitions,
)
from proliferate.db.store.integrations.oauth_flows import cancel_active_oauth_flows
from proliferate.db.store.integrations.policies import (
    get_policy,
    list_policies_for_org,
    upsert_policy,
)
from proliferate.db.store.integrations.tool_cache import delete_tool_cache
from proliferate.integrations.integration_oauth import normalize_resource_url
from proliferate.integrations.integration_oauth.discovery import (
    discover_protected_resource_metadata,
)
from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError
from proliferate.integrations.mcp_remote import list_tools as list_remote_tools
from proliferate.lib.infra.encryption.json import encrypt_json
from proliferate.server.api_errors import CloudApiError
from proliferate.server.integration_gateway.connections import (
    transactions as integration_transactions,
)
from proliferate.server.integration_gateway.connections.access import (
    render_candidate_api_key_launch,
)
from proliferate.server.integration_gateway.connections.config import (
    HeaderTemplate,
    IntegrationConfig,
    StaticUrl,
    parse_definition_config,
    render_mcp_url,
    serialize_definition_config,
)
from proliferate.server.integration_gateway.connections.models import (
    AdminIntegrationDefinitionResponse,
    AuthDetection,
    AuthenticateIntegrationResponse,
    IntegrationAccountResponse,
    IntegrationCatalogItem,
    IntegrationCatalogSecretField,
    IntegrationCatalogSettingField,
    IntegrationCatalogSettingOption,
    IntegrationConnectSchema,
)
from proliferate.server.integration_gateway.connections.oauth import (
    OAuthCallbackResult,
    OAuthFlowStatus,
    cancel_oauth_flow,
    complete_oauth_callback,
    get_oauth_flow_status,
    start_oauth_flow,
)
from proliferate.server.integration_gateway.connections.revocation import (
    stage_revocation_for_disconnect,
)
from proliferate.server.organizations.domain.policy import organization_admin_roles

_DEFAULT_SECRET_FIELD_ID = "api_key"

_NAMESPACE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

# Bound on the create-time OAuth probe so slow/unreachable MCP URLs can never
# block definition creation for long.
_OAUTH_PROBE_TIMEOUT_SECONDS = 5.0
_AUTHORIZATION_ATTEMPT_TTL = timedelta(minutes=10)

# Same shape seeds.py's ``_oauth_bearer_header`` builds for seed oauth2
# definitions: the gateway substitutes the account's access token at call time.
_OAUTH_BEARER_HEADER = HeaderTemplate(
    "Authorization", "Bearer {secret.accessToken}", optional=True
)


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
    auth_detection: AuthDetection | None = None,
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
        auth_detection=auth_detection,
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
# Connect catalog
# --------------------------------------------------------------------------- #


def build_connect_schema(definition: IntegrationDefinitionRecord) -> IntegrationConnectSchema:
    """Derive the connect-time field schema from a definition's config codec.

    Only field *metadata* (ids, labels, hints) is exposed — never any stored
    secret values, header templates, or endpoint internals.
    """
    try:
        config = parse_definition_config(definition.config_json)
    except ValueError:
        return IntegrationConnectSchema()
    return IntegrationConnectSchema(
        secret_fields=[
            IntegrationCatalogSecretField(
                id=field.id,
                label=field.label,
                placeholder=field.placeholder,
                helper_text=field.helper_text,
                prefix_hint=field.prefix_hint,
            )
            for field in config.secret_fields
        ],
        settings_fields=[
            IntegrationCatalogSettingField(
                id=field.id,
                label=field.label,
                kind=field.kind,
                required=field.required,
                options=[
                    IntegrationCatalogSettingOption(value=option.value, label=option.label)
                    for option in field.options
                ],
                default=field.default,
            )
            for field in config.settings_fields
        ],
    )


def _catalog_item(definition: IntegrationDefinitionRecord) -> IntegrationCatalogItem:
    return IntegrationCatalogItem(
        definition_id=definition.id,
        namespace=definition.namespace,
        display_name=definition.display_name,
        description=definition.description,
        auth_kind=definition.auth_kind,
        connect_schema=build_connect_schema(definition),
    )


async def list_integration_catalog(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID | None = None,
) -> list[IntegrationCatalogItem]:
    """List the definitions ``user_id`` may connect to, with connect schemas.

    Mirrors the health endpoint's visibility rules: seeds only by default;
    seeds plus the org's custom definitions when ``organization_id`` is given
    (membership-guarded so non-members cannot enumerate an org's customs).
    """
    if organization_id is not None:
        membership = await organization_store.get_active_membership(
            db, organization_id=organization_id, user_id=user_id
        )
        if membership is None:
            raise CloudApiError(
                "organization_not_found", "Organization not found.", status_code=404
            )
        definitions = await list_definitions_visible_to_org(db, organization_id)
    else:
        definitions = await list_seed_definitions(db)
    return [
        _catalog_item(definition) for definition in definitions if definition.archived_at is None
    ]


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
    """Stage and commit a first connection or credential replacement."""
    definition = await get_definition(db, definition_id)
    if definition is None or definition.archived_at is not None:
        raise CloudApiError("not_found", "Integration was not found.", status_code=404)
    if definition.organization_id is not None:
        membership = await organization_store.get_active_membership(
            db,
            organization_id=definition.organization_id,
            user_id=user_id,
        )
        if membership is None:
            # Definition ids are not an authorization boundary. Preserve the
            # same not-found surface as an unknown id so another organization
            # cannot be enumerated or connected through the generic route.
            raise CloudApiError("not_found", "Integration was not found.", status_code=404)
        policy = await get_policy(db, definition.organization_id, definition.id)
        if not (policy.enabled if policy is not None else definition.enabled_by_default):
            raise CloudApiError(
                "integration_provider_unavailable",
                "This integration is disabled by your organization.",
                status_code=400,
                extra_detail={"reason": "disabled_by_org"},
            )
    if auth_kind != definition.auth_kind:
        raise CloudApiError(
            "invalid_payload",
            "Requested auth kind does not match this integration.",
            status_code=400,
        )
    candidate_settings = settings or {}
    settings_json = json.dumps(candidate_settings, separators=(",", ":"), sort_keys=True)
    account = await get_account_for_user_definition(db, user_id, definition.id)

    if auth_kind == "none":
        try:
            config = parse_definition_config(definition.config_json)
            audience = normalize_resource_url(render_mcp_url(config, candidate_settings))
        except ValueError as exc:
            raise CloudApiError("invalid_payload", str(exc), status_code=400) from exc
        security_revision = await ensure_current_definition_security_revision(db, definition.id)
        if security_revision is None:
            raise CloudApiError("not_found", "Integration was not found.", status_code=404)
        attempt = await create_authorization_attempt(
            db,
            owner_user_id=user_id,
            definition_id=definition.id,
            account_id=account.id if account is not None else None,
            purpose="reauthorize" if account is not None else "connect",
            method="none",
            starting_grant_version=account.grant_version if account is not None else None,
            starting_credential_version=(
                account.credential_version if account is not None else None
            ),
            definition_security_revision_id=security_revision.id,
            provider_client_id=None,
            credential_audience=audience,
            settings_json=settings_json,
            requested_scopes_json="[]",
            effective_scopes_json="[]",
            staged_credential_ciphertext=None,
            staged_credential_format=None,
            status="validating",
            expires_at=datetime.now(UTC) + _AUTHORIZATION_ATTEMPT_TTL,
        )
        committed = await commit_authorization_attempt(
            db,
            attempt_id=attempt.id,
            token_expires_at=None,
        )
        if committed is None:
            await integration_transactions.release_integration_transaction(db)
            raise CloudApiError(
                "integration_attempt_superseded",
                "A newer integration authorization attempt won.",
                status_code=409,
            )
        return AuthenticateIntegrationResponse(
            account=_account_response(committed, definition),
            attempt_id=attempt.id,
            attempt_generation=attempt.generation,
        )

    if auth_kind == "api_key":
        secret = (api_key or "").strip()
        if not secret:
            raise CloudApiError("invalid_payload", "API key is required.", status_code=400)
        try:
            config = parse_definition_config(definition.config_json)
        except ValueError as exc:
            raise CloudApiError("invalid_payload", str(exc), status_code=400) from exc
        if config.credential_validation != "mcp_tools_list":
            raise CloudApiError(
                "integration_credential_validation_unavailable",
                "This integration cannot safely validate credentials.",
                status_code=400,
            )
        field_id = _first_secret_field_id(definition)
        secret_fields = {field_id: secret}
        url, headers, query = render_candidate_api_key_launch(
            config,
            secret_fields=secret_fields,
            settings=candidate_settings,
        )
        security_revision = await ensure_current_definition_security_revision(db, definition.id)
        if security_revision is None:
            raise CloudApiError("not_found", "Integration was not found.", status_code=404)
        attempt = await create_authorization_attempt(
            db,
            owner_user_id=user_id,
            definition_id=definition.id,
            account_id=account.id if account is not None else None,
            purpose="rotate" if account is not None else "connect",
            method="api_key",
            starting_grant_version=account.grant_version if account is not None else None,
            starting_credential_version=(
                account.credential_version if account is not None else None
            ),
            definition_security_revision_id=security_revision.id,
            provider_client_id=None,
            credential_audience=normalize_resource_url(url),
            settings_json=settings_json,
            requested_scopes_json="[]",
            effective_scopes_json="[]",
            staged_credential_ciphertext=encrypt_json(
                {"secretFields": secret_fields},
                secret=app_settings.cloud_secret_key,
            ),
            staged_credential_format="secret-fields-v1",
            status="validating",
            expires_at=datetime.now(UTC) + _AUTHORIZATION_ATTEMPT_TTL,
        )
        await integration_transactions.release_integration_transaction(db)
        try:
            await list_remote_tools(url=url, headers=headers, query=query or None)
        except Exception as exc:  # noqa: BLE001 - provider failures use one safe code
            await terminalize_authorization_attempt(
                db,
                attempt_id=attempt.id,
                status="failed",
                failure_code="credential_validation_failed",
            )
            await integration_transactions.release_integration_transaction(db)
            raise CloudApiError(
                "integration_credential_validation_failed",
                "The integration credentials could not be validated.",
                status_code=400,
            ) from exc
        committed = await commit_authorization_attempt(
            db,
            attempt_id=attempt.id,
            token_expires_at=None,
        )
        if committed is None:
            await integration_transactions.release_integration_transaction(db)
            raise CloudApiError(
                "integration_attempt_superseded",
                "A newer integration authorization attempt won.",
                status_code=409,
            )
        return AuthenticateIntegrationResponse(
            account=_account_response(committed, definition),
            attempt_id=attempt.id,
            attempt_generation=attempt.generation,
        )

    # oauth2
    flow = await start_oauth_flow(
        db,
        user_id=user_id,
        definition=definition,
        account_id=account.id if account is not None else None,
        settings=candidate_settings,
        callback_surface=callback_surface,
        final_surface=final_surface,
        return_path=return_path,
    )
    return AuthenticateIntegrationResponse(
        account=_account_response(account, definition) if account is not None else None,
        attempt_id=flow.attempt_id,
        attempt_generation=flow.attempt_generation,
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
    """Commit an immediate local cutoff and stage bounded upstream revocation."""

    identity = await get_account(db, account_id)
    if identity is None or identity.owner_user_id != user_id:
        raise CloudApiError("not_found", "Integration account was not found.", status_code=404)
    await acquire_authorization_attempt_lock(
        db,
        owner_user_id=user_id,
        definition_id=identity.definition_id,
    )
    account = await get_account_for_owner_locked(
        db,
        account_id=account_id,
        owner_user_id=user_id,
    )
    if account is None:
        raise CloudApiError("not_found", "Integration account was not found.", status_code=404)
    definition = await get_definition(db, account.definition_id)
    if definition is None:
        raise CloudApiError("not_found", "Integration was not found.", status_code=404)

    await supersede_authorization_attempts(
        db,
        owner_user_id=user_id,
        definition_id=account.definition_id,
        failure_code="disconnected",
    )
    await cancel_active_oauth_flows(
        db,
        owner_user_id=user_id,
        definition_id=account.definition_id,
        failure_code="disconnected",
    )
    await stage_revocation_for_disconnect(
        db,
        account=account,
        definition=definition,
    )
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


async def _probe_mcp_oauth(mcp_url: str) -> Literal["detected", "none", "unreachable"]:
    """Probe ``mcp_url`` for an OAuth challenge, bounded and best-effort.

    An OAuth-protected streamable-HTTP MCP server answers an unauthenticated
    request with a 401 + ``WWW-Authenticate`` resource-metadata challenge
    and/or publishes RFC 9728 protected-resource metadata;
    ``discover_protected_resource_metadata`` already walks both paths.
    A timeout maps to ``"unreachable"``; any other failure (including "the
    server published no OAuth metadata") maps to ``"none"`` so the probe can
    never block definition creation.
    """
    try:
        await asyncio.wait_for(
            discover_protected_resource_metadata(mcp_url),
            timeout=_OAUTH_PROBE_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        return "unreachable"
    except IntegrationOAuthProviderError:
        return "none"
    except Exception:  # noqa: BLE001 - detection is advisory; never fail creation
        return "none"
    return "detected"


async def create_admin_integration_definition(
    db: AsyncSession,
    *,
    organization_id: UUID,
    actor_user_id: UUID,
    display_name: str,
    namespace: str,
    mcp_url: str,
    auth_kind: str = "auto",
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
    if auth_kind not in ("auto", "none", "oauth2"):
        raise CloudApiError(
            "invalid_payload",
            "Auth kind must be one of 'auto', 'none' or 'oauth2'.",
            status_code=400,
        )

    detection: AuthDetection = "forced"
    if auth_kind == "auto":
        detection = await _probe_mcp_oauth(mcp_url)
    resolved_auth_kind = "oauth2" if auth_kind == "oauth2" or detection == "detected" else "none"

    config = IntegrationConfig(
        transport="http",
        url=StaticUrl(mcp_url),
        display_url=mcp_url,
        headers=(_OAUTH_BEARER_HEADER,) if resolved_auth_kind == "oauth2" else (),
    )
    definition = await create_org_custom_definition(
        db,
        organization_id=organization_id,
        namespace=namespace,
        display_name=display_name,
        description=None,
        auth_kind=resolved_auth_kind,
        oauth_client_mode="dcr" if resolved_auth_kind == "oauth2" else None,
        config_json=serialize_definition_config(config),
    )
    await upsert_policy(
        db,
        organization_id=organization_id,
        definition_id=definition.id,
        enabled=True,
        updated_by_user_id=actor_user_id,
    )
    return _admin_definition_response(definition, policy_enabled=True, auth_detection=detection)


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
