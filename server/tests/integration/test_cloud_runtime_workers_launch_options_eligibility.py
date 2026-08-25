"""The heartbeat's snapshot-upload verdict, at the authentication boundary.

Split out of ``test_cloud_runtime_workers_api.py`` to keep both files under the
repo-wide line cap. These are the REL-10 boundary cases: a desktop worker is
authenticated but never eligible, a credential failure carries no verdict at all,
and the service revalidates the worker row so a revocation that lands after
authentication still answers 401 rather than a 200 carrying ``false``.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.runtime_workers import CloudRuntimeWorker
from tests.helpers.worker_heartbeat import (
    authed_user as _authed_user,
    enroll_worker as _enroll_worker,
)


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    # Enrollment mints an integration-gateway URL from the configured base;
    # CI has no .env, so provide one the way production config would.
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


class TestHeartbeatSnapshotUploadEligibilityBoundary:
    """REL-10: authentication and eligibility are separate boundaries.

    A credential failure is a 401 with no heartbeat body at all — never a 200
    whose ``launchOptionsUploadAllowed`` happens to be ``false``. Only an
    authenticated Worker learns a verdict, and for Desktop it is always ``false``.
    """

    @pytest.mark.asyncio
    async def test_credential_failures_carry_no_verdict(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-snap-401")
        enrolled = await _enroll_worker(client, auth, install_id="install-snap-401")
        worker_token = enrolled["workerToken"]

        # Re-enrolling the same install revokes the predecessor's token.
        await _enroll_worker(client, auth, install_id="install-snap-401")

        cases = [
            await client.post("/v1/cloud/worker/heartbeat", json={}),
            await client.post(
                "/v1/cloud/worker/heartbeat",
                headers={"Authorization": "Basic not-a-bearer"},
                json={},
            ),
            await client.post(
                "/v1/cloud/worker/heartbeat",
                headers={"Authorization": "Bearer "},
                json={},
            ),
            await client.post(
                "/v1/cloud/worker/heartbeat",
                headers={"Authorization": "Bearer definitely-not-a-worker-token"},
                json={},
            ),
            await client.post(
                "/v1/cloud/worker/heartbeat",
                headers={"Authorization": f"Bearer {worker_token}"},
                json={},
            ),
        ]
        for response in cases:
            assert response.status_code == 401, response.text
            assert response.json()["detail"]["code"] == "cloud_worker_unauthorized"
            assert "launchOptionsUploadAllowed" not in response.text

    @pytest.mark.asyncio
    async def test_desktop_worker_is_authenticated_but_never_eligible(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-snap-desktop")
        enrolled = await _enroll_worker(client, auth, install_id="install-snap-desktop")

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {enrolled['workerToken']}"},
            json={"status": "online"},
        )
        assert heartbeat.status_code == 200, heartbeat.text
        assert heartbeat.json()["launchOptionsUploadAllowed"] is False

    @pytest.mark.asyncio
    async def test_a_replayed_desktop_heartbeat_stays_false(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """The verdict is recomputed per heartbeat, and Desktop's answer is stable
        — the Worker never has to cache or age it."""
        auth = await _authed_user(client, db_session, prefix="worker-snap-replay")
        enrolled = await _enroll_worker(client, auth, install_id="install-snap-replay")
        headers = {"Authorization": f"Bearer {enrolled['workerToken']}"}

        for _ in range(3):
            response = await client.post("/v1/cloud/worker/heartbeat", headers=headers, json={})
            assert response.status_code == 200, response.text
            assert response.json()["launchOptionsUploadAllowed"] is False


class TestHeartbeatServiceRevalidatesTheWorkerRow:
    """REL-10: the post-auth deletion/revocation race is a 401, not a false verdict.

    The request dependency resolved the Worker row before the service ran. If the
    row is deleted or revoked in that window, ``record_heartbeat`` must raise the
    same ``401 cloud_worker_unauthorized`` and produce no heartbeat body — a
    missing Worker is never modelled as "authenticated but ineligible".
    """

    @pytest.mark.asyncio
    async def test_a_deleted_worker_row_raises_401_not_a_false_verdict(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        from proliferate.server.api_errors import CloudApiError
        from proliferate.server.seam.workers.service import record_heartbeat

        auth = await _authed_user(client, db_session, prefix="worker-snap-race-gone")
        enrolled = await _enroll_worker(client, auth, install_id="install-snap-race-gone")
        worker_id = uuid.UUID(enrolled["workerId"])

        # The authenticated context exists; the row does not any more.
        worker = await db_session.get(CloudRuntimeWorker, worker_id)
        assert worker is not None
        await db_session.delete(worker)
        await db_session.commit()

        with pytest.raises(CloudApiError) as raised:
            await record_heartbeat(db_session, worker_id=worker_id)
        assert raised.value.status_code == 401
        assert raised.value.code == "cloud_worker_unauthorized"

    @pytest.mark.asyncio
    async def test_a_revoked_worker_row_raises_401_not_a_false_verdict(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        from proliferate.server.api_errors import CloudApiError
        from proliferate.server.seam.workers.service import record_heartbeat

        auth = await _authed_user(client, db_session, prefix="worker-snap-race-revoked")
        enrolled = await _enroll_worker(client, auth, install_id="install-snap-race-revoked")
        worker_id = uuid.UUID(enrolled["workerId"])

        worker = await db_session.get(CloudRuntimeWorker, worker_id)
        assert worker is not None
        worker.status = "revoked"
        db_session.add(worker)
        await db_session.commit()

        with pytest.raises(CloudApiError) as raised:
            await record_heartbeat(db_session, worker_id=worker_id)
        assert raised.value.status_code == 401
        assert raised.value.code == "cloud_worker_unauthorized"

    @pytest.mark.asyncio
    async def test_a_live_worker_row_still_produces_a_normal_verdict(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """Negative control for the two race assertions above: the same direct
        service call succeeds while the row is live."""
        auth = await _authed_user(client, db_session, prefix="worker-snap-race-live")
        enrolled = await _enroll_worker(client, auth, install_id="install-snap-race-live")

        from proliferate.server.seam.workers.service import record_heartbeat

        response = await record_heartbeat(db_session, worker_id=uuid.UUID(enrolled["workerId"]))
        assert response.launch_options_upload_allowed is False
        assert response.worker_id == enrolled["workerId"]
