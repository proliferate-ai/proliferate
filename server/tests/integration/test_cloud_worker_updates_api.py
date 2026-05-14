from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync import events as events_store
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.shared import AuthSession


async def _create_enrolled_target(
    client: AsyncClient,
    auth: AuthSession,
    *,
    suffix: str = "updates",
) -> tuple[str, dict[str, str]]:
    create = await client.post(
        "/v1/cloud/targets/enrollments",
        headers=auth.headers,
        json={
            "displayName": f"Update Target {suffix}",
            "kind": "ssh",
            "ownerScope": "personal",
        },
    )
    assert create.status_code == 200
    enrollment = create.json()
    worker_enroll = await client.post(
        "/v1/cloud/worker/enroll",
        json={
            "enrollmentToken": enrollment["enrollmentToken"],
            "machineFingerprint": f"{suffix}-machine",
            "hostname": f"{suffix}-target",
            "workerVersion": "0.1.0",
            "anyharnessVersion": "0.1.0",
            "supervisorVersion": "0.1.0",
        },
    )
    assert worker_enroll.status_code == 200
    worker = worker_enroll.json()
    return enrollment["target"]["id"], {"Authorization": f"Bearer {worker['workerToken']}"}


class TestCloudWorkerUpdatesApi:
    @pytest.mark.asyncio
    async def test_heartbeat_returns_desired_versions_and_worker_reports_status(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-worker-updates",
        )
        target_id, worker_headers = await _create_enrolled_target(client, auth)

        desired = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/desired-versions",
            headers=auth.headers,
            json={
                "updateChannel": "stable",
                "anyharnessVersion": "0.2.0",
                "workerVersion": "0.2.0",
                "supervisorVersion": "0.2.0",
            },
        )
        assert desired.status_code == 200
        desired_update = desired.json()["target"]["update"]
        generation = desired_update["generation"]
        assert desired_update["desiredVersions"]["workerVersion"] == "0.2.0"

        invalid_channel = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/desired-versions",
            headers=auth.headers,
            json={
                "updateChannel": "nightly/../prod",
                "workerVersion": "0.2.0",
            },
        )
        assert invalid_channel.status_code == 422

        heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers=worker_headers,
            json={
                "status": "online",
                "workerVersion": "0.1.0",
                "anyharnessVersion": "0.1.0",
                "supervisorVersion": "0.1.0",
            },
        )
        assert heartbeat.status_code == 200
        desired_versions = heartbeat.json()["desiredVersions"]
        assert desired_versions["shouldUpdate"] is True
        assert desired_versions["updateGeneration"] == generation
        assert desired_versions["workerVersion"] == "0.2.0"

        update_status = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "staged",
                "updateGeneration": generation,
                "component": "worker",
                "version": "0.2.0",
                "detail": "Artifacts staged.",
            },
        )
        assert update_status.status_code == 200
        assert update_status.json()["updated"] is True

        detail = await client.get(f"/v1/cloud/targets/{target_id}", headers=auth.headers)
        assert detail.status_code == 200
        update = detail.json()["update"]
        assert update["currentVersions"]["workerVersion"] == "0.1.0"
        assert update["currentVersions"]["anyharnessVersion"] == "0.1.0"
        assert update["currentVersions"]["supervisorVersion"] == "0.1.0"
        assert update["status"] == "staged"
        assert update["component"] == "worker"
        assert update["version"] == "0.2.0"

        reset = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/desired-versions",
            headers=auth.headers,
            json={
                "updateChannel": "stable",
                "anyharnessVersion": "0.3.0",
                "workerVersion": "0.3.0",
                "supervisorVersion": "0.3.0",
            },
        )
        assert reset.status_code == 200
        reset_update = reset.json()["target"]["update"]
        reset_generation = reset_update["generation"]
        assert reset_generation == generation + 1
        assert reset_update["status"] == "idle"
        assert reset_update["component"] is None
        assert reset_update["version"] is None

        stale_generation_status = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "staged",
                "updateGeneration": generation,
                "component": "worker",
                "version": "0.3.0",
            },
        )
        assert stale_generation_status.status_code == 409
        assert (
            stale_generation_status.json()["detail"]["code"]
            == "cloud_worker_update_generation_stale"
        )

        premature_applied_status = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "applied",
                "updateGeneration": reset_generation,
                "component": "worker",
                "version": "0.3.0",
            },
        )
        assert premature_applied_status.status_code == 409
        assert (
            premature_applied_status.json()["detail"]["code"]
            == "cloud_worker_update_versions_not_current"
        )

        staging_status = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "staging",
                "updateGeneration": reset_generation,
                "detail": "Update request received.",
            },
        )
        assert staging_status.status_code == 200

        complete_heartbeat = await client.post(
            "/v1/cloud/worker/heartbeat",
            headers=worker_headers,
            json={
                "status": "online",
                "workerVersion": "0.3.0",
                "anyharnessVersion": "0.3.0",
                "supervisorVersion": "0.3.0",
            },
        )
        assert complete_heartbeat.status_code == 200
        assert complete_heartbeat.json()["desiredVersions"]["shouldUpdate"] is False

        complete_detail = await client.get(f"/v1/cloud/targets/{target_id}", headers=auth.headers)
        assert complete_detail.status_code == 200
        complete_update = complete_detail.json()["update"]
        assert complete_update["status"] == "applied"
        assert complete_update["statusDetail"] == "Desired versions reported by worker."

        safe_after_applied = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/safe-stop-check",
            headers=auth.headers,
        )
        assert safe_after_applied.status_code == 200
        assert "update_in_progress" not in safe_after_applied.json()["reasons"]

        stale_status = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "applied",
                "updateGeneration": reset_generation,
                "component": "worker",
                "version": "0.2.0",
            },
        )
        assert stale_status.status_code == 409
        assert stale_status.json()["detail"]["code"] == "cloud_worker_update_version_stale"

        invalid_component = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "staging",
                "updateGeneration": reset_generation,
                "component": "worker/../supervisor",
                "version": "0.3.0",
            },
        )
        assert invalid_component.status_code == 400
        assert (
            invalid_component.json()["detail"]["code"] == "cloud_worker_update_component_invalid"
        )

    @pytest.mark.asyncio
    async def test_safe_stop_blocks_active_work_and_revocation_blocks_worker(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-worker-safe-stop",
        )
        target_id, worker_headers = await _create_enrolled_target(
            client,
            auth,
            suffix="safe-stop",
        )

        idle = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/safe-stop-check",
            headers=auth.headers,
        )
        assert idle.status_code == 200
        assert idle.json()["allowed"] is False
        assert "safe_stop_state_unknown" in idle.json()["reasons"]

        update_status = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "staging",
                "updateGeneration": 0,
                "detail": "Update request received.",
            },
        )
        assert update_status.status_code == 200

        update_in_progress = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/safe-stop-check",
            headers=auth.headers,
        )
        assert update_in_progress.status_code == 200
        assert update_in_progress.json()["allowed"] is False
        assert "update_in_progress" in update_in_progress.json()["reasons"]

        await events_store.upsert_session_projection(
            db_session,
            target_id=UUID(target_id),
            cloud_workspace_id=None,
            workspace_id="workspace-1",
            session_id="session-1",
            seq=1,
            occurred_at="2026-05-14T00:00:00+00:00",
            status="running",
        )
        await db_session.commit()

        active_session = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/safe-stop-check",
            headers=auth.headers,
        )
        assert active_session.status_code == 200
        assert active_session.json()["allowed"] is False
        assert "active_sessions" in active_session.json()["reasons"]

        command = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "safe-stop-command",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "cancel_turn",
                "payload": {},
            },
        )
        assert command.status_code == 200

        active_command = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/safe-stop-check",
            headers=auth.headers,
        )
        assert active_command.status_code == 200
        assert "active_commands" in active_command.json()["reasons"]

        unsafe_revoke = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/revoke-workers",
            headers=auth.headers,
        )
        assert unsafe_revoke.status_code == 409
        assert unsafe_revoke.json()["detail"]["code"] == "cloud_compute_target_active_work"

        revoke_target_id, revoke_worker_headers = await _create_enrolled_target(
            client,
            auth,
            suffix="revoke",
        )
        revoked = await client.post(
            f"/v1/cloud/compute/targets/{revoke_target_id}/revoke-workers",
            headers=auth.headers,
        )
        assert revoked.status_code == 200
        assert revoked.json()["revoked"] is True

        target_after_revoke = await client.get(
            f"/v1/cloud/targets/{revoke_target_id}",
            headers=auth.headers,
        )
        assert target_after_revoke.status_code == 200
        assert target_after_revoke.json()["status"] == "offline"
        assert target_after_revoke.json()["statusDetail"]["statusDetail"] == "Workers revoked."

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=revoke_worker_headers,
            json={"supportedKinds": ["cancel_turn"], "leaseTimeoutSeconds": 30},
        )
        assert lease.status_code == 401
        assert lease.json()["detail"]["code"] == "cloud_worker_archived"
