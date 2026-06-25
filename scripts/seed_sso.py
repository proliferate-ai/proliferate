#!/usr/bin/env python3
"""Seed a local org-scoped SSO connection from AUTH_PROFILE env vars."""

from __future__ import annotations

import argparse
import asyncio
import os
from typing import TYPE_CHECKING
from uuid import UUID

from proliferate.auth.sso.policy import normalize_domains
from proliferate.auth.sso.types import DEFAULT_OIDC_SCOPES

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from proliferate.db.store.auth_sso_records import SsoConnectionRecord


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed a local organization SSO connection from .auth-env/.env.<profile>.",
    )
    parser.add_argument("--org-id", required=True)
    parser.add_argument("--status", default="enabled", choices=("draft", "enabled", "disabled"))
    args = parser.parse_args()

    asyncio.run(seed_sso(org_id=UUID(args.org_id), status=args.status))
    return 0


async def seed_sso(*, org_id: UUID, status: str) -> None:
    from proliferate.db import session_ops as db_session
    from proliferate.db.models.organizations import Organization
    from proliferate.db.store import auth_sso as sso_store

    connection_input = _connection_input()

    async with db_session.open_async_transaction() as db:
        organization = await db.get(Organization, org_id)
        if organization is None:
            raise SystemExit(f"Organization not found: {org_id}")

        actor_user_id = await _first_org_actor_user_id(db, org_id)
        if actor_user_id is None:
            raise SystemExit(
                f"Organization has no active members to use as SSO seed actor: {org_id}"
            )

        records = await sso_store.list_sso_connections_for_organization(
            db,
            organization_id=org_id,
        )
        existing = _matching_seeded_connection(records, connection_input)

        if existing is None:
            record = await sso_store.create_sso_connection(
                db,
                organization_id=org_id,
                actor_user_id=actor_user_id,
                **connection_input,
            )
            action = "Created"
        else:
            record = await sso_store.update_sso_connection(
                db,
                connection_id=existing.id,
                organization_id=org_id,
                values=connection_input,
                actor_user_id=actor_user_id,
            )
            if record is None:
                raise SystemExit(f"SSO connection disappeared while updating: {existing.id}")
            action = "Updated"

        if record.status != status:
            updated = await sso_store.set_sso_connection_status(
                db,
                connection_id=record.id,
                organization_id=org_id,
                status=status,
                actor_user_id=actor_user_id,
                last_error=None,
            )
            if updated is None:
                raise SystemExit(f"SSO connection disappeared while setting status: {record.id}")
            record = updated
        stale_connections = _stale_enabled_connections(
            records, current_id=record.id, input=connection_input
        )
        auth_profile = _env("AUTH_PROFILE", default="sso")
        for stale in stale_connections:
            await sso_store.set_sso_connection_status(
                db,
                connection_id=stale.id,
                organization_id=org_id,
                status="disabled",
                actor_user_id=actor_user_id,
                last_error=f"Disabled by seed-sso for AUTH_PROFILE={auth_profile}.",
            )

    callback_base_url = _env(
        "PROLIFERATE_SSO_OIDC_CALLBACK_BASE_URL",
        "SSO_OIDC_CALLBACK_BASE_URL",
        "API_BASE_URL",
        default="http://127.0.0.1:8000",
    ).rstrip("/")
    callback_url = f"{callback_base_url}/auth/sso/oidc/callback"
    print(f"{action} {record.display_name} for org {org_id}")
    print(f"Connection: {record.id}")
    print(f"Status: {record.status}")
    print(f"Callback URL: {callback_url}")


def _matching_seeded_connection(
    records: list[SsoConnectionRecord],
    input: dict[str, object],
) -> SsoConnectionRecord | None:
    display_name = input["display_name"]
    oidc_client_id = input["oidc_client_id"]
    for record in records:
        if record.protocol != "oidc":
            continue
        if record.display_name == display_name:
            return record
        if oidc_client_id and record.oidc_client_id == oidc_client_id:
            return record
    return None


def _stale_enabled_connections(
    records: list[SsoConnectionRecord],
    *,
    current_id: UUID,
    input: dict[str, object],
) -> list[SsoConnectionRecord]:
    allowed_domains = set(input["allowed_domains"])
    if not allowed_domains:
        return []
    stale: list[SsoConnectionRecord] = []
    for record in records:
        if record.id == current_id:
            continue
        if record.protocol != "oidc" or record.status != "enabled":
            continue
        record_domains = set(record.allowed_domains)
        if allowed_domains & record_domains:
            stale.append(record)
    return stale


