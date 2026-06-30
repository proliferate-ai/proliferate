"""Read models and converters for SSO persistence."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from proliferate.db.models.auth import SsoChallenge, SsoConnection, SsoIdentity
from proliferate.utils.crypto import decrypt_text


@dataclass(frozen=True)
class SsoConnectionRecord:
    id: UUID
    scope: str
    organization_id: UUID | None
    protocol: str
    status: str
    display_name: str
    login_policy: str
    jit_policy: str
    default_role: str
    allowed_domains: tuple[str, ...]
    oidc_issuer_url: str | None
    oidc_discovery_url: str | None
    oidc_authorization_endpoint: str | None
    oidc_token_endpoint: str | None
    oidc_jwks_uri: str | None
    oidc_userinfo_endpoint: str | None
    oidc_client_id: str | None
    oidc_client_secret: str | None
    oidc_client_secret_configured: bool
    oidc_scopes: tuple[str, ...]
    oidc_token_endpoint_auth_method: str
    saml_idp_metadata_url: str | None
    saml_idp_metadata_xml_configured: bool
    saml_idp_entity_id: str | None
    saml_sso_url: str | None
    saml_x509_cert_configured: bool
    saml_email_attribute: str | None
    created_by_user_id: UUID | None
    updated_by_user_id: UUID | None
    tested_at: datetime | None
    last_error: str | None
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class SsoChallengeRecord:
    id: UUID
    scope: str
    connection_id: UUID | None
    connection_key: str
    organization_id: UUID | None
    protocol: str
    surface: str
    purpose: str
    user_id: UUID | None
    client_state: str
    code_challenge: str
    code_challenge_method: str
    redirect_uri: str
    nonce_hash: str
    login_hint: str | None
    expires_at: datetime


@dataclass(frozen=True)
class SsoIdentityRecord:
    id: UUID
    user_id: UUID
    organization_id: UUID | None
    connection_id: UUID | None
    connection_key: str
    protocol: str
    provider_subject: str
    email: str | None
    email_verified: bool
    display_name: str | None
    linked_at: datetime
    last_login_at: datetime | None


def json_list(values: tuple[str, ...] | list[str] | None) -> str:
    return json.dumps(list(values or ()), separators=(",", ":"))


def parse_json_list(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return ()
    if not isinstance(parsed, list):
        return ()
    return tuple(item for item in parsed if isinstance(item, str))


def sso_connection_record(connection: SsoConnection) -> SsoConnectionRecord:
    client_secret = (
        decrypt_text(connection.oidc_client_secret_ciphertext)
        if connection.oidc_client_secret_ciphertext
        else None
    )
    return SsoConnectionRecord(
        id=connection.id,
        scope=connection.scope,
        organization_id=connection.organization_id,
        protocol=connection.protocol,
        status=connection.status,
        display_name=connection.display_name,
        login_policy=connection.login_policy,
        jit_policy=connection.jit_policy,
        default_role=connection.default_role,
        allowed_domains=parse_json_list(connection.allowed_domains_json),
        oidc_issuer_url=connection.oidc_issuer_url,
        oidc_discovery_url=connection.oidc_discovery_url,
        oidc_authorization_endpoint=connection.oidc_authorization_endpoint,
        oidc_token_endpoint=connection.oidc_token_endpoint,
        oidc_jwks_uri=connection.oidc_jwks_uri,
        oidc_userinfo_endpoint=connection.oidc_userinfo_endpoint,
        oidc_client_id=connection.oidc_client_id,
        oidc_client_secret=client_secret,
        oidc_client_secret_configured=bool(connection.oidc_client_secret_ciphertext),
        oidc_scopes=parse_json_list(connection.oidc_scopes_json),
        oidc_token_endpoint_auth_method=connection.oidc_token_endpoint_auth_method,
        saml_idp_metadata_url=connection.saml_idp_metadata_url,
        saml_idp_metadata_xml_configured=bool(connection.saml_idp_metadata_xml_ciphertext),
        saml_idp_entity_id=connection.saml_idp_entity_id,
        saml_sso_url=connection.saml_sso_url,
        saml_x509_cert_configured=bool(connection.saml_x509_cert_ciphertext),
        saml_email_attribute=connection.saml_email_attribute,
        created_by_user_id=connection.created_by_user_id,
        updated_by_user_id=connection.updated_by_user_id,
        tested_at=connection.tested_at,
        last_error=connection.last_error,
        deleted_at=connection.deleted_at,
        created_at=connection.created_at,
        updated_at=connection.updated_at,
    )


def sso_challenge_record(challenge: SsoChallenge) -> SsoChallengeRecord:
    return SsoChallengeRecord(
        id=challenge.id,
        scope=challenge.scope,
        connection_id=challenge.connection_id,
        connection_key=challenge.connection_key,
        organization_id=challenge.organization_id,
        protocol=challenge.protocol,
        surface=challenge.surface,
        purpose=challenge.purpose,
        user_id=challenge.user_id,
        client_state=challenge.client_state,
        code_challenge=challenge.code_challenge,
        code_challenge_method=challenge.code_challenge_method,
        redirect_uri=challenge.redirect_uri,
        nonce_hash=challenge.nonce_hash,
        login_hint=challenge.login_hint,
        expires_at=challenge.expires_at,
    )


def sso_identity_record(identity: SsoIdentity) -> SsoIdentityRecord:
    return SsoIdentityRecord(
        id=identity.id,
        user_id=identity.user_id,
        organization_id=identity.organization_id,
        connection_id=identity.connection_id,
        connection_key=identity.connection_key,
        protocol=identity.protocol,
        provider_subject=identity.provider_subject,
        email=identity.email,
        email_verified=identity.email_verified,
        display_name=identity.display_name,
        linked_at=identity.linked_at,
        last_login_at=identity.last_login_at,
    )
