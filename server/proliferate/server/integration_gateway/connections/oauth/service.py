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
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings as app_settings
from proliferate.db.store.integrations.accounts import get_account, set_account_credentials
from proliferate.db.store.integrations.authorization_attempts import (
    IntegrationAuthorizationAttemptRecord,
    claim_authorization_attempt,
    commit_authorization_attempt,
    create_authorization_attempt,
    get_authorization_attempt,
    stage_authorization_credential,
    terminalize_authorization_attempt,
)
from proliferate.db.store.integrations.definition_security_revisions import (
    ensure_current_definition_security_revision,
    get_definition_security_revision_by_id,
)
from proliferate.db.store.integrations.definitions import (
    IntegrationDefinitionRecord,
    get_definition,
)
from proliferate.db.store.integrations.oauth_clients import (
    get_oauth_client,
    get_oauth_client_by_id,
    retire_oauth_client,
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
)
from proliferate.integrations.integration_oauth.revocation import (
    validate_revocation_endpoint_origin,
)
from proliferate.lib.infra.encryption.fernet import decrypt_text, encrypt_text
from proliferate.lib.infra.encryption.json import encrypt_json
from proliferate.server.api_errors import CloudApiError
from proliferate.server.integration_gateway.connections import (
    transactions as integration_transactions,
)
from proliferate.server.integration_gateway.connections.config import (
    parse_definition_config,
    render_mcp_url,
)
from proliferate.server.integration_gateway.connections.oauth.clients import (
    resolve_oauth_client,
    validate_oauth_provider_start_readiness,
)
from proliferate.server.integration_gateway.connections.oauth.scope_policy import (
    OAuthScopePolicyError,
    validate_callback_oauth_scopes,
)
from proliferate.server.integration_gateway.connections.oauth.scope_policy import (
    resolve_requested_oauth_scope as resolve_scope_policy,
)
from proliferate.server.integration_gateway.connections.oauth.surfaces import (
    normalize_return_target,
)

# Callback path appended to the API base URL for the shared OAuth callback.
OAUTH_CALLBACK_PATH = "/v1/cloud/integrations/oauth/callback"
# How long an in-flight authorization stays valid before it expires.
OAUTH_FLOW_TTL = timedelta(minutes=10)

# --------------------------------------------------------------------------- #
# Result shapes
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class OAuthFlowStart:
    attempt_id: UUID
    attempt_generation: int
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


def _resolve_requested_oauth_scope(
    *,
    challenged_scope: str | None,
    configured_scopes: tuple[str, ...],
    scopes_required: bool,
    scope_policy: str = "provider",
) -> str | None:
    try:
        return resolve_scope_policy(
            challenged_scope=challenged_scope,
            configured_scopes=configured_scopes,
            scopes_required=scopes_required,
            scope_policy=scope_policy,
        )
    except OAuthScopePolicyError as exc:
        raise IntegrationOAuthProviderError(exc.code, exc.message) from exc


def _requested_scopes_json(requested_scope: str | None) -> str:
    return json.dumps(requested_scope.split() if requested_scope else [])


def _parse_requested_scopes(requested_scopes_json: str) -> tuple[str, ...]:
    raw = json.loads(requested_scopes_json)
    if not isinstance(raw, list) or not all(isinstance(scope, str) for scope in raw):
        raise ValueError("OAuth flow has invalid requested scope metadata.")
    return tuple(raw)