def _connection_input() -> dict[str, object]:
    auth_profile = _env("AUTH_PROFILE", default="sso")
    display_name = _env(
        "PROLIFERATE_SSO_DISPLAY_NAME",
        "SSO_DISPLAY_NAME",
        default=f"{auth_profile.title()} SSO",
    )
    protocol = _env("PROLIFERATE_SSO_PROTOCOL", "SSO_PROTOCOL", default="oidc")
    if protocol != "oidc":
        raise SystemExit("Only OIDC SSO can be seeded by this helper.")

    login_policy = _env("PROLIFERATE_SSO_LOGIN_POLICY", "SSO_LOGIN_POLICY", default="optional")
    if login_policy == "required":
        raise SystemExit("Required SSO login policy is not supported yet.")

    default_role = _env("PROLIFERATE_SSO_DEFAULT_ROLE", "SSO_DEFAULT_ROLE", default="member")
    if default_role == "owner":
        raise SystemExit("SSO JIT default role cannot be owner.")

    allowed_domains = normalize_domains(
        _split_csv(_env("PROLIFERATE_SSO_ALLOWED_DOMAINS", "SSO_ALLOWED_DOMAINS", default="")),
    )
    oidc_client_id = _required("PROLIFERATE_SSO_OIDC_CLIENT_ID", "SSO_OIDC_CLIENT_ID")
    token_auth_method = _env(
        "PROLIFERATE_SSO_OIDC_TOKEN_ENDPOINT_AUTH_METHOD",
        "SSO_OIDC_TOKEN_ENDPOINT_AUTH_METHOD",
        default="client_secret_basic",
    )
    oidc_client_secret = _env(
        "PROLIFERATE_SSO_OIDC_CLIENT_SECRET",
        "SSO_OIDC_CLIENT_SECRET",
        default="",
    )
    if token_auth_method != "none" and not oidc_client_secret:
        raise SystemExit("OIDC client secret is required unless auth method is none.")

    oidc_issuer_url = _optional(
        "PROLIFERATE_SSO_OIDC_ISSUER_URL",
        "SSO_OIDC_ISSUER_URL",
    )
    oidc_discovery_url = _optional(
        "PROLIFERATE_SSO_OIDC_DISCOVERY_URL",
        "SSO_OIDC_DISCOVERY_URL",
    )
    oidc_authorization_endpoint = _optional(
        "PROLIFERATE_SSO_OIDC_AUTHORIZATION_ENDPOINT",
        "SSO_OIDC_AUTHORIZATION_ENDPOINT",
    )
    oidc_token_endpoint = _optional(
        "PROLIFERATE_SSO_OIDC_TOKEN_ENDPOINT",
        "SSO_OIDC_TOKEN_ENDPOINT",
    )
    oidc_jwks_uri = _optional("PROLIFERATE_SSO_OIDC_JWKS_URI", "SSO_OIDC_JWKS_URI")
    if not (
        oidc_issuer_url
        or oidc_discovery_url
        or (oidc_authorization_endpoint and oidc_token_endpoint and oidc_jwks_uri)
    ):
        raise SystemExit(
            "Set OIDC issuer/discovery URL, or static authorization/token/JWKS endpoints.",
        )

    return {
        "protocol": protocol,
        "display_name": display_name,
        "login_policy": login_policy,
        "jit_policy": _env(
            "PROLIFERATE_SSO_JIT_POLICY",
            "SSO_JIT_POLICY",
            default="disabled",
        ),
        "default_role": default_role,
        "allowed_domains": allowed_domains,
        "oidc_issuer_url": oidc_issuer_url,
        "oidc_discovery_url": oidc_discovery_url,
        "oidc_authorization_endpoint": oidc_authorization_endpoint,
        "oidc_token_endpoint": oidc_token_endpoint,
        "oidc_jwks_uri": oidc_jwks_uri,
        "oidc_userinfo_endpoint": _optional(
            "PROLIFERATE_SSO_OIDC_USERINFO_ENDPOINT",
            "SSO_OIDC_USERINFO_ENDPOINT",
        ),
        "oidc_client_id": oidc_client_id,
        "oidc_client_secret": oidc_client_secret or None,
        "oidc_scopes": _split_scopes(
            _env(
                "PROLIFERATE_SSO_OIDC_SCOPES",
                "SSO_OIDC_SCOPES",
                default=" ".join(DEFAULT_OIDC_SCOPES),
            ),
        ),
        "oidc_token_endpoint_auth_method": token_auth_method,
        "saml_idp_metadata_url": None,
        "saml_idp_metadata_xml": None,
        "saml_idp_entity_id": None,
        "saml_sso_url": None,
        "saml_x509_cert": None,
        "saml_email_attribute": None,
    }


async def _first_org_actor_user_id(db: AsyncSession, org_id: UUID) -> UUID | None:
    from sqlalchemy import select

    from proliferate.db.models.organizations import OrganizationMembership

    for roles in (("owner", "admin"), ("member",)):
        row = (
            await db.execute(
                select(OrganizationMembership.user_id)
                .where(
                    OrganizationMembership.organization_id == org_id,
                    OrganizationMembership.status == "active",
                    OrganizationMembership.role.in_(roles),
                )
                .order_by(OrganizationMembership.joined_at.asc())
                .limit(1),
            )
        ).scalar_one_or_none()
        if row is not None:
            return row
    return None


def _required(*names: str) -> str:
    value = _env(*names, default="")
    if not value:
        joined = " or ".join(names)
        raise SystemExit(f"Missing required env var: {joined}")
    return value


def _optional(*names: str) -> str | None:
    value = _env(*names, default="")
    return value or None


def _env(*names: str, default: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if value is not None:
            return value.strip()
    return default


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _split_scopes(value: str) -> tuple[str, ...]:
    scopes = [item for item in value.replace(",", " ").split() if item]
    return tuple(scopes) or DEFAULT_OIDC_SCOPES


if __name__ == "__main__":
    raise SystemExit(main())
