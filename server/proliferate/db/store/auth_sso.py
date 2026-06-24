"""Persistence helpers for SSO connections, challenges, and identities."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
from proliferate.db.models.auth import SsoChallenge, SsoConnection, SsoIdentity
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.db.store.auth_sso_records import (
    SsoChallengeRecord,
    SsoConnectionRecord,
    SsoIdentityRecord,
    json_list,
    sso_challenge_record,
    sso_connection_record,
    sso_identity_record,
)
from proliferate.utils.crypto import encrypt_text


def _now() -> datetime:
    return datetime.now(UTC)


async def list_sso_connections_for_organization(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> list[SsoConnectionRecord]:
    rows = (
        await db.execute(
            select(SsoConnection)
            .where(
                SsoConnection.scope == "organization",
                SsoConnection.organization_id == organization_id,
                SsoConnection.deleted_at.is_(None),
            )
            .order_by(SsoConnection.created_at.asc())
        )
    ).scalars()
    return [sso_connection_record(row) for row in rows]


async def get_sso_connection(
    db: AsyncSession,
    *,
    connection_id: UUID,
    organization_id: UUID | None = None,
    include_deleted: bool = False,
    for_update: bool = False,
) -> SsoConnectionRecord | None:
    query = select(SsoConnection).where(SsoConnection.id == connection_id)
    if organization_id is not None:
        query = query.where(SsoConnection.organization_id == organization_id)
    if not include_deleted:
        query = query.where(SsoConnection.deleted_at.is_(None))
    if for_update:
        query = query.with_for_update()
    row = (await db.execute(query)).scalar_one_or_none()
    return sso_connection_record(row) if row is not None else None


async def find_enabled_sso_connection_for_domain(
    db: AsyncSession,
    *,
    domain: str,
) -> SsoConnectionRecord | None:
    normalized_domain = domain.strip().lower()
    rows = (
        await db.execute(
            select(SsoConnection)
            .where(
                SsoConnection.scope == "organization",
                SsoConnection.status == "enabled",
                SsoConnection.deleted_at.is_(None),
            )
            .order_by(SsoConnection.created_at.asc())
        )
    ).scalars()
    for row in rows:
        record = sso_connection_record(row)
        allowed = {item.strip().lower() for item in record.allowed_domains}
        if normalized_domain in allowed:
            return record
    return None


async def create_sso_connection(
    db: AsyncSession,
    *,
    organization_id: UUID,
    protocol: str,
    display_name: str,
    login_policy: str,
    jit_policy: str,
    default_role: str,
    allowed_domains: tuple[str, ...],
    oidc_issuer_url: str | None,
    oidc_discovery_url: str | None,
    oidc_authorization_endpoint: str | None,
    oidc_token_endpoint: str | None,
    oidc_jwks_uri: str | None,
    oidc_userinfo_endpoint: str | None,
    oidc_client_id: str | None,
    oidc_client_secret: str | None,
    oidc_scopes: tuple[str, ...],
    oidc_token_endpoint_auth_method: str,
    saml_idp_metadata_url: str | None,
    saml_idp_metadata_xml: str | None,
    saml_idp_entity_id: str | None,
    saml_sso_url: str | None,
    saml_x509_cert: str | None,
    saml_email_attribute: str | None,
    actor_user_id: UUID,
) -> SsoConnectionRecord:
    now = _now()
    connection = SsoConnection(
        scope="organization",
        organization_id=organization_id,
        protocol=protocol,
        status="draft",
        display_name=display_name,
        login_policy=login_policy,
        jit_policy=jit_policy,
        default_role=default_role,
        allowed_domains_json=json_list(allowed_domains),
        oidc_issuer_url=oidc_issuer_url,
        oidc_discovery_url=oidc_discovery_url,
        oidc_authorization_endpoint=oidc_authorization_endpoint,
        oidc_token_endpoint=oidc_token_endpoint,
        oidc_jwks_uri=oidc_jwks_uri,
        oidc_userinfo_endpoint=oidc_userinfo_endpoint,
        oidc_client_id=oidc_client_id,
        oidc_client_secret_ciphertext=encrypt_text(oidc_client_secret)
        if oidc_client_secret
        else None,
        oidc_scopes_json=json_list(oidc_scopes),
        oidc_token_endpoint_auth_method=oidc_token_endpoint_auth_method,
        saml_idp_metadata_url=saml_idp_metadata_url,
        saml_idp_metadata_xml_ciphertext=(
            encrypt_text(saml_idp_metadata_xml) if saml_idp_metadata_xml else None
        ),
        saml_idp_entity_id=saml_idp_entity_id,
        saml_sso_url=saml_sso_url,
        saml_x509_cert_ciphertext=encrypt_text(saml_x509_cert) if saml_x509_cert else None,
        saml_email_attribute=saml_email_attribute,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(connection)
    await db.flush()
    return sso_connection_record(connection)


async def update_sso_connection(
    db: AsyncSession,
    *,
    connection_id: UUID,
    organization_id: UUID,
    values: dict[str, object],
    actor_user_id: UUID,
) -> SsoConnectionRecord | None:
    row = (
        await db.execute(
            select(SsoConnection)
            .where(
                SsoConnection.id == connection_id,
                SsoConnection.organization_id == organization_id,
                SsoConnection.deleted_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None

    if "display_name" in values:
        row.display_name = str(values["display_name"])
    if "login_policy" in values:
        row.login_policy = str(values["login_policy"])
    if "jit_policy" in values:
        row.jit_policy = str(values["jit_policy"])
    if "default_role" in values:
        row.default_role = str(values["default_role"])
    if "allowed_domains" in values:
        row.allowed_domains_json = json_list(values["allowed_domains"])  # type: ignore[arg-type]
    if "oidc_issuer_url" in values:
        row.oidc_issuer_url = values["oidc_issuer_url"]  # type: ignore[assignment]
    if "oidc_discovery_url" in values:
        row.oidc_discovery_url = values["oidc_discovery_url"]  # type: ignore[assignment]
    if "oidc_authorization_endpoint" in values:
        row.oidc_authorization_endpoint = values["oidc_authorization_endpoint"]  # type: ignore[assignment]
    if "oidc_token_endpoint" in values:
        row.oidc_token_endpoint = values["oidc_token_endpoint"]  # type: ignore[assignment]
    if "oidc_jwks_uri" in values:
        row.oidc_jwks_uri = values["oidc_jwks_uri"]  # type: ignore[assignment]
    if "oidc_userinfo_endpoint" in values:
        row.oidc_userinfo_endpoint = values["oidc_userinfo_endpoint"]  # type: ignore[assignment]
    if "oidc_client_id" in values:
        row.oidc_client_id = values["oidc_client_id"]  # type: ignore[assignment]
    if "oidc_client_secret" in values:
        secret = values["oidc_client_secret"]
        row.oidc_client_secret_ciphertext = encrypt_text(str(secret)) if secret else None
    if "oidc_scopes" in values:
        row.oidc_scopes_json = json_list(values["oidc_scopes"])  # type: ignore[arg-type]
    if "oidc_token_endpoint_auth_method" in values:
        row.oidc_token_endpoint_auth_method = str(values["oidc_token_endpoint_auth_method"])
    if "saml_idp_metadata_url" in values:
        row.saml_idp_metadata_url = values["saml_idp_metadata_url"]  # type: ignore[assignment]
    if "saml_idp_metadata_xml" in values:
        metadata_xml = values["saml_idp_metadata_xml"]
        row.saml_idp_metadata_xml_ciphertext = (
            encrypt_text(str(metadata_xml)) if metadata_xml else None
        )
    if "saml_idp_entity_id" in values:
        row.saml_idp_entity_id = values["saml_idp_entity_id"]  # type: ignore[assignment]
    if "saml_sso_url" in values:
        row.saml_sso_url = values["saml_sso_url"]  # type: ignore[assignment]
    if "saml_x509_cert" in values:
        x509_cert = values["saml_x509_cert"]
        row.saml_x509_cert_ciphertext = encrypt_text(str(x509_cert)) if x509_cert else None
    if "saml_email_attribute" in values:
        row.saml_email_attribute = values["saml_email_attribute"]  # type: ignore[assignment]

    row.updated_by_user_id = actor_user_id
    row.updated_at = _now()
    await db.flush()
    return sso_connection_record(row)


async def set_sso_connection_status(
    db: AsyncSession,
    *,
    connection_id: UUID,
    organization_id: UUID,
    status: str,
    actor_user_id: UUID,
    last_error: str | None = None,
) -> SsoConnectionRecord | None:
    row = (
        await db.execute(
            select(SsoConnection)
            .where(
                SsoConnection.id == connection_id,
                SsoConnection.organization_id == organization_id,
                SsoConnection.deleted_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.status = status
    row.updated_by_user_id = actor_user_id
    row.last_error = last_error
    row.updated_at = _now()
    await db.flush()
    return sso_connection_record(row)


async def mark_sso_connection_test_result(
    db: AsyncSession,
    *,
    connection_id: UUID,
    organization_id: UUID,
    success: bool,
    error: str | None,
    discovered: dict[str, str | None] | None,
    actor_user_id: UUID,
) -> SsoConnectionRecord | None:
    row = (
        await db.execute(
            select(SsoConnection)
            .where(
                SsoConnection.id == connection_id,
                SsoConnection.organization_id == organization_id,
                SsoConnection.deleted_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if discovered:
        row.oidc_issuer_url = discovered.get("issuer") or row.oidc_issuer_url
        row.oidc_authorization_endpoint = (
            discovered.get("authorization_endpoint") or row.oidc_authorization_endpoint
        )
        row.oidc_token_endpoint = discovered.get("token_endpoint") or row.oidc_token_endpoint
        row.oidc_jwks_uri = discovered.get("jwks_uri") or row.oidc_jwks_uri
        row.oidc_userinfo_endpoint = (
            discovered.get("userinfo_endpoint") or row.oidc_userinfo_endpoint
        )
    row.tested_at = _now() if success else row.tested_at
    row.last_error = error
    row.updated_by_user_id = actor_user_id
    row.updated_at = _now()
    await db.flush()
    return sso_connection_record(row)


async def soft_delete_sso_connection(
    db: AsyncSession,
    *,
    connection_id: UUID,
    organization_id: UUID,
    actor_user_id: UUID,
) -> SsoConnectionRecord | None:
    row = (
        await db.execute(
            select(SsoConnection)
            .where(
                SsoConnection.id == connection_id,
                SsoConnection.organization_id == organization_id,
                SsoConnection.deleted_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    now = _now()
    row.status = "disabled"
    row.deleted_at = now
    row.updated_by_user_id = actor_user_id
    row.updated_at = now
    await db.flush()
    return sso_connection_record(row)


async def create_sso_challenge(
    db: AsyncSession,
    *,
    scope: str,
    connection_id: UUID | None,
    connection_key: str,
    organization_id: UUID | None,
    protocol: str,
    surface: str,
    purpose: str,
    state_hash: str,
    nonce_hash: str,
    user_id: UUID | None,
    client_state: str,
    code_challenge: str,
    code_challenge_method: str,
    redirect_uri: str,
    login_hint: str | None,
    expires_at: datetime,
) -> SsoChallengeRecord:
    challenge = SsoChallenge(
        scope=scope,
        connection_id=connection_id,
        connection_key=connection_key,
        organization_id=organization_id,
        protocol=protocol,
        surface=surface,
        purpose=purpose,
        state_hash=state_hash,
        nonce_hash=nonce_hash,
        user_id=user_id,
        client_state=client_state,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        redirect_uri=redirect_uri,
        login_hint=login_hint,
        expires_at=expires_at,
        created_at=_now(),
    )
    db.add(challenge)
    await db.flush()
    return sso_challenge_record(challenge)


async def consume_sso_challenge(
    db: AsyncSession,
    *,
    state_hash: str,
) -> SsoChallengeRecord | None:
    challenge = (
        await db.execute(
            select(SsoChallenge)
            .where(
                SsoChallenge.state_hash == state_hash,
                SsoChallenge.consumed_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if challenge is None:
        return None
    expires_at = (
        challenge.expires_at
        if challenge.expires_at.tzinfo
        else challenge.expires_at.replace(tzinfo=UTC)
    )
    challenge.consumed_at = _now()
    if expires_at < _now():
        await db.flush()
        return None
    await db.flush()
    return sso_challenge_record(challenge)


async def get_sso_identity_by_connection_subject(
    db: AsyncSession,
    *,
    connection_key: str,
    provider_subject: str,
) -> SsoIdentityRecord | None:
    row = (
        await db.execute(
            select(SsoIdentity).where(
                SsoIdentity.connection_key == connection_key,
                SsoIdentity.provider_subject == provider_subject,
            )
        )
    ).scalar_one_or_none()
    return sso_identity_record(row) if row is not None else None


async def upsert_sso_identity_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID | None,
    connection_id: UUID | None,
    connection_key: str,
    protocol: str,
    provider_subject: str,
    email: str | None,
    email_verified: bool,
    display_name: str | None,
) -> SsoIdentityRecord:
    identity = (
        await db.execute(
            select(SsoIdentity)
            .where(
                SsoIdentity.connection_key == connection_key,
                SsoIdentity.provider_subject == provider_subject,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = _now()
    if identity is None:
        identity = SsoIdentity(
            user_id=user_id,
            organization_id=organization_id,
            connection_id=connection_id,
            connection_key=connection_key,
            protocol=protocol,
            provider_subject=provider_subject,
            email=email,
            email_verified=email_verified,
            display_name=display_name,
            linked_at=now,
            last_login_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(identity)
    else:
        if identity.user_id != user_id:
            raise ValueError("SSO identity is already linked to another user.")
        identity.organization_id = organization_id
        identity.connection_id = connection_id
        identity.protocol = protocol
        identity.email = email
        identity.email_verified = email_verified
        identity.display_name = display_name
        identity.last_login_at = now
        identity.updated_at = now
    await db.flush()
    return sso_identity_record(identity)


async def ensure_sso_organization_membership(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    role: str,
) -> str | None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"organization-membership-active-user:{user_id}"},
    )
    active_membership = (
        await db.execute(
            select(OrganizationMembership)
            .where(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if active_membership is not None and active_membership.organization_id != organization_id:
        return "already_in_organization"

    now = _now()
    membership = (
        await db.execute(
            select(OrganizationMembership)
            .where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if membership is None:
        membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            removed_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(membership)
    else:
        membership.role = role
        membership.status = ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
        membership.removed_at = None
        if membership.joined_at is None:
            membership.joined_at = now
        membership.updated_at = now
    await db.flush()
    return None
