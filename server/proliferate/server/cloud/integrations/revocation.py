"""Disconnect-time revocation staging and bounded background execution."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.background.config import DEFAULT_QUEUE, INTEGRATION_REVOCATION_PROCESS_TASK
from proliferate.config import settings
from proliferate.constants.cloud import (
    CLOUD_INTEGRATION_REVOCATION_DEADLINE_SECONDS,
    CLOUD_INTEGRATION_REVOCATION_LEASE_SECONDS,
)
from proliferate.db.store.background_outbox import enqueue_outbox_task
from proliferate.db.store.integrations import oauth_clients as oauth_clients_store
from proliferate.db.store.integrations import revocation_jobs as revocation_jobs_store
from proliferate.db.store.integrations.accounts import IntegrationAccountRecord
from proliferate.db.store.integrations.definitions import IntegrationDefinitionRecord
from proliferate.integrations.integration_oauth import (
    IntegrationOAuthProviderError,
    revoke_token,
)
from proliferate.integrations.integration_oauth.revocation import (
    validate_revocation_endpoint_origin,
)
from proliferate.lib.infra.encryption.fernet import decrypt_text
from proliferate.lib.infra.encryption.json import decrypt_json, encrypt_json
from proliferate.lib.infra.time.wall_clock import utcnow


def _revocation_token(
    bundle: Mapping[str, object],
    *,
    provider_namespace: str,
) -> tuple[str, str] | None:
    access_token = bundle.get("accessToken")
    refresh_token = bundle.get("refreshToken")
    if provider_namespace == "slack" and access_token:
        return str(access_token), "access_token"
    if refresh_token:
        return str(refresh_token), "refresh_token"
    if access_token:
        return str(access_token), "access_token"
    return None


async def stage_revocation_for_disconnect(
    db: AsyncSession,
    *,
    account: IntegrationAccountRecord,
    definition: IntegrationDefinitionRecord,
) -> revocation_jobs_store.IntegrationRevocationJobRecord | None:
    """Move only revocation material out of an about-to-be-deleted account."""

    if account.credential_format != "oauth-bundle-v1" or not account.credential_ciphertext:
        return None
    deadline = utcnow() + timedelta(seconds=CLOUD_INTEGRATION_REVOCATION_DEADLINE_SECONDS)
    try:
        bundle = decrypt_json(
            account.credential_ciphertext,
            secret=settings.cloud_secret_key,
        )
    except Exception:  # noqa: BLE001 - unreadable credentials still disconnect locally
        return await revocation_jobs_store.create_unsupported_revocation_receipt(
            db,
            account_id=account.id,
            owner_user_id=account.owner_user_id,
            definition_id=account.definition_id,
            provider_namespace=definition.namespace,
            provider_client_id=account.provider_client_id,
            credential_format="revocation-bundle-v1",
            deadline_at=deadline,
            error_code="credential_unreadable",
        )

    endpoint = bundle.get("revocationEndpoint")
    token = _revocation_token(bundle, provider_namespace=definition.namespace)
    if not endpoint or token is None:
        return await revocation_jobs_store.create_unsupported_revocation_receipt(
            db,
            account_id=account.id,
            owner_user_id=account.owner_user_id,
            definition_id=account.definition_id,
            provider_namespace=definition.namespace,
            provider_client_id=account.provider_client_id,
            credential_format="revocation-bundle-v1",
            deadline_at=deadline,
            error_code="provider_revocation_unsupported",
        )

    issuer = bundle.get("issuer")
    token_endpoint = bundle.get("tokenEndpoint")
    if (
        not isinstance(endpoint, str)
        or not isinstance(issuer, str)
        or not issuer
        or not isinstance(token_endpoint, str)
        or not token_endpoint
    ):
        return await revocation_jobs_store.create_unsupported_revocation_receipt(
            db,
            account_id=account.id,
            owner_user_id=account.owner_user_id,
            definition_id=account.definition_id,
            provider_namespace=definition.namespace,
            provider_client_id=account.provider_client_id,
            credential_format="revocation-bundle-v1",
            deadline_at=deadline,
            error_code="revocation_endpoint_invalid",
        )
    try:
        validate_revocation_endpoint_origin(
            revocation_endpoint=endpoint,
            issuer=issuer,
            token_endpoint=token_endpoint,
        )
    except IntegrationOAuthProviderError:
        return await revocation_jobs_store.create_unsupported_revocation_receipt(
            db,
            account_id=account.id,
            owner_user_id=account.owner_user_id,
            definition_id=account.definition_id,
            provider_namespace=definition.namespace,
            provider_client_id=account.provider_client_id,
            credential_format="revocation-bundle-v1",
            deadline_at=deadline,
            error_code="revocation_endpoint_invalid",
        )

    token_value, token_type_hint = token
    material = {
        "revocationEndpoint": endpoint,
        "tokenEndpoint": token_endpoint,
        "token": token_value,
        "tokenTypeHint": token_type_hint,
        "clientId": str(bundle.get("clientId") or ""),
        "issuer": issuer,
        "resource": str(bundle.get("resource") or ""),
    }
    job = await revocation_jobs_store.create_revocation_job(
        db,
        account_id=account.id,
        owner_user_id=account.owner_user_id,
        definition_id=account.definition_id,
        provider_namespace=definition.namespace,
        provider_client_id=account.provider_client_id,
        credential_ciphertext=encrypt_json(material, secret=settings.cloud_secret_key),
        credential_format="revocation-bundle-v1",
        deadline_at=deadline,
    )
    await enqueue_outbox_task(
        db,
        task_name=INTEGRATION_REVOCATION_PROCESS_TASK,
        queue=DEFAULT_QUEUE,
        args_json=(str(job.id),),
        idempotency_key=f"integration-revocation:{job.id}",
    )
    return job


def _retry_delay(attempt_count: int) -> float:
    return float(min(2 ** min(max(attempt_count, 1), 12), 3600))


async def run_revocation_job(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    job_id: str,
) -> float | None:
    """Run one idempotent attempt; return a Celery retry delay when pending."""

    try:
        parsed_job_id = UUID(job_id)
    except ValueError:
        return None
    async with session_factory() as db:
        job, claimed = await revocation_jobs_store.claim_revocation_job(
            db,
            parsed_job_id,
            lease_seconds=CLOUD_INTEGRATION_REVOCATION_LEASE_SECONDS,
        )
        await db.commit()
    if (
        job is None
        or job.status in revocation_jobs_store.TERMINAL_REVOCATION_STATUSES
        or job.credential_ciphertext is None
    ):
        return None
    if not claimed:
        remaining = (
            (
                job.last_attempt_at
                + timedelta(seconds=CLOUD_INTEGRATION_REVOCATION_LEASE_SECONDS)
                - utcnow()
            ).total_seconds()
            if job.last_attempt_at is not None
            else 0
        )
        return max(remaining, 1.0)

    try:
        material = decrypt_json(
            job.credential_ciphertext,
            secret=settings.cloud_secret_key,
        )
        endpoint = material.get("revocationEndpoint")
        token_endpoint = material.get("tokenEndpoint")
        token = material.get("token")
        token_type_hint = material.get("tokenTypeHint")
        client_id = material.get("clientId")
        issuer = material.get("issuer")
        resource = material.get("resource")
        if (
            not isinstance(endpoint, str)
            or not endpoint.strip()
            or not isinstance(token_endpoint, str)
            or not token_endpoint.strip()
            or not isinstance(token, str)
            or not token
            or token_type_hint not in {"access_token", "refresh_token"}
            or not isinstance(client_id, str)
            or not isinstance(issuer, str)
            or not isinstance(resource, str)
        ):
            raise ValueError("revocation material is malformed")
    except Exception:  # noqa: BLE001 - corrupt encrypted work must be destroyed
        async with session_factory() as db:
            await revocation_jobs_store.complete_revocation_job(
                db,
                job_id=job.id,
                status="exhausted",
                error_code="credential_unreadable",
                expected_attempt=job.attempt_count,
            )
            await db.commit()
        return None

    client_secret: str | None = None
    auth_method: str | None = None
    if job.provider_client_id is not None:
        async with session_factory() as db:
            oauth_client = await oauth_clients_store.get_oauth_client_by_id(
                db,
                job.provider_client_id,
            )
        if (
            oauth_client is None
            or oauth_client.definition_id != job.definition_id
            or oauth_client.lifecycle_state not in {"active", "retiring"}
            or oauth_client.client_id != client_id
            or (oauth_client.resource or "") != resource
            or oauth_client.issuer != issuer
        ):
            async with session_factory() as db:
                await revocation_jobs_store.complete_revocation_job(
                    db,
                    job_id=job.id,
                    status="exhausted",
                    error_code="provider_client_mismatch",
                    expected_attempt=job.attempt_count,
                )
                await db.commit()
            return None
        auth_method = oauth_client.token_endpoint_auth_method
        if oauth_client.client_secret_ciphertext:
            try:
                client_secret = decrypt_text(
                    oauth_client.client_secret_ciphertext,
                    secret=settings.cloud_secret_key,
                )
            except Exception:  # noqa: BLE001 - destroy unreadable revocation material
                async with session_factory() as db:
                    await revocation_jobs_store.complete_revocation_job(
                        db,
                        job_id=job.id,
                        status="exhausted",
                        error_code="provider_client_unreadable",
                        expected_attempt=job.attempt_count,
                    )
                    await db.commit()
                return None

    try:
        await revoke_token(
            revocation_endpoint=endpoint,
            issuer=issuer,
            token_endpoint=token_endpoint,
            token=token,
            token_type_hint=token_type_hint,
            client_id=client_id,
            client_secret=client_secret,
            token_endpoint_auth_method=auth_method,
            provider_namespace=job.provider_namespace,
        )
    except IntegrationOAuthProviderError as exc:
        if exc.code == "revocation_endpoint_invalid":
            async with session_factory() as db:
                await revocation_jobs_store.complete_revocation_job(
                    db,
                    job_id=job.id,
                    status="exhausted",
                    error_code=exc.code,
                    expected_attempt=job.attempt_count,
                )
                await db.commit()
            return None
        async with session_factory() as db:
            pending = await revocation_jobs_store.release_revocation_job_for_retry(
                db,
                job_id=job.id,
                error_code=exc.code,
                expected_attempt=job.attempt_count,
            )
            await db.commit()
        if pending is None or pending.status != "pending":
            return None
        return _retry_delay(pending.attempt_count)

    async with session_factory() as db:
        await revocation_jobs_store.complete_revocation_job(
            db,
            job_id=job.id,
            status="succeeded",
            error_code=None,
            expected_attempt=job.attempt_count,
        )
        await db.commit()
    return None


async def run_revocation_deadline_sweep(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as db:
        await revocation_jobs_store.exhaust_due_revocation_jobs(db)
        await db.commit()
