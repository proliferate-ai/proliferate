"""The heartbeat verdict and ingest enforcement, proven to agree.

Split out of ``test_agent_models_ingest_api.py`` to keep both files under the
repo-wide line cap. One shared domain rule decides eligibility, so these cases
assert the advertised bit and the enforced outcome cannot disagree: what the
heartbeat promises, ingest honours, and what it denies, ingest refuses.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import agent_gateway as store
from proliferate.db.store import runtime_workers as runtime_workers_store
from tests.helpers.agent_models import (
    HARNESS,
    MODELS_PATH,
    PROBED_AT,
    authed_user,
    desktop_worker_headers,
    model_ids,
    snapshot_document,
)

INGEST_PATH = f"{MODELS_PATH}/refresh"


def _body(models: list[str], *, probed_at: str = PROBED_AT) -> dict[str, str]:
    """The Worker's exact POST shape (``IngestModelSnapshotRequest`` in
    ``model_snapshot_sync.rs``): snapshotJson + probedAt, keyed by the harness
    in the path — no authContextId, no owner."""
    return {
        "snapshotJson": snapshot_document(models),
        "probedAt": probed_at,
    }


async def _cloud_worker_with_sandbox(
    db_session: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
) -> tuple[dict[str, str], uuid.UUID, str]:
    """A cloud-sandbox Worker plus the ids the eligibility rule keys on.

    Built inline (rather than through ``cloud_sandbox_worker_headers``) because
    these tests must mutate the sandbox row and heartbeat as the same Worker, so
    they need the sandbox id and the raw bearer, not just a headers dict.
    """
    from datetime import UTC as _UTC
    from datetime import datetime as _datetime

    from proliferate.db.models.cloud.sandboxes import CloudSandbox

    sandbox = CloudSandbox(
        owner_user_id=owner_user_id,
        sandbox_type="e2b",
        provider_sandbox_id=f"provider-{uuid.uuid4().hex[:10]}",
        status="ready",
    )
    db_session.add(sandbox)
    await db_session.flush()
    enrollment = await runtime_workers_store.create_enrollment(
        db_session,
        owner_user_id=owner_user_id,
        organization_id=None,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=sandbox.id,
        desktop_install_id=None,
        created_by_user_id=owner_user_id,
        token_hash=runtime_workers_store.hash_enrollment_token(uuid.uuid4().hex),
        expires_at=_datetime(2030, 1, 1, tzinfo=_UTC),
    )
    worker_token = f"worker-{uuid.uuid4().hex}"
    worker = await runtime_workers_store.create_worker(
        db_session,
        enrollment=enrollment,
        token_hash=runtime_workers_store.hash_worker_token(worker_token),
    )
    await db_session.commit()
    return (
        {"Authorization": f"Bearer {worker_token}"},
        sandbox.id,
        str(worker.id),
    )


async def _destroy_sandbox(db_session: AsyncSession, sandbox_id: uuid.UUID) -> None:
    from proliferate.db.models.cloud.sandboxes import CloudSandbox

    sandbox = await db_session.get(CloudSandbox, sandbox_id)
    assert sandbox is not None
    sandbox.destroyed_at = datetime.now(UTC)
    db_session.add(sandbox)
    await db_session.commit()


class TestHeartbeatVerdictMatchesIngestEnforcement:
    """REL-10: the advertised heartbeat verdict and the ingest 403 are one rule.

    Both paths import ``agent_models.domain.snapshot_upload.snapshot_upload_owner``;
    neither restates the conditions. These tests bind the two observable ends of
    that rule together over real Postgres, so a future inline duplicate that
    drifts would fail here rather than in production.
    """

    @pytest.mark.asyncio
    async def test_an_allowed_heartbeat_is_followed_by_a_successful_ingest(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, _ = await authed_user(client)
        worker, _sandbox_id, _worker_id = await _cloud_worker_with_sandbox(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )

        heartbeat = await client.post("/v1/cloud/worker/heartbeat", headers=worker, json={})
        assert heartbeat.status_code == 200, heartbeat.text
        assert heartbeat.json()["modelSnapshotUploadAllowed"] is True

        ingest = await client.post(INGEST_PATH, json=_body(["eligible-model"]), headers=worker)
        assert ingest.status_code == 200, ingest.text
        assert model_ids(ingest.json()) == ["eligible-model"]

    @pytest.mark.asyncio
    async def test_a_destroyed_sandbox_denies_both_the_verdict_and_the_upload(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, _ = await authed_user(client)
        worker, sandbox_id, _worker_id = await _cloud_worker_with_sandbox(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )
        allowed = await client.post("/v1/cloud/worker/heartbeat", headers=worker, json={})
        assert allowed.json()["modelSnapshotUploadAllowed"] is True

        await _destroy_sandbox(db_session, sandbox_id)

        denied = await client.post("/v1/cloud/worker/heartbeat", headers=worker, json={})
        assert denied.status_code == 200, denied.text
        assert denied.json()["modelSnapshotUploadAllowed"] is False

        # The upload route remains the final boundary, not a cached echo of the
        # ack: a direct upload after destruction is still refused.
        ingest = await client.post(INGEST_PATH, json=_body(["too-late"]), headers=worker)
        assert ingest.status_code == 403, ingest.text
        assert ingest.json()["detail"]["code"] == "agent_model_snapshot_upload_forbidden"

    @pytest.mark.asyncio
    async def test_a_desktop_worker_is_denied_on_both_surfaces(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_id, _ = await authed_user(client)
        worker = await desktop_worker_headers(db_session, owner_user_id=uuid.UUID(user_id))

        heartbeat = await client.post("/v1/cloud/worker/heartbeat", headers=worker, json={})
        assert heartbeat.status_code == 200, heartbeat.text
        assert heartbeat.json()["modelSnapshotUploadAllowed"] is False

        ingest = await client.post(INGEST_PATH, json=_body(["desktop-model"]), headers=worker)
        assert ingest.status_code == 403, ingest.text
        assert ingest.json()["detail"]["code"] == "agent_model_snapshot_upload_forbidden"

    @pytest.mark.asyncio
    async def test_destruction_between_heartbeat_and_upload_is_one_403(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """The exact race the Worker's process-lifetime fuse exists for: the ack
        said ``true``, then the sandbox went away before the upload landed."""
        user_id, _ = await authed_user(client)
        worker, sandbox_id, _worker_id = await _cloud_worker_with_sandbox(
            db_session,
            owner_user_id=uuid.UUID(user_id),
        )
        heartbeat = await client.post("/v1/cloud/worker/heartbeat", headers=worker, json={})
        assert heartbeat.json()["modelSnapshotUploadAllowed"] is True

        await _destroy_sandbox(db_session, sandbox_id)

        ingest = await client.post(INGEST_PATH, json=_body(["raced"]), headers=worker)
        assert ingest.status_code == 403, ingest.text
        assert ingest.json()["detail"]["code"] == "agent_model_snapshot_upload_forbidden"
        # Nothing was written under the owner despite the earlier `true`.
        assert (
            await store.get_active_model_snapshot(
                db_session,
                harness_kind=HARNESS,
                owner_user_id=uuid.UUID(user_id),
            )
            is None
        )

    @pytest.mark.asyncio
    async def test_both_paths_import_the_one_domain_rule(self) -> None:
        """No second policy implementation: the heartbeat service and the ingest
        resolver reference the same function object."""
        from proliferate.server.cloud.agent_models import snapshots
        from proliferate.server.cloud.agent_models.domain import snapshot_upload
        from proliferate.server.cloud.runtime_workers import service

        assert (
            service.snapshot_upload_owner
            is snapshots.snapshot_upload_owner
            is snapshot_upload.snapshot_upload_owner
        )
