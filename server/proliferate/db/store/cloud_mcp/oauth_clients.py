from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudMcpOAuthClient
from proliferate.db.store.cloud_mcp.types import CloudMcpOAuthClientRecord
from proliferate.utils.time import utcnow


def _record(client: CloudMcpOAuthClient) -> CloudMcpOAuthClientRecord:
    return CloudMcpOAuthClientRecord(
        id=client.id,
        issuer=client.issuer,
        redirect_uri=client.redirect_uri,
        catalog_entry_id=client.catalog_entry_id,
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
    *,
    issuer: str,
    redirect_uri: str,
    catalog_entry_id: str,
) -> CloudMcpOAuthClientRecord | None:
    async with db_engine.async_session_factory() as db:
        client = (
            await db.execute(
                select(CloudMcpOAuthClient).where(
                    CloudMcpOAuthClient.issuer == issuer,
                    CloudMcpOAuthClient.redirect_uri == redirect_uri,
                    CloudMcpOAuthClient.catalog_entry_id == catalog_entry_id,
                )
            )
        ).scalar_one_or_none()
        return _record(client) if client is not None else None


async def upsert_oauth_client(
    *,
    issuer: str,
    redirect_uri: str,
    catalog_entry_id: str,
    resource: str | None,
    client_id: str,
    client_secret_ciphertext: str | None,
    client_secret_expires_at: datetime | None,
    token_endpoint_auth_method: str | None,
    registration_client_uri: str | None,
    registration_access_token_ciphertext: str | None,
) -> CloudMcpOAuthClientRecord:
    async with db_engine.async_session_factory() as db:
        client = (
            await db.execute(
                select(CloudMcpOAuthClient).where(
                    CloudMcpOAuthClient.issuer == issuer,
                    CloudMcpOAuthClient.redirect_uri == redirect_uri,
                    CloudMcpOAuthClient.catalog_entry_id == catalog_entry_id,
                )
            )
        ).scalar_one_or_none()
        now = utcnow()
        if client is None:
            client = CloudMcpOAuthClient(
                issuer=issuer,
                redirect_uri=redirect_uri,
                catalog_entry_id=catalog_entry_id,
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
        await db.commit()
        await db.refresh(client)
        return _record(client)


async def delete_oauth_client(
    *,
    issuer: str,
    redirect_uri: str,
    catalog_entry_id: str,
) -> None:
    async with db_engine.async_session_factory() as db:
        await db.execute(
            delete(CloudMcpOAuthClient).where(
                CloudMcpOAuthClient.issuer == issuer,
                CloudMcpOAuthClient.redirect_uri == redirect_uri,
                CloudMcpOAuthClient.catalog_entry_id == catalog_entry_id,
            )
        )
        await db.commit()
