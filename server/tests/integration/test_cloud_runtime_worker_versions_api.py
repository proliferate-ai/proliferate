"""Worker version convergence + artifact download (split from the main runtime-workers suite)."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
from tests.integration.test_cloud_runtime_workers_api import (
    _authed_user,
    _desktop_enrollment_token,
)


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


async def _worker_row(db_session: AsyncSession, worker_id: str) -> CloudRuntimeWorker:
    db_session.expire_all()
    return (
        await db_session.execute(
            select(CloudRuntimeWorker).where(CloudRuntimeWorker.id == UUID(worker_id))
        )
    ).scalar_one()


class TestRuntimeWorkerVersionConvergence:
    @pytest.mark.asyncio
    async def test_enroll_persists_reported_metadata(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-meta")
        token = await _desktop_enrollment_token(client, auth, install_id="install-meta")

        enroll = await client.post(
            "/v1/cloud/worker/enroll",
            json={
                "enrollmentToken": token,
                "machineFingerprint": "fp-abc123",
                "hostname": "build-box",
                "workerVersion": "0.1.0",
                "anyharnessVersion": "0.4.2",
            },
        )
        assert enroll.status_code == 200, enroll.text

        row = await _worker_row(db_session, enroll.json()["workerId"])
        assert row.machine_fingerprint == "fp-abc123"
        assert row.hostname == "build-box"
        assert row.worker_version == "0.1.0"
        assert row.anyharness_version == "0.4.2"

    @pytest.mark.asyncio
    async def test_heartbeat_returns_desired_versions_from_pins(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("WORKER_VERSION", "9.9.9")
        monkeypatch.setenv("RUNTIME_VERSION", "8.8.8")
        auth = await _authed_user(client, db_session, prefix="worker-pins")
        token = await _desktop_enrollment_token(client, auth, install_id="install-pins")
        enroll = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
        worker_token = enroll.json()["workerToken"]

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_token}"},
            json={},
        )
        assert heartbeat.status_code == 200, heartbeat.text
        desired = heartbeat.json()["desiredVersions"]
        assert desired["worker"] == "9.9.9"
        assert desired["anyharness"] == "8.8.8"
        assert "catalogVersion" in desired

    @pytest.mark.asyncio
    async def test_heartbeat_includes_catalog_version(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-catalog")
        token = await _desktop_enrollment_token(client, auth, install_id="install-catalog")
        enroll = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
        worker_token = enroll.json()["workerToken"]

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_token}"},
            json={},
        )
        assert heartbeat.status_code == 200, heartbeat.text
        desired = heartbeat.json()["desiredVersions"]
        assert "catalogVersion" in desired
        # The catalog version should be present and a non-empty string
        assert isinstance(desired["catalogVersion"], str)
        assert len(desired["catalogVersion"]) > 0

    @pytest.mark.asyncio
    async def test_heartbeat_omits_worker_pin_when_unstamped(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # No WORKER_VERSION stamp (local dev / plain docker build): pinning
        # the server-version fallback would drive self-updating workers into
        # perpetual swap attempts, so the pin must be absent instead.
        monkeypatch.delenv("WORKER_VERSION", raising=False)
        auth = await _authed_user(client, db_session, prefix="worker-nopin")
        token = await _desktop_enrollment_token(client, auth, install_id="install-nopin")
        enroll = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
        worker_token = enroll.json()["workerToken"]

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_token}"},
            json={},
        )
        assert heartbeat.status_code == 200, heartbeat.text
        assert heartbeat.json()["desiredVersions"]["worker"] is None

    @pytest.mark.asyncio
    async def test_enroll_and_heartbeat_reject_overlong_metadata(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        # Values wider than the DB columns must 422 at the edge instead of
        # blowing up as a StringDataRightTruncation 500 mid-transaction.
        auth = await _authed_user(client, db_session, prefix="worker-long")
        token = await _desktop_enrollment_token(client, auth, install_id="install-long")

        enroll = await client.post(
            "/v1/cloud/worker/enroll",
            json={"enrollmentToken": token, "workerVersion": "v" * 65},
        )
        assert enroll.status_code == 422, enroll.text

        # The token survives the rejected request and still enrolls.
        enroll = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
        assert enroll.status_code == 200, enroll.text
        worker_token = enroll.json()["workerToken"]

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_token}"},
            json={"anyharnessVersion": "v" * 65},
        )
        assert heartbeat.status_code == 422, heartbeat.text

    @pytest.mark.asyncio
    async def test_heartbeat_reports_update_worker_versions(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-swap")
        token = await _desktop_enrollment_token(client, auth, install_id="install-swap")
        enroll = await client.post(
            "/v1/cloud/worker/enroll",
            json={"enrollmentToken": token, "workerVersion": "0.1.0"},
        )
        worker_id = enroll.json()["workerId"]
        worker_token = enroll.json()["workerToken"]

        # Post-swap the worker reports what it now runs.
        swap = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_token}"},
            json={"workerVersion": "0.2.0", "anyharnessVersion": "0.5.0"},
        )
        assert swap.status_code == 200, swap.text
        row = await _worker_row(db_session, worker_id)
        assert row.worker_version == "0.2.0"
        assert row.anyharness_version == "0.5.0"

        # A version-less heartbeat never clears what was recorded.
        plain = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_token}"},
            json={},
        )
        assert plain.status_code == 200
        row = await _worker_row(db_session, worker_id)
        assert row.worker_version == "0.2.0"
        assert row.anyharness_version == "0.5.0"


class TestWorkerArtifactDownload:
    @pytest.fixture(autouse=True)
    def _pinned_cdn(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("DESKTOP_DOWNLOADS_BASE_URL", raising=False)
        monkeypatch.setenv("WORKER_VERSION", "1.2.3")

    def _stub_probe(self, monkeypatch: pytest.MonkeyPatch, *, exists: bool) -> list[str]:
        from proliferate.server.cloud.runtime_workers import service as service_module

        probed: list[str] = []

        async def probe(url: str) -> bool:
            probed.append(url)
            return exists

        monkeypatch.setattr(service_module, "versioned_manifest_exists", probe)
        return probed

    @pytest.mark.asyncio
    async def test_download_redirects_to_pinned_artifact(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._stub_probe(monkeypatch, exists=True)
        for asset in ("proliferate-worker", "proliferate-worker.sha256"):
            response = await client.get(f"/v1/cloud/worker/download/linux-x86_64/{asset}")
            assert response.status_code == 302, response.text
            assert response.headers["location"] == (
                f"https://downloads.proliferate.com/worker/stable/1.2.3/linux-x86_64/{asset}"
            )

    @pytest.mark.asyncio
    async def test_download_falls_back_when_pin_unpublished(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        probed = self._stub_probe(monkeypatch, exists=False)
        response = await client.get("/v1/cloud/worker/download/macos-aarch64/proliferate-worker")
        assert response.status_code == 302
        assert response.headers["location"] == (
            "https://downloads.proliferate.com/worker/stable/macos-aarch64/proliferate-worker"
        )
        assert probed == [
            "https://downloads.proliferate.com/worker/stable/1.2.3/macos-aarch64/proliferate-worker"
        ]

    @pytest.mark.asyncio
    async def test_download_skips_probe_when_pin_unstamped(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.delenv("WORKER_VERSION", raising=False)
        probed = self._stub_probe(monkeypatch, exists=True)
        response = await client.get("/v1/cloud/worker/download/linux-aarch64/proliferate-worker")
        assert response.status_code == 302
        assert response.headers["location"] == (
            "https://downloads.proliferate.com/worker/stable/linux-aarch64/proliferate-worker"
        )
        # No pin, nothing to probe: never build a ".../None/..." URL.
        assert probed == []

    @pytest.mark.asyncio
    async def test_download_rejects_unknown_target_or_asset(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._stub_probe(monkeypatch, exists=True)
        for path in (
            "/v1/cloud/worker/download/windows-x86_64/proliferate-worker",
            "/v1/cloud/worker/download/linux-x86_64/anyharness",
        ):
            response = await client.get(path)
            assert response.status_code == 404
            assert response.json()["detail"]["code"] == "cloud_worker_artifact_unknown"
