from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.background.config import INTEGRATION_REVOCATION_PROCESS_TASK
from proliferate.config import settings
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.models.integration_authorization import (
    CloudIntegrationAuthorizationAttempt,
)
from proliferate.db.models.integration_revocation import (
    CloudIntegrationRevocationJob,
)
from proliferate.db.models.integrations import (
    CloudIntegrationAccount,
    CloudIntegrationOAuthFlow,
    CloudIntegrationToolSchemaCache,
)
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import authorization_attempts as attempts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.db.store.integrations import oauth_clients as oauth_clients_store
from proliferate.db.store.integrations import oauth_flows as oauth_flows_store
from proliferate.db.store.integrations import revocation_jobs as revocation_jobs_store
from proliferate.db.store.integrations import tool_cache as tool_cache_store
from proliferate.db.store.integrations.definition_security_revisions import (
    ensure_current_definition_security_revision,
)
from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError
from proliferate.lib.infra.encryption.fernet import encrypt_text
from proliferate.lib.infra.encryption.json import decrypt_json, encrypt_json
from proliferate.server.integration_gateway.connections import revocation as revocation_service
from proliferate.server.integration_gateway.connections.seeds import sync_seed_definitions
from tests.integration.test_cloud_integration_gateway_api import _authed_user


async def _definition(db_session: AsyncSession, namespace: str):
    await sync_seed_definitions(db_session)
    await db_session.commit()
    definition = await definitions_store.get_seed_by_namespace(db_session, namespace)
    assert definition is not None
    return definition


async def _job(
    db_session: AsyncSession,
    *,
    definition_id: uuid.UUID,
    provider_namespace: str,
    provider_client_id: uuid.UUID | None,
    material: dict[str, object],
) -> revocation_jobs_store.IntegrationRevocationJobRecord:
    created = await revocation_jobs_store.create_revocation_job(
        db_session,
        account_id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        definition_id=definition_id,
        provider_namespace=provider_namespace,
        provider_client_id=provider_client_id,
        credential_ciphertext=encrypt_json(material, secret=settings.cloud_secret_key),
        credential_format="revocation-bundle-v1",
        deadline_at=datetime.now(UTC) + timedelta(hours=24),
    )
    await db_session.commit()
    return created


