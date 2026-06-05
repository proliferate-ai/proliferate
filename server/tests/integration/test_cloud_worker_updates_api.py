from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store.cloud_sync import projections as projections_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account
from tests.e2e.cloud.helpers.shared import AuthSession


async def _create_enrolled_target(
    client: AsyncClient,
    db_session: AsyncSession,
    auth: AuthSession,
    *,
    suffix: str = "updates",
) -> tuple[str, dict[str, str]]:
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=f"gh-{suffix}-token",
    )
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
    worker_headers = {"Authorization": f"Bearer {worker['workerToken']}"}
    await _accept_initial_git_identity_command(client, worker_headers)
    return enrollment["target"]["id"], worker_headers


async def _accept_initial_git_identity_command(
    client: AsyncClient,
    worker_headers: dict[str, str],
) -> None:
    lease = await client.post(
        "/v1/cloud/worker/commands/lease",
        headers=worker_headers,
        json={"supportedKinds": ["configure_git_identity"], "leaseTimeoutSeconds": 300},
    )
    assert lease.status_code == 200
    command = lease.json()["command"]
    if command is None:
        return
    result = await client.post(
        f"/v1/cloud/worker/commands/{command['commandId']}/result",
        headers=worker_headers,
        json={
            "leaseId": command["leaseId"],
            "status": "accepted",
            "result": {"provider": "github"},
        },
    )
    assert result.status_code == 200


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
        target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)

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

        patch = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/desired-versions",
            headers=auth.headers,
            json={"workerVersion": "0.2.1"},
        )
        assert patch.status_code == 200
        patch_update = patch.json()["target"]["update"]
        generation = patch_update["generation"]
        assert patch_update["channel"] == "stable"
        assert patch_update["desiredVersions"]["anyharnessVersion"] == "0.2.0"
        assert patch_update["desiredVersions"]["workerVersion"] == "0.2.1"
        assert patch_update["desiredVersions"]["supervisorVersion"] == "0.2.0"

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
        assert desired_versions["workerVersion"] == "0.2.1"

        update_status = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "staged",
                "updateGeneration": generation,
                "component": "worker",
                "version": "0.2.1",
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
        assert update["version"] == "0.2.1"

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
            db_session,
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

        unsolicited_update_status = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "staging",
                "updateGeneration": 0,
                "detail": "Update request received.",
            },
        )
        assert unsolicited_update_status.status_code == 409
        assert (
            unsolicited_update_status.json()["detail"]["code"]
            == "cloud_worker_update_not_requested"
        )

        desired = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/desired-versions",
            headers=auth.headers,
            json={"workerVersion": "0.2.0"},
        )
        assert desired.status_code == 200
        generation = desired.json()["target"]["update"]["generation"]

        update_status = await client.post(
            "/v1/cloud/worker/update-status",
            headers=worker_headers,
            json={
                "status": "staging",
                "updateGeneration": generation,
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

        update_revoke = await client.post(
            f"/v1/cloud/compute/targets/{target_id}/revoke-workers",
            headers=auth.headers,
        )
        assert update_revoke.status_code == 409
        assert update_revoke.json()["detail"]["code"] == "cloud_compute_target_update_in_progress"

        billing_subject = await ensure_personal_billing_subject(db_session, auth.user_id)
        workspace = CloudWorkspace(
            user_id=auth.user_id,
            owner_scope="personal",
            owner_user_id=auth.user_id,
            organization_id=None,
            created_by_user_id=auth.user_id,
            billing_subject_id=billing_subject.id,
            target_id=UUID(target_id),
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            normalized_repo_key="github/acme/rocket",
            git_branch="main",
            git_base_branch="main",
            worktree_path="/workspace/rocket",
            origin="manual_web",
            origin_json='{"kind":"human","entrypoint":"cloud"}',
            status="ready",
            status_detail="Ready",
            template_version="v1",
            runtime_generation=0,
            anyharness_workspace_id="workspace-1",
            repo_post_ready_phase="idle",
            repo_post_ready_files_total=0,
            repo_post_ready_files_applied=0,
            cleanup_state="none",
        )
        db_session.add(workspace)
        await db_session.flush()
        await exposures_store.upsert_workspace_exposure(
            db_session,
            target_id=UUID(target_id),
            cloud_workspace_id=workspace.id,
            anyharness_workspace_id="workspace-1",
            owner_scope="personal",
            owner_user_id=auth.user_id,
            organization_id=None,
            visibility="private",
            default_projection_level="live",
            commandable=True,
            origin="manual_web",
        )
        await projections_store.upsert_session_projection(
            db_session,
            target_id=UUID(target_id),
            cloud_workspace_id=workspace.id,
            workspace_id="workspace-1",
            session_id="session-1",
            seq=1,
            occurred_at="2026-05-14T00:00:00+00:00",
            status="idle",
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
                "cloudWorkspaceId": str(workspace.id),
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
            db_session,
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
