"""Target-scoped desired runtime versions (decision 1 of Make Managed Runtime
Updates Supervisor-Owned).

Covers the deterministic Python side of the frozen spec's test matrix:
heartbeat overlay (target overrides pin; A != B isolation; null inherits pin;
replayed heartbeats stable), the ``desiredTopology`` D5 signal, and the
admin-authenticated setter route's auth + validation.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import instance_organizations as instance_organization_store
from proliferate.server.cloud.runtime_workers.service import create_cloud_sandbox_enrollment
from tests.e2e.cloud.helpers.auth import create_user_and_login


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


async def _seed_owner(db_session: AsyncSession, *, prefix: str) -> User:
    user = User(
        email=f"{prefix}-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _seed_sandbox(db_session: AsyncSession, *, prefix: str) -> CloudSandbox:
    owner = await _seed_owner(db_session, prefix=prefix)
    sandbox = CloudSandbox(
        owner_user_id=owner.id,
        provider_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
        status=CloudSandboxStatus.ready,
    )
    db_session.add(sandbox)
    await db_session.commit()
    return sandbox


async def _enroll_sandbox_worker(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    sandbox: CloudSandbox,
) -> str:
    """Enroll a cloud-sandbox worker (not a desktop worker) and return its bearer token."""
    token = await create_cloud_sandbox_enrollment(
        db_session,
        cloud_sandbox_id=sandbox.id,
        owner_user_id=sandbox.owner_user_id,
    )
    await db_session.commit()
    enroll = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
    assert enroll.status_code == 200, enroll.text
    return enroll.json()["workerToken"]


async def _heartbeat(client: AsyncClient, worker_token: str) -> dict:
    response = await client.post(
        "/v1/cloud/worker/heartbeat",
        headers={"Authorization": f"Bearer {worker_token}"},
        json={},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _make_instance_admin(db_session: AsyncSession, *, user_id: str, role: str) -> None:
    now = datetime.now(UTC)
    instance_org = await instance_organization_store.get_instance_organization(db_session)
    if instance_org is None:
        organization = Organization(
            name="Instance Org",
            slug=f"instance-{uuid.uuid4().hex[:8]}",
            status=ORGANIZATION_STATUS_ACTIVE,
            is_instance=True,
            created_at=now,
            updated_at=now,
        )
        db_session.add(organization)
        await db_session.flush()
        organization_id = organization.id
    else:
        organization_id = instance_org.id
    db_session.add(
        OrganizationMembership(
            organization_id=organization_id,
            user_id=uuid.UUID(user_id),
            role=role,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()


class TestHeartbeatDesiredVersionsOverlay:
    @pytest.mark.asyncio
    async def test_target_override_wins_over_global_pin(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("WORKER_VERSION", "1.0.0")
        monkeypatch.setenv("RUNTIME_VERSION", "1.0.0")
        sandbox = await _seed_sandbox(db_session, prefix="overlay-a")
        sandbox.desired_anyharness_version = "9.9.9"
        sandbox.desired_worker_version = "8.8.8"
        db_session.add(sandbox)
        await db_session.commit()

        worker_token = await _enroll_sandbox_worker(client, db_session, sandbox=sandbox)
        body = await _heartbeat(client, worker_token)

        assert body["desiredVersions"]["anyharness"] == "9.9.9"
        assert body["desiredVersions"]["worker"] == "8.8.8"

    @pytest.mark.asyncio
    async def test_null_inherits_global_pin(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("WORKER_VERSION", "2.0.0")
        monkeypatch.setenv("RUNTIME_VERSION", "3.0.0")
        sandbox = await _seed_sandbox(db_session, prefix="overlay-null")
        worker_token = await _enroll_sandbox_worker(client, db_session, sandbox=sandbox)

        body = await _heartbeat(client, worker_token)

        assert body["desiredVersions"]["anyharness"] == "3.0.0"
        assert body["desiredVersions"]["worker"] == "2.0.0"

    @pytest.mark.asyncio
    async def test_target_isolation_a_does_not_affect_b(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("WORKER_VERSION", "1.0.0")
        monkeypatch.setenv("RUNTIME_VERSION", "1.0.0")
        sandbox_a = await _seed_sandbox(db_session, prefix="isolate-a")
        sandbox_b = await _seed_sandbox(db_session, prefix="isolate-b")
        sandbox_a.desired_anyharness_version = "5.5.5"
        sandbox_a.desired_worker_version = "5.5.5"
        db_session.add(sandbox_a)
        await db_session.commit()

        token_a = await _enroll_sandbox_worker(client, db_session, sandbox=sandbox_a)
        token_b = await _enroll_sandbox_worker(client, db_session, sandbox=sandbox_b)

        body_a = await _heartbeat(client, token_a)
        body_b = await _heartbeat(client, token_b)

        assert body_a["desiredVersions"]["anyharness"] == "5.5.5"
        assert body_a["desiredVersions"]["worker"] == "5.5.5"
        # B was never touched: it still inherits the global pin.
        assert body_b["desiredVersions"]["anyharness"] == "1.0.0"
        assert body_b["desiredVersions"]["worker"] == "1.0.0"

    @pytest.mark.asyncio
    async def test_replayed_heartbeats_are_stable(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("WORKER_VERSION", "1.0.0")
        monkeypatch.setenv("RUNTIME_VERSION", "1.0.0")
        sandbox = await _seed_sandbox(db_session, prefix="replay")
        sandbox.desired_anyharness_version = "7.7.7"
        db_session.add(sandbox)
        await db_session.commit()
        worker_token = await _enroll_sandbox_worker(client, db_session, sandbox=sandbox)

        first = await _heartbeat(client, worker_token)
        second = await _heartbeat(client, worker_token)
        third = await _heartbeat(client, worker_token)

        assert first["desiredVersions"] == second["desiredVersions"] == third["desiredVersions"]
        assert third["desiredVersions"]["anyharness"] == "7.7.7"

    @pytest.mark.asyncio
    async def test_desktop_worker_never_overlays_or_signals_topology(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A desktop worker (no cloud_sandbox_id) keeps pins-only, pre-PR behavior."""
        monkeypatch.setattr(settings, "supervisor_owned_runtime", True)
        auth = await create_user_and_login(client, db_session, email_prefix="desktop-overlay")
        enrollment = await client.post(
            "/v1/cloud/workers/desktop/enrollment",
            headers=auth.headers,
            json={"desktopInstallId": "install-overlay"},
        )
        assert enrollment.status_code == 200, enrollment.text
        enroll = await client.post(
            "/v1/cloud/worker/enroll",
            json={"enrollmentToken": enrollment.json()["enrollmentToken"]},
        )
        worker_token = enroll.json()["workerToken"]

        body = await _heartbeat(client, worker_token)

        assert body.get("desiredTopology") is None

    @pytest.mark.asyncio
    async def test_desired_topology_only_signalled_when_flag_on(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        sandbox = await _seed_sandbox(db_session, prefix="topology")
        worker_token = await _enroll_sandbox_worker(client, db_session, sandbox=sandbox)

        monkeypatch.setattr(settings, "supervisor_owned_runtime", False)
        off_body = await _heartbeat(client, worker_token)
        assert off_body.get("desiredTopology") is None

        monkeypatch.setattr(settings, "supervisor_owned_runtime", True)
        on_body = await _heartbeat(client, worker_token)
        assert on_body["desiredTopology"] == "supervisor_owned"


class TestSetSandboxDesiredVersionsRoute:
    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient) -> None:
        response = await client.put(
            f"/v1/cloud/workers/admin/sandboxes/{uuid.uuid4()}/desired-versions",
            json={"desiredAnyharnessVersion": "1.2.3"},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_non_admin_member_is_rejected(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        sandbox = await _seed_sandbox(db_session, prefix="setter-noadmin")
        auth = await create_user_and_login(client, db_session, email_prefix="setter-noadmin")
        await _make_instance_admin(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_MEMBER
        )

        response = await client.put(
            f"/v1/cloud/workers/admin/sandboxes/{sandbox.id}/desired-versions",
            headers=auth.headers,
            json={"desiredAnyharnessVersion": "1.2.3"},
        )
        assert response.status_code == 403, response.text

    @pytest.mark.asyncio
    async def test_admin_can_set_and_clear_desired_versions(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        sandbox = await _seed_sandbox(db_session, prefix="setter-admin")
        auth = await create_user_and_login(client, db_session, email_prefix="setter-admin")
        await _make_instance_admin(db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_ADMIN)

        set_response = await client.put(
            f"/v1/cloud/workers/admin/sandboxes/{sandbox.id}/desired-versions",
            headers=auth.headers,
            json={"desiredAnyharnessVersion": "4.5.6", "desiredWorkerVersion": "7.8.9"},
        )
        assert set_response.status_code == 200, set_response.text
        body = set_response.json()
        assert body["cloudSandboxId"] == str(sandbox.id)
        assert body["desiredAnyharnessVersion"] == "4.5.6"
        assert body["desiredWorkerVersion"] == "7.8.9"

        clear_response = await client.put(
            f"/v1/cloud/workers/admin/sandboxes/{sandbox.id}/desired-versions",
            headers=auth.headers,
            json={},
        )
        assert clear_response.status_code == 200, clear_response.text
        cleared = clear_response.json()
        assert cleared["desiredAnyharnessVersion"] is None
        assert cleared["desiredWorkerVersion"] is None

    @pytest.mark.asyncio
    async def test_rejects_overlong_version(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        sandbox = await _seed_sandbox(db_session, prefix="setter-long")
        auth = await create_user_and_login(client, db_session, email_prefix="setter-long")
        await _make_instance_admin(db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_ADMIN)

        response = await client.put(
            f"/v1/cloud/workers/admin/sandboxes/{sandbox.id}/desired-versions",
            headers=auth.headers,
            json={"desiredAnyharnessVersion": "v" * 65},
        )
        assert response.status_code == 422, response.text

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "unsafe",
        ["../evil", "a/b", "..", "", "with space", "semi;colon"],
    )
    async def test_rejects_unsafe_version_identifier(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        unsafe: str,
    ) -> None:
        # A desired version becomes a path-embedded identifier (CDN redirect +
        # mailbox request), so an unsafe value must 422 at the edge, not just be
        # length-bounded (R9-013).
        sandbox = await _seed_sandbox(db_session, prefix="setter-unsafe")
        auth = await create_user_and_login(client, db_session, email_prefix="setter-unsafe")
        await _make_instance_admin(db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_ADMIN)

        response = await client.put(
            f"/v1/cloud/workers/admin/sandboxes/{sandbox.id}/desired-versions",
            headers=auth.headers,
            json={"desiredAnyharnessVersion": unsafe},
        )
        assert response.status_code == 422, response.text

    @pytest.mark.asyncio
    async def test_unknown_sandbox_is_not_found(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(client, db_session, email_prefix="setter-missing")
        await _make_instance_admin(db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_ADMIN)

        response = await client.put(
            f"/v1/cloud/workers/admin/sandboxes/{uuid.uuid4()}/desired-versions",
            headers=auth.headers,
            json={"desiredAnyharnessVersion": "1.0.0"},
        )
        assert response.status_code == 404, response.text
