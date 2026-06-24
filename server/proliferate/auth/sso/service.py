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
from proliferate.auth.identity.store import (
    create_auth_user,
    get_user_by_email,
    get_user_by_id,
)
from proliferate.auth.identity.web_beta import ensure_web_beta_email_allowed
from proliferate.auth.sso.deployment_config import deployment_sso_connection
from proliferate.auth.sso.policy import (
    email_domain,
    normalize_domains,
    require_email_domain_allowed,
)
from proliferate.auth.sso.types import (
    DEFAULT_OIDC_SCOPES,
    SsoConnectionSnapshot,
    SsoJitPolicy,
    SsoLoginPolicy,
    SsoProtocol,
    SsoScope,
    SsoStatus,
    VerifiedSsoIdentity,
    sso_connection_key,
)
from proliferate.config import settings
from proliferate.constants.auth import SUPPORTED_CODE_CHALLENGE_METHODS
from proliferate.constants.organizations import ORGANIZATION_ROLE_MEMBER
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


async def discover_sso(
    db: AsyncSession,
    *,
    email: str | None,
    organization_id: UUID | None = None,
    connection_id: UUID | None = None,
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
        redirect_uri=_oidc_callback_url(request),
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
            redirect_uri=_oidc_callback_url(request),
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
    return append_query(challenge.redirect_uri, code=auth_code.code, state=challenge.client_state)


async def resolve_sso_user(
    db: AsyncSession,
    *,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
) -> User:
    _require_verified_allowed_email(connection=connection, verified=verified)
    existing_identity = await sso_store.get_sso_identity_by_connection_subject(
        db,
        connection_key=connection.connection_key,
        provider_subject=verified.provider_subject,
    )
    if existing_identity is not None:
        user = await get_user_by_id(db, existing_identity.user_id)
        if user is None:
            raise HTTPException(status_code=400, detail="Linked SSO user not found.")
        _ensure_active_user(user)
        await _attach_sso_identity(db, user=user, connection=connection, verified=verified)
        return user

    user = await get_user_by_email(db, verified.email)
    if connection.scope == SsoScope.ORGANIZATION:
        if connection.organization_id is None:
            raise HTTPException(status_code=400, detail="SSO organization is missing.")
        user = await _resolve_organization_sso_user(
            db,
            connection=connection,
            verified=verified,
            user=user,
        )
    else:
        if user is None:
            user = await create_auth_user(
                db,
                email=verified.email,
                display_name=verified.display_name,
                avatar_url=verified.avatar_url,
            )
        _ensure_active_user(user)

    await _attach_sso_identity(db, user=user, connection=connection, verified=verified)
    return user


def _require_verified_allowed_email(
    *,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
) -> None:
    if not verified.email:
        raise HTTPException(status_code=400, detail="SSO did not return an email address.")
    if not verified.email_verified:
        raise HTTPException(status_code=403, detail="SSO email address is not verified.")
    require_email_domain_allowed(verified.email, connection.allowed_domains)


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


async def _resolve_organization_sso_user(
    db: AsyncSession,
    *,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
    user: User | None,
) -> User:
    if connection.organization_id is None:
        raise HTTPException(status_code=400, detail="SSO organization is missing.")
    if user is None:
        if connection.jit_policy != SsoJitPolicy.CREATE_MEMBER:
            raise HTTPException(status_code=403, detail="SSO user is not a team member.")
        user = await create_auth_user(
            db,
            email=verified.email or "",
            display_name=verified.display_name,
            avatar_url=verified.avatar_url,
        )
    _ensure_active_user(user)
    membership = await organization_store.get_active_membership(
        db,
        organization_id=connection.organization_id,
        user_id=user.id,
    )
    if membership is not None:
        return user
    if connection.jit_policy != SsoJitPolicy.CREATE_MEMBER:
        raise HTTPException(status_code=403, detail="SSO user is not a team member.")
    error = await sso_store.ensure_sso_organization_membership(
        db,
        organization_id=connection.organization_id,
        user_id=user.id,
        role=connection.default_role or ORGANIZATION_ROLE_MEMBER,
    )
    if error == "already_in_organization":
        raise HTTPException(status_code=409, detail="User already belongs to another team.")
    return user


async def _attach_sso_identity(
    db: AsyncSession,
    *,
    user: User,
    connection: SsoConnectionSnapshot,
    verified: VerifiedSsoIdentity,
) -> None:
    await sso_store.upsert_sso_identity_for_user(
        db,
        user_id=user.id,
        organization_id=connection.organization_id,
        connection_id=connection.id,
        connection_key=connection.connection_key,
        protocol=connection.protocol.value,
        provider_subject=verified.provider_subject,
        email=verified.email,
        email_verified=verified.email_verified,
        display_name=verified.display_name,
    )
    if verified.display_name and not user.display_name:
        user.display_name = verified.display_name
    if verified.avatar_url and not user.avatar_url:
        user.avatar_url = verified.avatar_url
    await db.flush()


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


def _ensure_active_user(user: User) -> None:
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive.")


def _raise_sso_integration_error(exc: SsoIntegrationError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _oidc_callback_url(request: Request) -> str:
    base = settings.api_base_url.strip().rstrip("/")
    if not base:
        base = str(request.base_url).rstrip("/")
    path = auth_route_path_for_base("/auth/sso/oidc/callback", base_url=base)
    return f"{base}{path}"
