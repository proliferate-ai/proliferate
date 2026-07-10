"""SSO auth orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import NoReturn
from uuid import UUID

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity import providers
from proliferate.auth.identity.routing import auth_route_path_for_base
from proliferate.auth.identity.service import (
    AUTH_CHALLENGE_LIFETIME_SECONDS,
    append_query,
    hash_secret,
    validate_redirect_uri,
)
from proliferate.auth.identity.web_beta import ensure_web_beta_email_allowed
from proliferate.auth.sso.deployment_config import deployment_sso_connection
from proliferate.auth.sso.policy import (
    email_domain,
    normalize_domains,
)
from proliferate.auth.sso.types import (
    DEFAULT_OIDC_SCOPES,
    SsoConnectionSnapshot,
    SsoJitPolicy,
    SsoLoginPolicy,
    SsoProtocol,
    SsoScope,
    SsoStatus,
    sso_connection_key,
)
from proliferate.auth.sso.user_resolution import resolve_sso_user
from proliferate.config import settings
from proliferate.constants.auth import SUPPORTED_CODE_CHALLENGE_METHODS
from proliferate.db.models.auth import User
from proliferate.db.store import auth_sso as sso_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.auth import create_auth_code
from proliferate.integrations.sso.errors import SsoIntegrationError
from proliferate.integrations.sso.oidc import (
    build_oidc_authorization_url,
    exchange_oidc_code,
    resolve_oidc_metadata,
    verify_oidc_identity,
)
from proliferate.server.cloud.agent_gateway import signup_hook


@dataclass(frozen=True)
class SsoDiscovery:
    enabled: bool
    scope: SsoScope | None
    connection_id: UUID | None
    organization_id: UUID | None
    protocol: SsoProtocol | None
    display_name: str | None
    reason: str | None = None


@dataclass(frozen=True)
class SsoStart:
    authorization_url: str
    state: str
    nonce: str
    expires_at: datetime
    connection: SsoConnectionSnapshot


# Uniform "no SSO here" answer for slug-driven discovery. A nonexistent slug,
# an org with no SSO, and an org whose SSO is disabled all return this identical
# response so a caller cannot probe which orgs exist by cycling slugs.
_SLUG_UNAVAILABLE = SsoDiscovery(
    enabled=False,
    scope=None,
    connection_id=None,
    organization_id=None,
    protocol=None,
    display_name=None,
    reason="not_available",
)


async def discover_sso(
    db: AsyncSession,
    *,
    email: str | None,
    organization_id: UUID | None = None,
    connection_id: UUID | None = None,
    slug: str | None = None,
) -> SsoDiscovery:
    if slug is not None:
        resolved_organization_id = await _organization_id_for_slug(db, slug)
        if resolved_organization_id is None:
            return _SLUG_UNAVAILABLE
        discovery = await _discover_for_context(
            db,
            email=None,
            organization_id=resolved_organization_id,
            connection_id=None,
        )
        # Only surface the ids needed to start the flow once SSO is actually
        # usable; every other outcome collapses to the generic response.
        return discovery if discovery.enabled else _SLUG_UNAVAILABLE
    return await _discover_for_context(
        db,
        email=email,
        organization_id=organization_id,
        connection_id=connection_id,
    )


async def _organization_id_for_slug(db: AsyncSession, slug: str) -> UUID | None:
    cleaned = slug.strip()
    if not cleaned:
        return None
    organization = await organization_store.get_organization_by_slug(db, cleaned)
    return organization.id if organization is not None else None


async def _discover_for_context(
    db: AsyncSession,
    *,
    email: str | None,
    organization_id: UUID | None,
    connection_id: UUID | None,
) -> SsoDiscovery:
    connection = await _connection_for_start(
        db,
        email=email,
        organization_id=organization_id,
        connection_id=connection_id,
        require_enabled=False,
    )
    if connection is None:
        return SsoDiscovery(
            enabled=False,
            scope=None,
            connection_id=None,
            organization_id=None,
            protocol=None,
            display_name=None,
            reason="not_configured",
        )
    if connection.status != SsoStatus.ENABLED:
        return SsoDiscovery(
            enabled=False,
            scope=connection.scope,
            connection_id=connection.id,
            organization_id=connection.organization_id,
            protocol=connection.protocol,
            display_name=connection.display_name,
            reason=connection.status.value,
        )
    return SsoDiscovery(
        enabled=True,
        scope=connection.scope,
        connection_id=connection.id,
        organization_id=connection.organization_id,
        protocol=connection.protocol,
        display_name=connection.display_name,
    )


async def start_sso_auth(
    db: AsyncSession,
    request: Request,
    *,
    surface: str,
    client_state: str,
    code_challenge: str,
    code_challenge_method: str,
    redirect_uri: str,
    email: str | None,
    organization_id: UUID | None,
    connection_id: UUID | None,
    prompt: str | None,
    user: User | None,
) -> SsoStart:
    if surface not in {"web", "mobile", "desktop"}:
        raise HTTPException(status_code=404, detail="Unknown auth surface.")
    if code_challenge_method not in SUPPORTED_CODE_CHALLENGE_METHODS:
        raise HTTPException(status_code=400, detail="Unsupported code challenge method.")
    validate_redirect_uri(surface, redirect_uri)
    connection = await _connection_for_start(
        db,
        email=email,
        organization_id=organization_id,
        connection_id=connection_id,
        require_enabled=True,
    )
    if connection is None:
        raise HTTPException(status_code=404, detail="SSO is not configured for this account.")
    if connection.protocol != SsoProtocol.OIDC:
        raise HTTPException(status_code=400, detail="Only OIDC SSO is currently supported.")
    _require_oidc_configured(connection)
    try:
        metadata = await resolve_oidc_metadata(connection)
    except SsoIntegrationError as exc:
        _raise_sso_integration_error(exc)

    state = providers.new_secret()
    nonce = providers.new_secret()
    expires_at = datetime.now(UTC) + timedelta(seconds=AUTH_CHALLENGE_LIFETIME_SECONDS)
    await sso_store.create_sso_challenge(
        db,
        scope=connection.scope.value,
        connection_id=connection.id,
        connection_key=connection.connection_key,
        organization_id=connection.organization_id,
        protocol=connection.protocol.value,
        surface=surface,
        purpose="login",
        state_hash=hash_secret(state),
        nonce_hash=hash_secret(nonce),
        user_id=user.id if user is not None else None,
        client_state=client_state,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        redirect_uri=redirect_uri,
        login_hint=email,
        expires_at=expires_at,
    )
    authorization_url = build_oidc_authorization_url(
        metadata=metadata,
        client_id=connection.oidc_client_id or "",
        redirect_uri=oidc_callback_url(request),
        scopes=connection.oidc_scopes or DEFAULT_OIDC_SCOPES,
        state=state,
        nonce=nonce,
        login_hint=email,
        prompt=prompt,
    )
    return SsoStart(
        authorization_url=authorization_url,
        state=state,
        nonce=nonce,
        expires_at=expires_at,
        connection=connection,
    )


async def complete_sso_error_callback(
    db: AsyncSession,
    *,
    state: str,
    error: str,
) -> str:
    challenge = await _consume_challenge(db, state=state)
    return append_query(challenge.redirect_uri, error=error, state=challenge.client_state)


async def complete_oidc_sso_callback(
    db: AsyncSession,
    request: Request,
    *,
    state: str,
    code: str,
) -> str:
    challenge = await _consume_challenge(db, state=state)
    connection = await _connection_for_challenge(db, challenge)
    if connection.protocol != SsoProtocol.OIDC:
        raise HTTPException(status_code=400, detail="SSO callback protocol mismatch.")
    try:
        metadata = await resolve_oidc_metadata(connection)
        token = await exchange_oidc_code(
            metadata=metadata,
            client_id=connection.oidc_client_id or "",
            client_secret=connection.oidc_client_secret,
            token_endpoint_auth_method=connection.oidc_token_endpoint_auth_method,
            code=code,
            redirect_uri=oidc_callback_url(request),
        )
        verified = await verify_oidc_identity(
            connection=connection,
            metadata=metadata,
            token=token,
            nonce_hash=challenge.nonce_hash,
        )
    except SsoIntegrationError as exc:
        _raise_sso_integration_error(exc)
    if challenge.surface == "web" and connection.scope == SsoScope.DEPLOYMENT:
        ensure_web_beta_email_allowed(verified.email)
    user = await resolve_sso_user(db, connection=connection, verified=verified)
    auth_code = await create_auth_code(
        db,
        user_id=user.id,
        code_challenge=challenge.code_challenge,
        code_challenge_method=challenge.code_challenge_method,
        state=challenge.client_state,
        redirect_uri=challenge.redirect_uri,
    )
    signup_hook.schedule_agent_gateway_user_enrollment(user.id, db=db)
    return append_query(challenge.redirect_uri, code=auth_code.code, state=challenge.client_state)


async def test_oidc_connection(
    db: AsyncSession,
    *,
    connection: SsoConnectionSnapshot,
) -> dict[str, str | None]:
    if connection.protocol != SsoProtocol.OIDC:
        raise HTTPException(status_code=400, detail="Only OIDC connection tests are supported.")
    _require_oidc_configured(connection)
    try:
        metadata = await resolve_oidc_metadata(connection)
    except SsoIntegrationError as exc:
        _raise_sso_integration_error(exc)
    return {
        "issuer": metadata.issuer,
        "authorization_endpoint": metadata.authorization_endpoint,
        "token_endpoint": metadata.token_endpoint,
        "jwks_uri": metadata.jwks_uri,
        "userinfo_endpoint": metadata.userinfo_endpoint,
    }


async def _connection_for_start(
    db: AsyncSession,
    *,
    email: str | None,
    organization_id: UUID | None,
    connection_id: UUID | None,
    require_enabled: bool,
) -> SsoConnectionSnapshot | None:
    if connection_id is not None:
        record = await sso_store.get_sso_connection(
            db,
            connection_id=connection_id,
            organization_id=organization_id,
        )
        connection = snapshot_from_sso_connection_record(record) if record is not None else None
    elif organization_id is not None:
        records = await sso_store.list_sso_connections_for_organization(
            db,
            organization_id=organization_id,
        )
        connection = _first_enabled_or_first(records)
    elif email is not None:
        connection = deployment_sso_connection()
    else:
        connection = deployment_sso_connection()

    if connection is None:
        return None
    if require_enabled and connection.status != SsoStatus.ENABLED:
        raise HTTPException(status_code=403, detail="SSO connection is not enabled.")
    if email and not _email_hint_allowed_for_discovery(email, connection.allowed_domains):
        raise HTTPException(status_code=403, detail="Email domain is not allowed for this SSO.")
    return connection


async def _connection_for_challenge(
    db: AsyncSession,
    challenge: sso_store.SsoChallengeRecord,
) -> SsoConnectionSnapshot:
    if challenge.scope == SsoScope.DEPLOYMENT.value:
        connection = deployment_sso_connection()
    else:
        if challenge.connection_id is None:
            raise HTTPException(status_code=400, detail="SSO challenge is missing connection.")
        record = await sso_store.get_sso_connection(db, connection_id=challenge.connection_id)
        connection = snapshot_from_sso_connection_record(record) if record is not None else None
    if connection is None:
        raise HTTPException(status_code=400, detail="SSO connection is no longer available.")
    if connection.status != SsoStatus.ENABLED:
        raise HTTPException(status_code=403, detail="SSO connection is not enabled.")
    if connection.connection_key != challenge.connection_key:
        raise HTTPException(status_code=400, detail="SSO callback state mismatch.")
    return connection


async def _consume_challenge(
    db: AsyncSession,
    *,
    state: str,
) -> sso_store.SsoChallengeRecord:
    challenge = await sso_store.consume_sso_challenge(db, state_hash=hash_secret(state))
    if challenge is None:
        raise HTTPException(status_code=400, detail="Invalid or expired SSO state.")
    return challenge


def snapshot_from_sso_connection_record(
    record: sso_store.SsoConnectionRecord | None,
) -> SsoConnectionSnapshot | None:
    if record is None:
        return None
    scope = SsoScope(record.scope)
    return SsoConnectionSnapshot(
        id=record.id,
        scope=scope,
        organization_id=record.organization_id,
        connection_key=sso_connection_key(scope=scope, connection_id=record.id),
        protocol=SsoProtocol(record.protocol),
        status=SsoStatus(record.status),
        display_name=record.display_name,
        login_policy=SsoLoginPolicy(record.login_policy),
        jit_policy=SsoJitPolicy(record.jit_policy),
        default_role=record.default_role,
        allowed_domains=normalize_domains(record.allowed_domains),
        oidc_issuer_url=record.oidc_issuer_url,
        oidc_discovery_url=record.oidc_discovery_url,
        oidc_authorization_endpoint=record.oidc_authorization_endpoint,
        oidc_token_endpoint=record.oidc_token_endpoint,
        oidc_jwks_uri=record.oidc_jwks_uri,
        oidc_userinfo_endpoint=record.oidc_userinfo_endpoint,
        oidc_client_id=record.oidc_client_id,
        oidc_client_secret=record.oidc_client_secret,
        oidc_client_secret_configured=record.oidc_client_secret_configured,
        oidc_scopes=record.oidc_scopes or DEFAULT_OIDC_SCOPES,
        oidc_token_endpoint_auth_method=record.oidc_token_endpoint_auth_method,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _first_enabled_or_first(
    records: list[sso_store.SsoConnectionRecord],
) -> SsoConnectionSnapshot | None:
    enabled = [record for record in records if record.status == SsoStatus.ENABLED.value]
    selected = enabled[0] if enabled else records[0] if records else None
    return snapshot_from_sso_connection_record(selected)


def _require_oidc_configured(
    connection: SsoConnectionSnapshot,
    *,
    require_secret: bool = True,
) -> None:
    if not connection.oidc_client_id:
        raise HTTPException(status_code=400, detail="OIDC client ID is required.")
    if (
        require_secret
        and not connection.oidc_client_secret
        and (connection.oidc_token_endpoint_auth_method != "none")
    ):
        raise HTTPException(status_code=400, detail="OIDC client secret is required.")
    has_static_endpoints = (
        connection.oidc_issuer_url
        and connection.oidc_authorization_endpoint
        and connection.oidc_token_endpoint
        and connection.oidc_jwks_uri
    )
    if not has_static_endpoints and not (
        connection.oidc_issuer_url or connection.oidc_discovery_url
    ):
        raise HTTPException(status_code=400, detail="OIDC issuer or discovery URL is required.")


def _email_hint_allowed_for_discovery(email: str, allowed_domains: tuple[str, ...]) -> bool:
    if not allowed_domains:
        return True
    return email_domain(email) in {domain.lower() for domain in allowed_domains}


def _raise_sso_integration_error(exc: SsoIntegrationError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def oidc_callback_url(request: Request) -> str:
    base = settings.sso_oidc_callback_base_url.strip().rstrip("/")
    if not base:
        base = settings.api_base_url.strip().rstrip("/")
    if not base:
        base = str(request.base_url).rstrip("/")
    path = auth_route_path_for_base("/auth/sso/oidc/callback", base_url=base)
    return f"{base}{path}"
