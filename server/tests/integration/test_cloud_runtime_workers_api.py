from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account


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
