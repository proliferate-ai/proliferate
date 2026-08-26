"""Persistence helpers for per-definition integration OAuth clients.

Ported from the old cloud_mcp oauth client store, rekeyed onto the new
(issuer, redirect_uri, definition_id) unique key.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.integrations import CloudIntegrationOAuthClient
from proliferate.lib.infra.time.wall_clock import utcnow


@dataclass(frozen=True)
class IntegrationOAuthClientRecord:
    id: UUID
    definition_id: UUID
    issuer: str
    redirect_uri: str
    resource: str | None
    client_id: str
    revision: int
    lifecycle_state: str
    client_secret_ciphertext: str | None
    client_secret_expires_at: datetime | None
    token_endpoint_auth_method: str | None
    registration_client_uri: str | None
    registration_access_token_ciphertext: str | None
    created_at: datetime
    updated_at: datetime


def _record(client: CloudIntegrationOAuthClient) -> IntegrationOAuthClientRecord:
    return IntegrationOAuthClientRecord(
        id=client.id,
        definition_id=client.definition_id,
        issuer=client.issuer,
        redirect_uri=client.redirect_uri,
        resource=client.resource,
        client_id=client.client_id,
        revision=client.revision,
        lifecycle_state=client.lifecycle_state,
        client_secret_ciphertext=client.client_secret_ciphertext,
        client_secret_expires_at=client.client_secret_expires_at,
        token_endpoint_auth_method=client.token_endpoint_auth_method,
        registration_client_uri=client.registration_client_uri,
        registration_access_token_ciphertext=client.registration_access_token_ciphertext,
        created_at=client.created_at,
        updated_at=client.updated_at,
    )


async def get_oauth_client(
    db: AsyncSession,
    issuer: str,
    redirect_uri: str,
    definition_id: UUID,
) -> IntegrationOAuthClientRecord | None:
    client = (
        await db.execute(
            select(CloudIntegrationOAuthClient).where(
                CloudIntegrationOAuthClient.issuer == issuer,
                CloudIntegrationOAuthClient.redirect_uri == redirect_uri,
                CloudIntegrationOAuthClient.definition_id == definition_id,
                CloudIntegrationOAuthClient.lifecycle_state == "active",
            )
        )
    ).scalar_one_or_none()
    return _record(client) if client is not None else None


async def get_oauth_client_by_id(
    db: AsyncSession,
    client_id: UUID,
) -> IntegrationOAuthClientRecord | None:
    client = await db.get(CloudIntegrationOAuthClient, client_id)
    return _record(client) if client is not None else None


async def upsert_oauth_client(
    db: AsyncSession,
    *,
    definition_id: UUID,
    issuer: str,
    redirect_uri: str,
    resource: str | None,
    client_id: str,
    client_secret_ciphertext: str | None,
    client_secret_expires_at: datetime | None,
    token_endpoint_auth_method: str | None,
    registration_client_uri: str | None,
    registration_access_token_ciphertext: str | None,
    replace_active: bool = False,
) -> IntegrationOAuthClientRecord:
    await db.execute(
        text(
            "SELECT pg_advisory_xact_lock(hashtextextended("
            "'integration-oauth-client:' || :issuer || ':' || :redirect || ':' || "
            "CAST(:definition AS text), 0))"
        ),
        {
            "issuer": issuer,
            "redirect": redirect_uri,
            "definition": str(definition_id),
        },
    )
    clients = list(
        (
            await db.scalars(
                select(CloudIntegrationOAuthClient)
                .where(
                    CloudIntegrationOAuthClient.issuer == issuer,
                    CloudIntegrationOAuthClient.redirect_uri == redirect_uri,
                    CloudIntegrationOAuthClient.definition_id == definition_id,
                )
                .order_by(CloudIntegrationOAuthClient.revision)
                .with_for_update()
            )
        ).all()
    )
    client = next(
        (row for row in clients if row.lifecycle_state == "active"),
        None,
    )
    now = utcnow()
    if client is not None:
        unchanged = (
            client.resource == resource
            and client.client_id == client_id
            and client.client_secret_ciphertext == client_secret_ciphertext
            and client.client_secret_expires_at == client_secret_expires_at
            and client.token_endpoint_auth_method == token_endpoint_auth_method
            and client.registration_client_uri == registration_client_uri
            and client.registration_access_token_ciphertext == registration_access_token_ciphertext
        )
        if unchanged or not replace_active:
            return _record(client)
        client.lifecycle_state = "retiring"
        client.updated_at = now
    client = CloudIntegrationOAuthClient(
        definition_id=definition_id,
        issuer=issuer,
        redirect_uri=redirect_uri,
        resource=resource,
        client_id=client_id,
        revision=(clients[-1].revision + 1 if clients else 1),
        lifecycle_state="active",
        client_secret_ciphertext=client_secret_ciphertext,
        client_secret_expires_at=client_secret_expires_at,
        token_endpoint_auth_method=token_endpoint_auth_method,
        registration_client_uri=registration_client_uri,
        registration_access_token_ciphertext=registration_access_token_ciphertext,
        created_at=now,
        updated_at=now,
    )
    db.add(client)
    await db.flush()
    await db.refresh(client)
    return _record(client)


async def retire_oauth_client(
    db: AsyncSession,
    client_id: UUID,
) -> IntegrationOAuthClientRecord | None:
    client = await db.get(CloudIntegrationOAuthClient, client_id, with_for_update=True)
    if client is None:
        return None
    if client.lifecycle_state == "active":
        client.lifecycle_state = "retiring"
        client.updated_at = utcnow()
        await db.flush()
        await db.refresh(client)
    return _record(client)


async def delete_oauth_client(
    db: AsyncSession,
    id: UUID,
) -> None:
    await db.execute(
        delete(CloudIntegrationOAuthClient).where(CloudIntegrationOAuthClient.id == id)
    )
    await db.flush()