def _should_drop_cached_oauth_client_on_token_error(error_code: str) -> bool:
    return error_code == "invalid_client"


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
    revocation_endpoint: str | None,
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
        "revocationEndpoint": revocation_endpoint,
        "redirectUri": redirect_uri,
    }


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
    return_target = normalize_return_target(
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
        validate_oauth_provider_start_readiness(definition)
    except IntegrationOAuthProviderError as exc:
        raise CloudApiError(
            exc.code,
            "Could not start OAuth for this integration.",
            status_code=400,
        ) from exc

    account = await get_account(db, account_id) if account_id is not None else None
    if account_id is not None and (
        account is None
        or account.owner_user_id != user_id
        or account.definition_id != definition.id
    ):
        raise CloudApiError("not_found", "Integration account was not found.", status_code=404)
    security_revision = await ensure_current_definition_security_revision(db, definition.id)
    if security_revision is None:
        raise CloudApiError("not_found", "Integration was not found.", status_code=404)

    # Provider discovery and DCR never hold the definition/account read
    # transaction. The immutable revision above remains the attempt's pin.
    await integration_transactions.release_integration_transaction(db)
    try:
        protected = await discover_protected_resource_metadata(server_url)
        requested_scope = _resolve_requested_oauth_scope(
            challenged_scope=protected.challenged_scope,
            configured_scopes=config.oauth_scopes,
            scopes_required=config.oauth_scopes_required,
            scope_policy=config.oauth_scope_policy,
        )
        issuer = protected.authorization_servers[0]
        auth_metadata = await discover_authorization_server_metadata(issuer)
        resource = normalize_resource_url(protected.resource or server_url)
        redirect_uri = _redirect_uri()
        client = await resolve_oauth_client(
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
            scope=requested_scope,
        )
        revocation_endpoint = config.oauth_revocation_endpoint or auth_metadata.revocation_endpoint
        if revocation_endpoint is not None:
            try:
                validate_revocation_endpoint_origin(
                    revocation_endpoint=revocation_endpoint,
                    issuer=auth_metadata.issuer,
                    token_endpoint=auth_metadata.token_endpoint,
                )
            except IntegrationOAuthProviderError:
                revocation_endpoint = None
    except IntegrationOAuthProviderError as exc:
        raise CloudApiError(
            exc.code,
            "Could not start OAuth for this integration.",
            status_code=400,
        ) from exc

    expires_at = datetime.now(UTC) + OAUTH_FLOW_TTL
    attempt = await create_authorization_attempt(
        db,
        owner_user_id=user_id,
        definition_id=definition.id,
        account_id=account.id if account is not None else None,
        purpose="reauthorize" if account is not None else "connect",
        method="oauth2",
        starting_grant_version=account.grant_version if account is not None else None,
        starting_credential_version=(account.credential_version if account is not None else None),
        definition_security_revision_id=security_revision.id,
        provider_client_id=client.id,
        credential_audience=resource,
        settings_json=json.dumps(settings, separators=(",", ":"), sort_keys=True),
        requested_scopes_json=_requested_scopes_json(requested_scope),
        effective_scopes_json=None,
        staged_credential_ciphertext=None,
        staged_credential_format=None,
        status="active",
        expires_at=expires_at,
    )
    flow = await create_oauth_flow_canceling_existing(
        db,
        account_id=account.id if account is not None else None,
        attempt_id=attempt.id,
        owner_user_id=user_id,
        definition_id=definition.id,
        state_hash=_state_hash(state),
        code_verifier_ciphertext=encrypt_text(
            verifier,
            secret=app_settings.cloud_secret_key,
        ),
        issuer=auth_metadata.issuer,
        resource=resource,
        client_id=client.client_id,
        token_endpoint=auth_metadata.token_endpoint,
        revocation_endpoint=revocation_endpoint,
        requested_scopes=_requested_scopes_json(requested_scope),
        redirect_uri=redirect_uri,
        authorization_url=authorization_url,
        callback_surface=return_target.callback_surface,
        final_surface=return_target.final_surface,
        return_path=return_target.return_path,
        expires_at=expires_at,
    )
    return OAuthFlowStart(
        attempt_id=attempt.id,
        attempt_generation=attempt.generation,
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
    if flow.status in {"active", "exchanging"} and _oauth_flow_is_expired(
        expires_at=flow.expires_at,
        now=datetime.now(UTC),
    ):
        if flow.attempt_id is not None:
            await terminalize_authorization_attempt(
                db,
                attempt_id=flow.attempt_id,
                status="expired",
                failure_code="expired",
            )
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
    flow = await get_oauth_flow_for_user(db, user_id=user_id, flow_id=flow_id)
    if flow is None:
        raise CloudApiError("not_found", "OAuth flow was not found.", status_code=404)
    if flow.attempt_id is not None:
        await terminalize_authorization_attempt(
            db,
            attempt_id=flow.attempt_id,
            status="cancelled",
            failure_code="user_cancelled",
            owner_user_id=user_id,
        )
    flow = await cancel_oauth_flow_for_user(db, user_id=user_id, flow_id=flow_id) or flow
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


async def _fail_attempt_and_flow(
    db: AsyncSession,
    *,
    flow: IntegrationOAuthFlowRecord,
    failure_code: str,
    attempt_status: str = "failed",
) -> OAuthCallbackResult:
    if flow.attempt_id is not None:
        await terminalize_authorization_attempt(
            db,
            attempt_id=flow.attempt_id,
            status=attempt_status,
            failure_code=failure_code,
        )
    if attempt_status == "expired":
        resolved = await expire_oauth_flow(db, flow_id=flow.id) or flow
    else:
        resolved = await fail_oauth_flow(db, flow_id=flow.id, failure_code=failure_code) or flow
    return _callback_result(resolved, ok=False, status=attempt_status)


async def _complete_legacy_oauth_callback(
    db: AsyncSession,
    *,
    flow: IntegrationOAuthFlowRecord,
    code: str,
) -> OAuthCallbackResult:
    """Finish a pre-attempt flow created during the bounded deploy overlap."""

    if flow.account_id is None or not flow.token_endpoint or not flow.resource:
        return await _fail_attempt_and_flow(
            db,
            flow=flow,
            failure_code="invalid_flow",
        )
    definition = await get_definition(db, flow.definition_id)
    try:
        if definition is None:
            raise ValueError("OAuth flow definition is missing.")
        config = parse_definition_config(definition.config_json)
        requested_scopes = _parse_requested_scopes(flow.requested_scopes)
    except (json.JSONDecodeError, ValueError):
        return await _fail_attempt_and_flow(
            db,
            flow=flow,
            failure_code="invalid_flow",
        )
    oauth_client = await get_oauth_client(
        db,
        issuer=flow.issuer or "",
        redirect_uri=flow.redirect_uri,
        definition_id=flow.definition_id,
    )
    client_secret = (
        decrypt_text(oauth_client.client_secret_ciphertext, secret=app_settings.cloud_secret_key)
        if oauth_client and oauth_client.client_secret_ciphertext
        else None
    )
    verifier = decrypt_text(
        flow.code_verifier_ciphertext,
        secret=app_settings.cloud_secret_key,
    )
    await integration_transactions.release_integration_transaction(db)
    try:
        token = await exchange_token(
            token_endpoint=flow.token_endpoint,
            client_id=flow.client_id,
            code=code,
            code_verifier=verifier,
            redirect_uri=flow.redirect_uri,
            resource=flow.resource,
            client_secret=client_secret,
            token_endpoint_auth_method=(
                oauth_client.token_endpoint_auth_method if oauth_client else None
            ),
            provider_namespace=definition.namespace,
        )
        granted_scopes = validate_callback_oauth_scopes(
            granted_scopes=token.scopes,
            requested_scopes=requested_scopes,
            configured_scopes=config.oauth_scopes,
            scope_policy=config.oauth_scope_policy,
        )
    except IntegrationOAuthProviderError as exc:
        if _should_drop_cached_oauth_client_on_token_error(exc.code) and oauth_client is not None:
            await retire_oauth_client(db, oauth_client.id)
        return await _fail_attempt_and_flow(db, flow=flow, failure_code=exc.code)
    except OAuthScopePolicyError as exc:
        return await _fail_attempt_and_flow(db, flow=flow, failure_code=exc.code)

    updated = await set_account_credentials(
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
                scopes=granted_scopes,
                token_endpoint=flow.token_endpoint,
                revocation_endpoint=flow.revocation_endpoint,
                redirect_uri=flow.redirect_uri,
            ),
            secret=app_settings.cloud_secret_key,
        ),
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=token.expires_at,
    )
    if updated is None:
        return await _fail_attempt_and_flow(
            db,
            flow=flow,
            failure_code="account_missing",
        )
    completed = await complete_oauth_flow(db, flow_id=flow.id) or flow
    return _callback_result(completed, ok=True, status="completed")


