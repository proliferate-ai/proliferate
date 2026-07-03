from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
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
