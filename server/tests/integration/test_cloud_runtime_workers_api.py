from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    # Enrollment mints an integration-gateway URL from the configured base;
    # CI has no .env, so provide one the way production config would.
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


async def _authed_user(client: AsyncClient, db_session: AsyncSession, *, prefix: str):
    auth = await create_user_and_login(client, db_session, email_prefix=prefix)
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=f"gh-{prefix}",
    )
    return auth


async def _desktop_enrollment_token(
    client: AsyncClient,
    auth,
    *,
    install_id: str,
) -> str:
    response = await client.post(
        "/v1/cloud/workers/desktop/enrollment",
        headers=auth.headers,
        json={"desktopInstallId": install_id},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["expiresAt"]
    return body["enrollmentToken"]


class TestRuntimeWorkerEnrollment:
    @pytest.mark.asyncio
    async def test_desktop_enrollment_requires_auth(self, client: AsyncClient) -> None:
        response = await client.post(
            "/v1/cloud/workers/desktop/enrollment",
            json={"desktopInstallId": "install-1"},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_enroll_returns_worker_and_gateway_config(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-enroll")
        token = await _desktop_enrollment_token(client, auth, install_id="install-a")

        enroll = await client.post(
            "/v1/cloud/worker/enroll",
            json={"enrollmentToken": token, "hostname": "laptop"},
        )
        assert enroll.status_code == 200, enroll.text
        body = enroll.json()
        assert body["workerId"]
        assert body["workerToken"]
        assert body["heartbeatIntervalSeconds"] == 30
        gateway = body["integrationGateway"]
        assert gateway["url"].endswith("/v1/cloud/integration-gateway/mcp")
        assert gateway["authorization"].startswith("Bearer ")

    @pytest.mark.asyncio
    async def test_enrollment_token_is_single_use(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-reuse")
        token = await _desktop_enrollment_token(client, auth, install_id="install-b")

        first = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
        assert first.status_code == 200
        second = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
        assert second.status_code == 401
        assert second.json()["detail"]["code"] == "cloud_worker_enrollment_invalid"

    @pytest.mark.asyncio
    async def test_enroll_rejects_unknown_token(self, client: AsyncClient) -> None:
        enroll = await client.post(
            "/v1/cloud/worker/enroll",
            json={"enrollmentToken": "not-a-real-token"},
        )
        assert enroll.status_code == 401

    @pytest.mark.asyncio
    async def test_heartbeat_requires_valid_worker_token(self, client: AsyncClient) -> None:
        missing = await client.post("/v1/cloud/worker/heartbeat", json={})
        assert missing.status_code == 401

        bad = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": "Bearer nope"},
            json={},
        )
        assert bad.status_code == 401

    @pytest.mark.asyncio
    async def test_heartbeat_accepts_worker_token(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-hb")
        token = await _desktop_enrollment_token(client, auth, install_id="install-c")
        enroll = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
        worker_token = enroll.json()["workerToken"]

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_token}"},
            json={"status": "online"},
        )
        assert heartbeat.status_code == 200, heartbeat.text
        assert heartbeat.json()["heartbeatIntervalSeconds"] == 30

    @pytest.mark.asyncio
    async def test_reenrollment_revokes_prior_worker(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-rotate")

        token1 = await _desktop_enrollment_token(client, auth, install_id="install-d")
        first = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token1})
        first_token = first.json()["workerToken"]

        # A second enrollment for the same install rotates the worker identity.
        token2 = await _desktop_enrollment_token(client, auth, install_id="install-d")
        second = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token2})
        second_token = second.json()["workerToken"]
        assert first_token != second_token

        # Old worker token is now revoked; new one still works.
        stale = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {first_token}"},
            json={},
        )
        assert stale.status_code == 401
        fresh = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {second_token}"},
            json={},
        )
        assert fresh.status_code == 200

    @pytest.mark.asyncio
    async def test_cross_user_enrollment_revokes_prior_users_worker(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        user_a = await _authed_user(client, db_session, prefix="worker-cross-a")
        user_b = await _authed_user(client, db_session, prefix="worker-cross-b")

        token_a = await _desktop_enrollment_token(client, user_a, install_id="install-cross")
        first = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token_a})
        assert first.status_code == 200, first.text
        first_token = first.json()["workerToken"]

        # A different user enrolling on the same install retires the
        # predecessor: only one physical worker process exists per machine, so
        # user A's worker token must not stay live once B takes over.
        token_b = await _desktop_enrollment_token(client, user_b, install_id="install-cross")
        second = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token_b})
        assert second.status_code == 200, second.text
        second_token = second.json()["workerToken"]

        stale = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {first_token}"},
            json={},
        )
        assert stale.status_code == 401
        fresh = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {second_token}"},
            json={},
        )
        assert fresh.status_code == 200


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
        assert heartbeat.json()["desiredVersions"] == {"worker": "9.9.9", "anyharness": "8.8.8"}

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


