"""Persistence helpers for per-definition integration OAuth clients.

Ported from the old cloud_mcp oauth client store, rekeyed onto the new
(issuer, redirect_uri, definition_id) unique key.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationOAuthClient
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class IntegrationOAuthClientRecord:
    id: UUID
    definition_id: UUID
    issuer: str
    redirect_uri: str
    resource: str | None
    client_id: str
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
            )
        )
    ).scalar_one_or_none()
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
) -> IntegrationOAuthClientRecord:
    client = (
        await db.execute(
            select(CloudIntegrationOAuthClient)
            .where(
                CloudIntegrationOAuthClient.issuer == issuer,
                CloudIntegrationOAuthClient.redirect_uri == redirect_uri,
                CloudIntegrationOAuthClient.definition_id == definition_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if client is None:
        client = CloudIntegrationOAuthClient(
            definition_id=definition_id,
            issuer=issuer,
            redirect_uri=redirect_uri,
            resource=resource,
            client_id=client_id,
            client_secret_ciphertext=client_secret_ciphertext,
            client_secret_expires_at=client_secret_expires_at,
            token_endpoint_auth_method=token_endpoint_auth_method,
            registration_client_uri=registration_client_uri,
            registration_access_token_ciphertext=registration_access_token_ciphertext,
            created_at=now,
            updated_at=now,
        )
        db.add(client)
    else:
        client.resource = resource
        client.client_id = client_id
        client.client_secret_ciphertext = client_secret_ciphertext
        client.client_secret_expires_at = client_secret_expires_at
        client.token_endpoint_auth_method = token_endpoint_auth_method
        client.registration_client_uri = registration_client_uri
        client.registration_access_token_ciphertext = registration_access_token_ciphertext
        client.updated_at = now
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
