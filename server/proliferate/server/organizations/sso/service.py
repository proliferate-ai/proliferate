"""Organization SSO administration service."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import OwnerContext, require_org_role
from proliferate.auth.identity.routing import auth_route_path_for_base
from proliferate.auth.sso.policy import normalize_domains
from proliferate.auth.sso.service import (
    snapshot_from_sso_connection_record,
    test_oidc_connection,
)
from proliferate.config import settings
from proliferate.db.store import auth_sso as sso_store
from proliferate.db.store import organizations as organization_store
from proliferate.errors import NotFoundError
from proliferate.server.organizations.domain.policy import organization_admin_roles
from proliferate.server.organizations.sso.models import (
    OrganizationSsoConnectionRequest,
    OrganizationSsoConnectionUpdateRequest,
)


class OrganizationSsoActor(Protocol):
    id: UUID


async def list_organization_sso_connections(
    db: AsyncSession,
    *,
    actor_user: OrganizationSsoActor,
    organization_id: UUID,
) -> list[sso_store.SsoConnectionRecord]:
    await _require_org_admin(db, actor_user=actor_user, organization_id=organization_id)
    return await sso_store.list_sso_connections_for_organization(
        db,
        organization_id=organization_id,
    )


async def create_organization_sso_connection(
    db: AsyncSession,
    *,
    actor_user: OrganizationSsoActor,
    organization_id: UUID,
    body: OrganizationSsoConnectionRequest,
) -> sso_store.SsoConnectionRecord:
    await _require_org_admin(db, actor_user=actor_user, organization_id=organization_id)
    return await sso_store.create_sso_connection(
        db,
        organization_id=organization_id,
        protocol=body.protocol,
        display_name=_clean_display_name(body.display_name),
        login_policy=_clean_login_policy(body.login_policy),
        jit_policy=body.jit_policy,
        default_role=_clean_default_role(body.default_role),
        allowed_domains=normalize_domains(body.allowed_domains),
        oidc_issuer_url=_clean_optional(body.oidc_issuer_url),
        oidc_discovery_url=_clean_optional(body.oidc_discovery_url),
        oidc_authorization_endpoint=_clean_optional(body.oidc_authorization_endpoint),
        oidc_token_endpoint=_clean_optional(body.oidc_token_endpoint),
        oidc_jwks_uri=_clean_optional(body.oidc_jwks_uri),
        oidc_userinfo_endpoint=_clean_optional(body.oidc_userinfo_endpoint),
        oidc_client_id=_clean_optional(body.oidc_client_id),
        oidc_client_secret=_clean_optional(body.oidc_client_secret),
        oidc_scopes=tuple(scope for scope in body.oidc_scopes if scope.strip()),
        oidc_token_endpoint_auth_method=body.oidc_token_endpoint_auth_method,
        saml_idp_metadata_url=_clean_optional(body.saml_idp_metadata_url),
        saml_idp_metadata_xml=_clean_optional(body.saml_idp_metadata_xml),
        saml_idp_entity_id=_clean_optional(body.saml_idp_entity_id),
        saml_sso_url=_clean_optional(body.saml_sso_url),
        saml_x509_cert=_clean_optional(body.saml_x509_cert),
        saml_email_attribute=_clean_optional(body.saml_email_attribute),
        actor_user_id=actor_user.id,
    )


async def update_organization_sso_connection(
    db: AsyncSession,
    *,
    actor_user: OrganizationSsoActor,
    organization_id: UUID,
    connection_id: UUID,
    body: OrganizationSsoConnectionUpdateRequest,
) -> sso_store.SsoConnectionRecord:
    await _require_org_admin(db, actor_user=actor_user, organization_id=organization_id)
    values: dict[str, object] = {}
    fields = body.model_fields_set
    if "display_name" in fields:
        values["display_name"] = _clean_display_name(body.display_name)
    if "login_policy" in fields and body.login_policy is not None:
        values["login_policy"] = _clean_login_policy(body.login_policy)
    if "jit_policy" in fields and body.jit_policy is not None:
        values["jit_policy"] = body.jit_policy
    if "default_role" in fields and body.default_role is not None:
        values["default_role"] = _clean_default_role(body.default_role)
    if "allowed_domains" in fields:
        values["allowed_domains"] = normalize_domains(body.allowed_domains or [])
    for model_field, store_field in (
        ("oidc_issuer_url", "oidc_issuer_url"),
        ("oidc_discovery_url", "oidc_discovery_url"),
        ("oidc_authorization_endpoint", "oidc_authorization_endpoint"),
        ("oidc_token_endpoint", "oidc_token_endpoint"),
        ("oidc_jwks_uri", "oidc_jwks_uri"),
        ("oidc_userinfo_endpoint", "oidc_userinfo_endpoint"),
        ("oidc_client_id", "oidc_client_id"),
        ("oidc_client_secret", "oidc_client_secret"),
        ("oidc_token_endpoint_auth_method", "oidc_token_endpoint_auth_method"),
        ("saml_idp_metadata_url", "saml_idp_metadata_url"),
        ("saml_idp_metadata_xml", "saml_idp_metadata_xml"),
        ("saml_idp_entity_id", "saml_idp_entity_id"),
        ("saml_sso_url", "saml_sso_url"),
        ("saml_x509_cert", "saml_x509_cert"),
        ("saml_email_attribute", "saml_email_attribute"),
    ):
        if model_field in fields:
            values[store_field] = _clean_optional(getattr(body, model_field))
    if "oidc_scopes" in fields:
        values["oidc_scopes"] = tuple(scope for scope in (body.oidc_scopes or []) if scope.strip())

    updated = await sso_store.update_sso_connection(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
        values=values,
        actor_user_id=actor_user.id,
    )
    if updated is None:
        raise NotFoundError("SSO connection not found.", code="sso_connection_not_found")
    return updated


async def test_organization_sso_connection(
    db: AsyncSession,
    *,
    actor_user: OrganizationSsoActor,
    organization_id: UUID,
    connection_id: UUID,
) -> sso_store.SsoConnectionRecord:
    await _require_org_admin(db, actor_user=actor_user, organization_id=organization_id)
    record = await sso_store.get_sso_connection(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
    )
    if record is None:
        raise NotFoundError("SSO connection not found.", code="sso_connection_not_found")
    snapshot = snapshot_from_sso_connection_record(record)
    if snapshot is None:
        raise NotFoundError("SSO connection not found.", code="sso_connection_not_found")
    try:
        discovered = await test_oidc_connection(db, connection=snapshot)
    except HTTPException as exc:
        updated = await sso_store.mark_sso_connection_test_result(
            db,
            connection_id=connection_id,
            organization_id=organization_id,
            success=False,
            error=str(exc.detail),
            discovered=None,
            actor_user_id=actor_user.id,
        )
        if updated is None:
            raise NotFoundError(
                "SSO connection not found.",
                code="sso_connection_not_found",
            ) from exc
        raise
    updated = await sso_store.mark_sso_connection_test_result(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
        success=True,
        error=None,
        discovered=discovered,
        actor_user_id=actor_user.id,
    )
    if updated is None:
        raise NotFoundError("SSO connection not found.", code="sso_connection_not_found")
    return updated


async def enable_organization_sso_connection(
    db: AsyncSession,
    *,
    actor_user: OrganizationSsoActor,
    organization_id: UUID,
    connection_id: UUID,
) -> sso_store.SsoConnectionRecord:
    tested = await test_organization_sso_connection(
        db,
        actor_user=actor_user,
        organization_id=organization_id,
        connection_id=connection_id,
    )
    if tested.protocol != "oidc":
        raise HTTPException(status_code=400, detail="Only OIDC SSO can be enabled right now.")
    enabled = await sso_store.set_sso_connection_status(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
        status="enabled",
        actor_user_id=actor_user.id,
        last_error=None,
    )
    if enabled is None:
        raise NotFoundError("SSO connection not found.", code="sso_connection_not_found")
    return enabled


async def disable_organization_sso_connection(
    db: AsyncSession,
    *,
    actor_user: OrganizationSsoActor,
    organization_id: UUID,
    connection_id: UUID,
) -> sso_store.SsoConnectionRecord:
    await _require_org_admin(db, actor_user=actor_user, organization_id=organization_id)
    disabled = await sso_store.set_sso_connection_status(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
        status="disabled",
        actor_user_id=actor_user.id,
        last_error=None,
    )
    if disabled is None:
        raise NotFoundError("SSO connection not found.", code="sso_connection_not_found")
    return disabled


async def delete_organization_sso_connection(
    db: AsyncSession,
    *,
    actor_user: OrganizationSsoActor,
    organization_id: UUID,
    connection_id: UUID,
) -> sso_store.SsoConnectionRecord:
    await _require_org_admin(db, actor_user=actor_user, organization_id=organization_id)
    deleted = await sso_store.soft_delete_sso_connection(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
        actor_user_id=actor_user.id,
    )
    if deleted is None:
        raise NotFoundError("SSO connection not found.", code="sso_connection_not_found")
    return deleted


def organization_sso_urls(request: Request, connection_id: UUID) -> tuple[str, str, str, str]:
    base = settings.api_base_url.strip().rstrip("/")
    if not base:
        base = str(request.base_url).rstrip("/")
    oidc_path = auth_route_path_for_base("/auth/sso/oidc/callback", base_url=base)
    saml_acs_path = auth_route_path_for_base(
        f"/auth/sso/saml/{connection_id}/acs",
        base_url=base,
    )
    saml_metadata_path = auth_route_path_for_base(
        f"/auth/sso/saml/{connection_id}/metadata",
        base_url=base,
    )
    return (
        f"{base}{oidc_path}",
        f"{base}{saml_acs_path}",
        f"urn:proliferate:sso:{connection_id}",
        f"{base}{saml_metadata_path}",
    )


async def _require_org_admin(
    db: AsyncSession,
    *,
    actor_user: OrganizationSsoActor,
    organization_id: UUID,
) -> None:
    record = await organization_store.get_organization_with_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user.id,
    )
    if record is None:
        raise NotFoundError("Organization not found.", code="organization_not_found")
    require_org_role(
        OwnerContext(
            owner_scope="organization",
            actor_user_id=actor_user.id,
            owner_user_id=None,
            organization_id=organization_id,
            membership_id=record.membership.id,
            membership_role=record.membership.role,
            billing_subject_id=organization_id,
        ),
        organization_admin_roles(),
    )


def _clean_display_name(value: str | None) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="SSO display name is required.")
    if len(cleaned) > 255:
        raise HTTPException(status_code=400, detail="SSO display name is too long.")
    return cleaned


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _clean_default_role(value: str) -> str:
    if value == "owner":
        raise HTTPException(
            status_code=400,
            detail="SSO JIT default role cannot be owner.",
        )
    return value


def _clean_login_policy(value: str) -> str:
    if value == "required":
        raise HTTPException(
            status_code=400,
            detail="Required SSO login policy is not supported yet.",
        )
    return value