async def _enroll_worker(client: AsyncClient, auth, *, install_id: str) -> dict:
    token = await _desktop_enrollment_token(client, auth, install_id=install_id)
    enroll = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
    assert enroll.status_code == 200, enroll.text
    return enroll.json()


async def _gateway_request(client: AsyncClient, *, authorization: str):
    return await client.post(
        "/v1/cloud/integration-gateway/mcp",
        headers={"Authorization": authorization},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
    )


class TestDesktopWorkerRevoke:
    @pytest.mark.asyncio
    async def test_revoke_requires_auth(self, client: AsyncClient) -> None:
        response = await client.post(
            "/v1/cloud/workers/desktop/revoke",
            json={"desktopInstallId": "install-revoke-auth"},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_revoke_retires_worker_and_gateway_token(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-revoke")
        enrolled = await _enroll_worker(client, auth, install_id="install-revoke-a")
        worker_token = enrolled["workerToken"]
        gateway_authorization = enrolled["integrationGateway"]["authorization"]

        # The gateway token resolves before revocation.
        before = await _gateway_request(client, authorization=gateway_authorization)
        assert before.status_code == 200, before.text

        revoke = await client.post(
            "/v1/cloud/workers/desktop/revoke",
            headers=auth.headers,
            json={"desktopInstallId": "install-revoke-a"},
        )
        assert revoke.status_code == 200, revoke.text
        assert revoke.json() == {"revoked": True}

        # Worker token and gateway token are both retired.
        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_token}"},
            json={},
        )
        assert heartbeat.status_code == 401
        after = await _gateway_request(client, authorization=gateway_authorization)
        assert after.status_code == 401

    @pytest.mark.asyncio
    async def test_revoke_scopes_to_caller_not_install_id(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        owner = await _authed_user(client, db_session, prefix="worker-revoke-owner")
        other = await _authed_user(client, db_session, prefix="worker-revoke-other")
        enrolled = await _enroll_worker(client, owner, install_id="install-revoke-b")
        worker_token = enrolled["workerToken"]

        # Another user revoking the same install id is a no-op for the
        # owner's worker: the revoke keys on (caller user id, install id).
        revoke = await client.post(
            "/v1/cloud/workers/desktop/revoke",
            headers=other.headers,
            json={"desktopInstallId": "install-revoke-b"},
        )
        assert revoke.status_code == 200, revoke.text

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {worker_token}"},
            json={},
        )
        assert heartbeat.status_code == 200, heartbeat.text

    @pytest.mark.asyncio
    async def test_double_revoke_is_idempotent(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-revoke-twice")
        await _enroll_worker(client, auth, install_id="install-revoke-c")

        for _ in range(2):
            revoke = await client.post(
                "/v1/cloud/workers/desktop/revoke",
                headers=auth.headers,
                json={"desktopInstallId": "install-revoke-c"},
            )
            assert revoke.status_code == 200, revoke.text
            assert revoke.json() == {"revoked": True}

        # Revoking an install that never enrolled is also a successful no-op.
        never = await client.post(
            "/v1/cloud/workers/desktop/revoke",
            headers=auth.headers,
            json={"desktopInstallId": "install-never-enrolled"},
        )
        assert never.status_code == 200, never.text
