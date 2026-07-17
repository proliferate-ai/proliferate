from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorkerEnrollment
from proliferate.db.store import runtime_workers as runtime_worker_store
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
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
    assert body["pendingTicketPolicy"] == "newest_wins"
    return body["enrollmentToken"]


class TestDesktopWorkerTicketFencing:
    @pytest.mark.asyncio
    async def test_newest_ticket_fences_an_older_worker(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-ticket-rotation")
        old_token = await _desktop_enrollment_token(
            client,
            auth,
            install_id="install-ticket-rotation",
        )
        current_token = await _desktop_enrollment_token(
            client,
            auth,
            install_id="install-ticket-rotation",
        )

        stale = await client.post(
            "/v1/cloud/worker/enroll",
            json={"enrollmentToken": old_token},
        )
        assert stale.status_code == 401
        assert stale.json()["detail"]["code"] == "cloud_worker_enrollment_invalid"

        current = await client.post(
            "/v1/cloud/worker/enroll",
            json={"enrollmentToken": current_token},
        )
        assert current.status_code == 200, current.text
        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {current.json()['workerToken']}"},
            json={},
        )
        assert heartbeat.status_code == 200, heartbeat.text

    @pytest.mark.asyncio
    async def test_concurrent_tickets_leave_exactly_one_consumable(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-ticket-race")

        async def issue_ticket() -> str:
            return await _desktop_enrollment_token(
                client,
                auth,
                install_id="install-ticket-race",
            )

        tokens = await asyncio.gather(issue_ticket(), issue_ticket())
        enrollments = [
            await client.post(
                "/v1/cloud/worker/enroll",
                json={"enrollmentToken": token},
            )
            for token in tokens
        ]

        assert sorted(response.status_code for response in enrollments) == [200, 401]
        stale = next(response for response in enrollments if response.status_code == 401)
        assert stale.json()["detail"]["code"] == "cloud_worker_enrollment_invalid"

    @pytest.mark.asyncio
    async def test_seeded_pre_fence_ticket_cannot_reclaim_after_newer_consumption(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-seeded-ticket-fence")
        install_id = "install-seeded-ticket-fence"
        owner_id = uuid.UUID(auth.user_id)
        now = datetime.now(UTC)
        old_token = "pre-fence-ticket-old"
        newer_token = "pre-fence-ticket-newer"
        db_session.add_all(
            [
                CloudRuntimeWorkerEnrollment(
                    owner_user_id=owner_id,
                    organization_id=None,
                    runtime_kind="desktop",
                    cloud_sandbox_id=None,
                    desktop_install_id=install_id,
                    created_by_user_id=owner_id,
                    token_hash=runtime_worker_store.hash_enrollment_token(old_token),
                    status="pending",
                    expires_at=now + timedelta(minutes=10),
                    created_at=now - timedelta(minutes=2),
                    updated_at=now - timedelta(minutes=2),
                ),
                CloudRuntimeWorkerEnrollment(
                    owner_user_id=owner_id,
                    organization_id=None,
                    runtime_kind="desktop",
                    cloud_sandbox_id=None,
                    desktop_install_id=install_id,
                    created_by_user_id=owner_id,
                    token_hash=runtime_worker_store.hash_enrollment_token(newer_token),
                    status="pending",
                    expires_at=now + timedelta(minutes=10),
                    created_at=now - timedelta(minutes=1),
                    updated_at=now - timedelta(minutes=1),
                ),
            ]
        )
        await db_session.commit()

        current = await client.post(
            "/v1/cloud/worker/enroll",
            json={"enrollmentToken": newer_token},
        )
        assert current.status_code == 200, current.text

        stale = await client.post(
            "/v1/cloud/worker/enroll",
            json={"enrollmentToken": old_token},
        )
        assert stale.status_code == 401
        assert stale.json()["detail"]["code"] == "cloud_worker_enrollment_invalid"

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers={"Authorization": f"Bearer {current.json()['workerToken']}"},
            json={},
        )
        assert heartbeat.status_code == 200, heartbeat.text

    @pytest.mark.asyncio
    async def test_consume_waits_for_inflight_ticket_rotation(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="worker-consume-fence")
        install_id = "install-consume-fence"
        token = await _desktop_enrollment_token(client, auth, install_id=install_id)

        # Hold the exact issuance-side lock before it mutates the pending row.
        # A consume implementation without its matching advisory lock would
        # finish here because no row lock has been taken yet.
        await runtime_worker_store.acquire_desktop_enrollment_rotation_lock(
            db_session,
            install_id,
        )
        consume = asyncio.create_task(
            client.post(
                "/v1/cloud/worker/enroll",
                json={"enrollmentToken": token},
            )
        )
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(consume), timeout=0.1)

        await runtime_worker_store.revoke_pending_desktop_enrollments_for_install(
            db_session,
            desktop_install_id=install_id,
        )
        await db_session.commit()

        stale = await asyncio.wait_for(consume, timeout=5)
        assert stale.status_code == 401
        assert stale.json()["detail"]["code"] == "cloud_worker_enrollment_invalid"
