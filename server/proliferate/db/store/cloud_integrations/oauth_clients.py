from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationOAuthClient
from proliferate.db.store.cloud_integrations.types import IntegrationOAuthClientRecord
from proliferate.utils.time import utcnow


def _client_record(row: CloudIntegrationOAuthClient) -> IntegrationOAuthClientRecord:
    return IntegrationOAuthClientRecord(
        id=row.id,
        definition_id=row.definition_id,
        issuer=row.issuer,
        redirect_uri=row.redirect_uri,
        resource=row.resource,
        client_strategy=row.client_strategy,
        client_id=row.client_id,
        client_secret_ciphertext=row.client_secret_ciphertext,
        registration_metadata_json=row.registration_metadata_json,
        token_endpoint_auth_method=row.token_endpoint_auth_method,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def get_oauth_client(
    db: AsyncSession,
    *,
    definition_id: UUID,
    issuer: str,
    redirect_uri: str,
    resource: str | None,
) -> IntegrationOAuthClientRecord | None:
    row = (
        await db.execute(
            select(CloudIntegrationOAuthClient).where(
                CloudIntegrationOAuthClient.definition_id == definition_id,
                CloudIntegrationOAuthClient.issuer == issuer,
                CloudIntegrationOAuthClient.redirect_uri == redirect_uri,
                CloudIntegrationOAuthClient.resource == resource,
            )
        )
    ).scalar_one_or_none()
    return _client_record(row) if row is not None else None


async def upsert_oauth_client(
    db: AsyncSession,
    *,
    definition_id: UUID,
    issuer: str,
    redirect_uri: str,
    resource: str | None,
    client_strategy: str,
    client_id: str,
    client_secret_ciphertext: str | None,
    registration_metadata_json: str,
    token_endpoint_auth_method: str | None,
) -> IntegrationOAuthClientRecord:
    row = (
        await db.execute(
            select(CloudIntegrationOAuthClient).where(
                CloudIntegrationOAuthClient.definition_id == definition_id,
                CloudIntegrationOAuthClient.issuer == issuer,
                CloudIntegrationOAuthClient.redirect_uri == redirect_uri,
                CloudIntegrationOAuthClient.resource == resource,
            )
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = CloudIntegrationOAuthClient(
            definition_id=definition_id,
            issuer=issuer,
            redirect_uri=redirect_uri,
            resource=resource,
            client_strategy=client_strategy,
            client_id=client_id,
            client_secret_ciphertext=client_secret_ciphertext,
            registration_metadata_json=registration_metadata_json,
            token_endpoint_auth_method=token_endpoint_auth_method,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.client_strategy = client_strategy
        row.client_id = client_id
        row.client_secret_ciphertext = client_secret_ciphertext
        row.registration_metadata_json = registration_metadata_json
        row.token_endpoint_auth_method = token_endpoint_auth_method
        row.updated_at = now
    await db.flush()
    await db.refresh(row)
    return _client_record(row)


async def delete_oauth_client(
    db: AsyncSession,
    *,
    client_id: UUID,
) -> None:
    row = await db.get(CloudIntegrationOAuthClient, client_id)
    if row is None:
        return
    await db.delete(row)
    await db.flush()