def _attempt_flow_is_consistent(
    *,
    attempt: IntegrationAuthorizationAttemptRecord,
    flow: IntegrationOAuthFlowRecord,
    client_id: UUID,
    client_definition_id: UUID,
    client_issuer: str,
    client_redirect_uri: str,
    client_resource: str | None,
    client_public_id: str,
) -> bool:
    return (
        attempt.method == "oauth2"
        and attempt.owner_user_id == flow.owner_user_id
        and attempt.definition_id == flow.definition_id
        and attempt.account_id == flow.account_id
        and attempt.provider_client_id == client_id
        and client_definition_id == flow.definition_id
        and client_issuer == flow.issuer
        and client_redirect_uri == flow.redirect_uri
        and client_resource == flow.resource
        and client_public_id == flow.client_id
        and flow.resource == attempt.credential_audience
        and flow.requested_scopes == attempt.requested_scopes_json
    )


async def complete_oauth_callback(
    db: AsyncSession,
    *,
    state: str,
    code: str | None,
    provider_error: str | None = None,
) -> OAuthCallbackResult:
    """Exchange a candidate outside the transaction, then generation-CAS commit it."""

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
        return await _fail_attempt_and_flow(
            db,
            flow=flow,
            failure_code=failure_code,
        )
    if not code:
        return await _fail_attempt_and_flow(
            db,
            flow=flow,
            failure_code="invalid_callback",
        )
    if _oauth_flow_is_expired(expires_at=flow.expires_at, now=datetime.now(UTC)):
        if flow.attempt_id is not None:
            await terminalize_authorization_attempt(
                db,
                attempt_id=flow.attempt_id,
                status="expired",
                failure_code="expired",
            )
        expired = await expire_oauth_flow(db, flow_id=flow.id) or flow
        return _callback_result(expired, ok=False, status="expired")
    if flow.attempt_id is None:
        return await _complete_legacy_oauth_callback(db, flow=flow, code=code)
    if not flow.token_endpoint or not flow.resource:
        return await _fail_attempt_and_flow(db, flow=flow, failure_code="invalid_flow")

    attempt = await claim_authorization_attempt(
        db,
        attempt_id=flow.attempt_id,
        from_status="active",
        to_status="exchanging",
    )
    if attempt is None:
        stored_attempt = await get_authorization_attempt(db, flow.attempt_id)
        failure_code = (
            "expired"
            if stored_attempt is not None and stored_attempt.status == "expired"
            else "stale_attempt"
        )
        return await _fail_attempt_and_flow(
            db,
            flow=flow,
            failure_code=failure_code,
            attempt_status=("expired" if failure_code == "expired" else "superseded"),
        )

    definition = await get_definition(db, flow.definition_id)
    security_revision = await get_definition_security_revision_by_id(
        db,
        attempt.definition_security_revision_id,
    )
    oauth_client = (
        await get_oauth_client_by_id(db, attempt.provider_client_id)
        if attempt.provider_client_id is not None
        else None
    )
    try:
        if (
            definition is None
            or security_revision is None
            or oauth_client is None
            or security_revision.definition_id != flow.definition_id
            or security_revision.auth_kind != "oauth2"
            or not _attempt_flow_is_consistent(
                attempt=attempt,
                flow=flow,
                client_id=oauth_client.id,
                client_definition_id=oauth_client.definition_id,
                client_issuer=oauth_client.issuer,
                client_redirect_uri=oauth_client.redirect_uri,
                client_resource=oauth_client.resource,
                client_public_id=oauth_client.client_id,
            )
        ):
            raise ValueError("OAuth attempt pins do not match its flow.")
        config = parse_definition_config(security_revision.config_json)
        requested_scopes = _parse_requested_scopes(attempt.requested_scopes_json)
        verifier = decrypt_text(
            flow.code_verifier_ciphertext,
            secret=app_settings.cloud_secret_key,
        )
        client_secret = (
            decrypt_text(
                oauth_client.client_secret_ciphertext,
                secret=app_settings.cloud_secret_key,
            )
            if oauth_client.client_secret_ciphertext
            else None
        )
    except (json.JSONDecodeError, ValueError):
        return await _fail_attempt_and_flow(db, flow=flow, failure_code="invalid_flow")

    await integration_transactions.release_integration_transaction(db)
    try:
        token = await exchange_token(
            token_endpoint=flow.token_endpoint,
            client_id=flow.client_id,
            code=code,
            code_verifier=verifier,
            redirect_uri=flow.redirect_uri,
            resource=flow.resource,
            client_secret=client_secret,
            token_endpoint_auth_method=oauth_client.token_endpoint_auth_method,
            provider_namespace=definition.namespace,
        )
    except IntegrationOAuthProviderError as exc:
        if _should_drop_cached_oauth_client_on_token_error(exc.code):
            await retire_oauth_client(db, oauth_client.id)
        return await _fail_attempt_and_flow(db, flow=flow, failure_code=exc.code)
    except Exception:
        # The attempt was durably claimed as exchanging before provider I/O.
        # Transport, decoding, and malformed-response failures must therefore
        # close it just like a typed provider rejection; otherwise reconnect is
        # blocked behind an apparently pending attempt until expiry.
        return await _fail_attempt_and_flow(
            db,
            flow=flow,
            failure_code="token_request_failed",
        )

    try:
        granted_scopes = validate_callback_oauth_scopes(
            granted_scopes=token.scopes,
            requested_scopes=requested_scopes,
            configured_scopes=config.oauth_scopes,
            scope_policy=config.oauth_scope_policy,
        )
    except OAuthScopePolicyError as exc:
        return await _fail_attempt_and_flow(db, flow=flow, failure_code=exc.code)

    staged = await stage_authorization_credential(
        db,
        attempt_id=attempt.id,
        expected_status="exchanging",
        credential_ciphertext=encrypt_json(
            _build_oauth_bundle(
                issuer=flow.issuer,
                resource=flow.resource,
                client_id=flow.client_id,
                access_token=token.access_token,
                refresh_token=token.refresh_token,
                expires_at=token.expires_at,
                scopes=granted_scopes,
                token_endpoint=flow.token_endpoint,
                revocation_endpoint=flow.revocation_endpoint,
                redirect_uri=flow.redirect_uri,
            ),
            secret=app_settings.cloud_secret_key,
        ),
        credential_format="oauth-bundle-v1",
        effective_scopes_json=json.dumps(list(granted_scopes)),
    )
    if staged is None:
        return await _fail_attempt_and_flow(
            db,
            flow=flow,
            failure_code="stale_attempt",
            attempt_status="superseded",
        )
    committed = await commit_authorization_attempt(
        db,
        attempt_id=attempt.id,
        token_expires_at=token.expires_at,
    )
    if committed is None:
        return await _fail_attempt_and_flow(
            db,
            flow=flow,
            failure_code="stale_attempt",
            attempt_status="superseded",
        )
    completed = await complete_oauth_flow(db, flow_id=flow.id) or flow
    return _callback_result(completed, ok=True, status="completed")
