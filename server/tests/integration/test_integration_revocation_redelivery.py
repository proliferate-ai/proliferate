"""At-least-once redelivery safety for revocation jobs (PRO-349)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.db.models.cloud.integration_revocation import (
    CloudIntegrationRevocationJob,
)
from proliferate.db.store.integrations import revocation_jobs as revocation_jobs_store
from proliferate.server.cloud.integrations import revocation as revocation_service
from tests.integration.test_integration_revocation_lifecycle import _definition, _job


def _material(token: str) -> dict[str, object]:
    return {
        "revocationEndpoint": "https://auth.linear.app/oauth/revoke",
        "tokenEndpoint": "https://auth.linear.app/oauth/token",
        "token": token,
        "tokenTypeHint": "refresh_token",
        "clientId": "",
        "issuer": "https://auth.linear.app",
        "resource": "",
    }


@pytest.mark.asyncio
async def test_redelivered_job_does_not_double_revoke_while_lease_held(
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
        material=_material("lease-held-secret"),
    )
    claimed, ok = await revocation_jobs_store.claim_revocation_job(
        db_session,
        job.id,
        lease_seconds=300,
    )
    assert ok
    assert claimed is not None
    await db_session.commit()
    db_session.expunge_all()

    calls = 0

    async def _noop_revoke(**_kwargs: object) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(revocation_service, "revoke_token", _noop_revoke)
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    delay = await revocation_service.run_revocation_job(
        session_factory,
        job_id=str(job.id),
    )
    assert calls == 0
    assert isinstance(delay, float) and delay > 0

    await db_session.rollback()
    db_session.expunge_all()
    row = await db_session.get(CloudIntegrationRevocationJob, job.id)
    assert row is not None
    assert row.status == "running"
    assert row.attempt_count == 1
    assert row.credential_ciphertext is not None


@pytest.mark.asyncio
async def test_expired_lease_is_reclaimed_and_stale_worker_cannot_clobber(
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
        material=_material("reclaimed-secret"),
    )
    claimed, ok = await revocation_jobs_store.claim_revocation_job(
        db_session,
        job.id,
        lease_seconds=300,
    )
    assert ok and claimed is not None
    await db_session.commit()
    row = await db_session.get(CloudIntegrationRevocationJob, job.id)
    assert row is not None
    assert row.attempt_count == 1
    row.last_attempt_at = datetime.now(UTC) - timedelta(seconds=600)
    await db_session.commit()
    db_session.expunge_all()

    calls = 0

    async def _succeed_revoke(**_kwargs: object) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(revocation_service, "revoke_token", _succeed_revoke)
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    assert (
        await revocation_service.run_revocation_job(
            session_factory,
            job_id=str(job.id),
        )
        is None
    )
    assert calls == 1
    await db_session.rollback()
    db_session.expunge_all()
    succeeded = await revocation_jobs_store.get_revocation_job(db_session, job.id)
    assert succeeded is not None
    assert succeeded.status == "succeeded"
    assert succeeded.attempt_count == 2

    stale_released = await revocation_jobs_store.release_revocation_job_for_retry(
        db_session,
        job_id=job.id,
        error_code="revocation_failed",
        expected_attempt=1,
    )
    assert stale_released is not None
    assert stale_released.status == "succeeded"

    stale_fenced = await _job(
        db_session,
        definition_id=definition.id,
        provider_namespace="linear",
        provider_client_id=None,
        material=_material("fenced-secret"),
    )
    await revocation_jobs_store.claim_revocation_job(
        db_session, stale_fenced.id, lease_seconds=300
    )
    await db_session.commit()
    await db_session.rollback()
    fenced_row = await db_session.get(CloudIntegrationRevocationJob, stale_fenced.id)
    assert fenced_row is not None
    fenced_row.last_attempt_at = datetime.now(UTC) - timedelta(seconds=600)
    await db_session.commit()
    await db_session.rollback()
    await revocation_jobs_store.claim_revocation_job(
        db_session, stale_fenced.id, lease_seconds=300
    )
    await db_session.commit()
    await db_session.rollback()
    fenced_row = await db_session.get(CloudIntegrationRevocationJob, stale_fenced.id)
    assert fenced_row is not None
    assert fenced_row.attempt_count == 2

    await revocation_jobs_store.complete_revocation_job(
        db_session,
        job_id=stale_fenced.id,
        status="exhausted",
        error_code="x",
        expected_attempt=1,
    )
    await db_session.commit()
    await db_session.rollback()
    after_reject = await db_session.get(CloudIntegrationRevocationJob, stale_fenced.id)
    assert after_reject is not None
    assert after_reject.status == "running"
    assert after_reject.attempt_count == 2

    await revocation_jobs_store.complete_revocation_job(
        db_session,
        job_id=stale_fenced.id,
        status="exhausted",
        error_code="x",
        expected_attempt=2,
    )
    await db_session.commit()
    await db_session.rollback()
    after_accept = await revocation_jobs_store.get_revocation_job(db_session, stale_fenced.id)
    assert after_accept is not None
    assert after_accept.status == "exhausted"
    assert after_accept.attempt_count == 2