@pytest.mark.asyncio
async def test_revocation_worker_uses_issuing_retiring_client_and_is_idempotent(
    db_session: AsyncSession,
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    definition = await _definition(db_session, "linear")
    provider_client = await oauth_clients_store.upsert_oauth_client(
        db_session,
        definition_id=definition.id,
        issuer="https://auth.linear.app",
        redirect_uri="https://api.example.com/v1/cloud/integrations/oauth/callback",
        resource="https://mcp.linear.app/mcp",
        client_id="issuing-client",
        client_secret_ciphertext=encrypt_text(
            "issuing-client-secret",
            secret=settings.cloud_secret_key,
        ),
        client_secret_expires_at=None,
        token_endpoint_auth_method="client_secret_post",
        registration_client_uri=None,
        registration_access_token_ciphertext=None,
    )
    await oauth_clients_store.retire_oauth_client(db_session, provider_client.id)
    await db_session.commit()
    job = await _job(
        db_session,
        definition_id=definition.id,
        provider_namespace="linear",
        provider_client_id=provider_client.id,
        material={
            "revocationEndpoint": "https://auth.linear.app/oauth/revoke",
            "tokenEndpoint": "https://auth.linear.app/oauth/token",
            "token": "refresh-token-secret",
            "tokenTypeHint": "refresh_token",
            "clientId": "issuing-client",
            "issuer": "https://auth.linear.app",
            "resource": "https://mcp.linear.app/mcp",
        },
    )
    calls: list[dict[str, object]] = []

    async def _revoke_token(**kwargs: object) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(revocation_service, "revoke_token", _revoke_token)
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    assert (
        await revocation_service.run_revocation_job(
            session_factory,
            job_id=str(job.id),
        )
        is None
    )
    assert len(calls) == 1
    assert calls[0]["client_id"] == "issuing-client"
    assert calls[0]["client_secret"] == "issuing-client-secret"
    assert calls[0]["token"] == "refresh-token-secret"

    await db_session.rollback()
    completed = await revocation_jobs_store.get_revocation_job(db_session, job.id)
    assert completed is not None
    assert completed.status == "succeeded"
    assert completed.credential_ciphertext is None
    assert completed.completed_at is not None

    assert (
        await revocation_service.run_revocation_job(
            session_factory,
            job_id=str(job.id),
        )
        is None
    )
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_revocation_failure_retries_then_deadline_sweep_destroys_secret(
    db_session: AsyncSession,
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    definition = await _definition(db_session, "linear")
    job = await _job(
        db_session,
        definition_id=definition.id,
        provider_namespace="linear",
        provider_client_id=None,
        material={
            "revocationEndpoint": "https://auth.linear.app/oauth/revoke",
            "tokenEndpoint": "https://auth.linear.app/oauth/token",
            "token": "retry-secret",
            "tokenTypeHint": "refresh_token",
            "clientId": "",
            "issuer": "https://auth.linear.app",
            "resource": "",
        },
    )

    async def _fail_revoke(**_kwargs: object) -> None:
        raise IntegrationOAuthProviderError(
            "revocation_failed",
            "safe provider failure",
        )

    monkeypatch.setattr(revocation_service, "revoke_token", _fail_revoke)
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    retry_after = await revocation_service.run_revocation_job(
        session_factory,
        job_id=str(job.id),
    )
    assert retry_after == 2.0

    await db_session.rollback()
    pending = await db_session.get(CloudIntegrationRevocationJob, job.id)
    assert pending is not None
    assert pending.status == "pending"
    assert pending.attempt_count == 1
    assert pending.last_error_code == "revocation_failed"
    assert pending.credential_ciphertext is not None
    pending.deadline_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()

    await revocation_service.run_revocation_deadline_sweep(session_factory)
    await db_session.rollback()
    db_session.expunge_all()
    exhausted = await revocation_jobs_store.get_revocation_job(db_session, job.id)
    assert exhausted is not None
    assert exhausted.status == "exhausted"
    assert exhausted.last_error_code == "deadline_exceeded"
    assert exhausted.credential_ciphertext is None
    assert exhausted.completed_at is not None


@pytest.mark.asyncio
async def test_corrupt_revocation_ciphertext_terminalizes_without_provider_io(
    db_session: AsyncSession,
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    definition = await _definition(db_session, "linear")
    job = await revocation_jobs_store.create_revocation_job(
        db_session,
        account_id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        definition_id=definition.id,
        provider_namespace="linear",
        provider_client_id=None,
        credential_ciphertext="not-valid-fernet-ciphertext",
        credential_format="revocation-bundle-v1",
        deadline_at=datetime.now(UTC) + timedelta(hours=24),
    )
    await db_session.commit()
    calls = 0

    async def _unexpected_revoke(**_kwargs: object) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(revocation_service, "revoke_token", _unexpected_revoke)
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    assert (
        await revocation_service.run_revocation_job(
            session_factory,
            job_id=str(job.id),
        )
        is None
    )
    assert calls == 0
    await db_session.rollback()
    db_session.expunge_all()
    exhausted = await revocation_jobs_store.get_revocation_job(db_session, job.id)
    assert exhausted is not None
    assert exhausted.status == "exhausted"
    assert exhausted.last_error_code == "credential_unreadable"
    assert exhausted.credential_ciphertext is None


@pytest.mark.asyncio
async def test_provider_without_revocation_endpoint_terminalizes_without_outbox(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await _authed_user(client, db_session, prefix="revocation-unsupported")
    definition = await _definition(db_session, "linear")
    account = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        auth_kind="oauth2",
        status="ready",
    )
    await accounts_store.set_account_credentials(
        db_session,
        account_id=account.id,
        credential_ciphertext=encrypt_json(
            {
                "issuer": "https://auth.linear.app",
                "resource": "https://mcp.linear.app/mcp",
                "clientId": "public-client",
                "accessToken": "access-token",
                "refreshToken": "refresh-token",
                "expiresAt": None,
                "scopes": [],
                "tokenEndpoint": "https://auth.linear.app/oauth/token",
                "redirectUri": ("https://api.example.com/v1/cloud/integrations/oauth/callback"),
            },
            secret=settings.cloud_secret_key,
        ),
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    stored = await accounts_store.get_account(db_session, account.id)
    assert stored is not None

    receipt = await revocation_service.stage_revocation_for_disconnect(
        db_session,
        account=stored,
        definition=definition,
    )
    await db_session.commit()

    assert receipt is not None
    assert receipt.status == "unsupported"
    assert receipt.last_error_code == "provider_revocation_unsupported"
    assert receipt.credential_ciphertext is None
    assert (
        await db_session.scalar(
            select(BackgroundOutboxTask).where(
                BackgroundOutboxTask.task_name == INTEGRATION_REVOCATION_PROCESS_TASK
            )
        )
        is None
    )


@pytest.mark.asyncio
async def test_unsafe_revocation_endpoint_terminalizes_without_outbox(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await _authed_user(client, db_session, prefix="revocation-unsafe")
    definition = await _definition(db_session, "linear")
    account = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        auth_kind="oauth2",
        status="ready",
    )
    await accounts_store.set_account_credentials(
        db_session,
        account_id=account.id,
        credential_ciphertext=encrypt_json(
            {
                "issuer": "https://auth.linear.app",
                "resource": "https://mcp.linear.app/mcp",
                "clientId": "public-client",
                "accessToken": "access-token",
                "refreshToken": "refresh-token",
                "expiresAt": None,
                "scopes": [],
                "tokenEndpoint": "https://auth.linear.app/oauth/token",
                "revocationEndpoint": "https://169.254.169.254/revoke",
                "redirectUri": ("https://api.example.com/v1/cloud/integrations/oauth/callback"),
            },
            secret=settings.cloud_secret_key,
        ),
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    stored = await accounts_store.get_account(db_session, account.id)
    assert stored is not None

    receipt = await revocation_service.stage_revocation_for_disconnect(
        db_session,
        account=stored,
        definition=definition,
    )
    await db_session.commit()

    assert receipt is not None
    assert receipt.status == "unsupported"
    assert receipt.last_error_code == "revocation_endpoint_invalid"
    assert receipt.credential_ciphertext is None
    assert (
        await db_session.scalar(
            select(BackgroundOutboxTask).where(
                BackgroundOutboxTask.task_name == INTEGRATION_REVOCATION_PROCESS_TASK
            )
        )
        is None
    )


@pytest.mark.asyncio
async def test_disconnect_invalidates_local_authority_and_enqueues_only_job_id(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await _authed_user(client, db_session, prefix="disconnect-cutoff")
    definition = await _definition(db_session, "linear")
    revision = await ensure_current_definition_security_revision(db_session, definition.id)
    assert revision is not None
    provider_client = await oauth_clients_store.upsert_oauth_client(
        db_session,
        definition_id=definition.id,
        issuer="https://auth.linear.app",
        redirect_uri="https://api.example.com/v1/cloud/integrations/oauth/callback",
        resource="https://mcp.linear.app/mcp",
        client_id="disconnect-client",
        client_secret_ciphertext=None,
        client_secret_expires_at=None,
        token_endpoint_auth_method="none",
        registration_client_uri=None,
        registration_access_token_ciphertext=None,
    )
    token_secret = "disconnect-refresh-token-must-stay-encrypted"
    account_record = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        auth_kind="oauth2",
        status="ready",
    )
    await accounts_store.set_account_credentials(
        db_session,
        account_id=account_record.id,
        credential_ciphertext=encrypt_json(
            {
                "issuer": "https://auth.linear.app",
                "resource": "https://mcp.linear.app/mcp",
                "clientId": "disconnect-client",
                "accessToken": "disconnect-access-token",
                "refreshToken": token_secret,
                "expiresAt": None,
                "scopes": [],
                "tokenEndpoint": "https://auth.linear.app/oauth/token",
                "revocationEndpoint": "https://auth.linear.app/oauth/revoke",
                "redirectUri": ("https://api.example.com/v1/cloud/integrations/oauth/callback"),
            },
            secret=settings.cloud_secret_key,
        ),
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    account = await db_session.get(CloudIntegrationAccount, account_record.id)
    assert account is not None
    account.definition_security_revision_id = revision.id
    account.provider_client_id = provider_client.id
    account.credential_audience = "https://mcp.linear.app/mcp"
    await db_session.flush()

    attempt = await attempts_store.create_authorization_attempt(
        db_session,
        owner_user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        account_id=account.id,
        purpose="reauthorize",
        method="oauth2",
        starting_grant_version=account.grant_version,
        starting_credential_version=account.credential_version,
        definition_security_revision_id=revision.id,
        provider_client_id=provider_client.id,
        credential_audience="https://mcp.linear.app/mcp",
        settings_json="{}",
        requested_scopes_json="[]",
        effective_scopes_json=None,
        staged_credential_ciphertext=None,
        staged_credential_format=None,
        status="active",
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )
    flow = await oauth_flows_store.create_oauth_flow_canceling_existing(
        db_session,
        account_id=account.id,
        attempt_id=attempt.id,
        owner_user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        state_hash="disconnect-state-hash",
        code_verifier_ciphertext="encrypted-verifier",
        issuer="https://auth.linear.app",
        resource="https://mcp.linear.app/mcp",
        client_id="disconnect-client",
        token_endpoint="https://auth.linear.app/oauth/token",
        revocation_endpoint="https://auth.linear.app/oauth/revoke",
        requested_scopes="[]",
        redirect_uri="https://api.example.com/v1/cloud/integrations/oauth/callback",
        authorization_url="https://auth.linear.app/oauth/authorize",
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )
    await tool_cache_store.upsert_tool_cache(
        db_session,
        account_id=account.id,
        grant_version=account.grant_version,
        tools_json="[]",
        content_hash=None,
        status="ready",
        fetched_at=datetime.now(UTC),
        error_code=None,
    )
    await db_session.commit()

    response = await client.delete(
        f"/v1/cloud/integrations/accounts/{account.id}",
        headers=auth.headers,
    )
    assert response.status_code == 204, response.text

    await db_session.rollback()
    db_session.expunge_all()
    assert await db_session.get(CloudIntegrationAccount, account.id) is None
    assert await db_session.get(CloudIntegrationToolSchemaCache, account.id) is None
    assert await db_session.get(CloudIntegrationAuthorizationAttempt, attempt.id) is None
    assert await db_session.get(CloudIntegrationOAuthFlow, flow.id) is None
    job = (await db_session.scalars(select(CloudIntegrationRevocationJob))).one()
    assert job.status == "pending"
    assert job.provider_client_id == provider_client.id
    assert job.credential_ciphertext is not None
    assert token_secret not in job.credential_ciphertext
    material = decrypt_json(job.credential_ciphertext, secret=settings.cloud_secret_key)
    assert material["token"] == token_secret
    assert set(material) == {
        "revocationEndpoint",
        "tokenEndpoint",
        "token",
        "tokenTypeHint",
        "clientId",
        "issuer",
        "resource",
    }
    assert timedelta(hours=23, minutes=59) <= job.deadline_at - job.created_at
    assert job.deadline_at - job.created_at <= timedelta(hours=24, minutes=1)

    outbox = (
        await db_session.scalars(
            select(BackgroundOutboxTask).where(
                BackgroundOutboxTask.task_name == INTEGRATION_REVOCATION_PROCESS_TASK
            )
        )
    ).one()
    assert outbox.args_json == [str(job.id)]
    assert outbox.kwargs_json == {}
    assert token_secret not in str(outbox.args_json)
    assert token_secret not in str(outbox.kwargs_json)
