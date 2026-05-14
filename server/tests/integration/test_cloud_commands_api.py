from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.db.store import cloud_runtime_environments, cloud_workspaces
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.shared import AuthSession


async def _create_enrolled_target(
    client: AsyncClient,
    auth: AuthSession,
    *,
    suffix: str = "command",
) -> tuple[str, dict[str, str]]:
    create = await client.post(
        "/v1/cloud/targets/enrollments",
        headers=auth.headers,
        json={
            "displayName": f"Command Target {suffix}",
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
        },
    )
    assert worker_enroll.status_code == 200
    worker = worker_enroll.json()
    return enrollment["target"]["id"], {"Authorization": f"Bearer {worker['workerToken']}"}


async def _create_ready_cloud_workspace(
    db_session: AsyncSession,
    auth: AuthSession,
    *,
    target_id: str,
    anyharness_workspace_id: str = "workspace-1",
) -> str:
    workspace = await cloud_workspaces.create_cloud_workspace_record(
        db_session,
        user_id=UUID(auth.user_id),
        display_name="Command Workspace",
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        git_branch="main",
        git_base_branch="main",
        origin_json=None,
        template_version="test",
        commit=False,
    )
    workspace.status = CloudWorkspaceStatus.ready.value
    workspace.anyharness_workspace_id = anyharness_workspace_id
    runtime_environment = await cloud_runtime_environments.get_runtime_environment_for_workspace(
        db_session,
        workspace,
    )
    assert runtime_environment is not None
    await cloud_runtime_environments.attach_target_to_runtime_environment(
        db_session,
        runtime_environment_id=runtime_environment.id,
        target_id=UUID(target_id),
    )
    await db_session.commit()
    return str(workspace.id)


class TestCloudCommandsApi:
    @pytest.mark.asyncio
    async def test_user_command_is_leased_delivered_and_accepted_by_worker(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-commands",
        )
        target_id, worker_headers = await _create_enrolled_target(client, auth)

        command_body = {
            "idempotencyKey": "prompt-1",
            "targetId": target_id,
            "workspaceId": "workspace-1",
            "sessionId": "session-1",
            "kind": "send_prompt",
            "payload": {
                "promptId": "cloud-prompt-1",
                "blocks": [{"type": "text", "text": "hello from web"}],
            },
            "observedEventSeq": 10,
            "source": "web",
        }
        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json=command_body,
        )
        assert created.status_code == 200
        command = created.json()
        assert command["status"] == "queued"
        assert command["targetId"] == target_id

        duplicate = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json=command_body,
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["commandId"] == command["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["send_prompt", "resolve_interaction"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased_command = lease.json()["command"]
        assert leased_command["commandId"] == command["commandId"]
        assert leased_command["payload"]["blocks"][0]["text"] == "hello from web"
        assert leased_command["observedEventSeq"] == 10

        delivery = await client.post(
            f"/v1/cloud/worker/commands/{command['commandId']}/delivery",
            headers=worker_headers,
            json={"leaseId": leased_command["leaseId"], "status": "delivered"},
        )
        assert delivery.status_code == 200
        assert delivery.json()["status"] == "delivered"

        result = await client.post(
            f"/v1/cloud/worker/commands/{command['commandId']}/result",
            headers=worker_headers,
            json={
                "leaseId": leased_command["leaseId"],
                "status": "accepted",
                "result": {"anyharnessStatus": "running"},
            },
        )
        assert result.status_code == 200
        assert result.json()["status"] == "accepted"

        status = await client.get(
            f"/v1/cloud/commands/{command['commandId']}",
            headers=auth.headers,
        )
        assert status.status_code == 200
        assert status.json()["status"] == "accepted"

        duplicate_result = await client.post(
            f"/v1/cloud/worker/commands/{command['commandId']}/result",
            headers=worker_headers,
            json={
                "leaseId": leased_command["leaseId"],
                "status": "rejected",
                "errorCode": "late_duplicate",
            },
        )
        assert duplicate_result.status_code == 200
        assert duplicate_result.json()["status"] == "accepted"

    @pytest.mark.asyncio
    async def test_start_session_command_requires_workspace_not_session(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-start-session",
        )
        target_id, worker_headers = await _create_enrolled_target(client, auth)
        cloud_workspace_id = await _create_ready_cloud_workspace(
            db_session,
            auth,
            target_id=target_id,
            anyharness_workspace_id="workspace-1",
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "start-session-1",
                "targetId": target_id,
                "workspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {"agentKind": "codex"},
                "source": "automation",
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["start_session"], "leaseTimeoutSeconds": 30},
        )
        assert lease.status_code == 200
        leased_command = lease.json()["command"]
        assert leased_command["commandId"] == command_id
        assert leased_command["sessionId"] is None
        assert leased_command["workspaceId"] == "workspace-1"
        assert leased_command["payload"]["workspaceId"] == "workspace-1"

        missing_workspace = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "start-session-missing-workspace",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {"agentKind": "codex"},
            },
        )
        assert missing_workspace.status_code == 400
        assert missing_workspace.json()["detail"]["code"] == "cloud_command_workspace_required"

        arbitrary_workspace = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "start-session-arbitrary-workspace",
                "targetId": target_id,
                "workspaceId": "workspace-1",
                "kind": "start_session",
                "payload": {"agentKind": "codex"},
            },
        )
        assert arbitrary_workspace.status_code == 404
        assert arbitrary_workspace.json()["detail"]["code"] == "cloud_command_workspace_not_found"

    @pytest.mark.asyncio
    async def test_close_session_command_requires_session(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-close-session",
        )
        target_id, worker_headers = await _create_enrolled_target(client, auth)

        missing_session = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "close-session-missing-session",
                "targetId": target_id,
                "kind": "close_session",
                "payload": {},
            },
        )
        assert missing_session.status_code == 400
        assert missing_session.json()["detail"]["code"] == "cloud_command_session_required"

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "close-session-1",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "close_session",
                "payload": {},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["close_session"], "leaseTimeoutSeconds": 30},
        )
        assert lease.status_code == 200
        assert lease.json()["command"]["commandId"] == command_id

    @pytest.mark.asyncio
    async def test_stale_command_lease_can_be_recovered(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-lease",
        )
        target_id, worker_headers = await _create_enrolled_target(client, auth)
        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "stale-lease",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "cancel_turn",
                "payload": {},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        first = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["cancel_turn"], "leaseTimeoutSeconds": 0},
        )
        assert first.status_code == 200
        first_lease = first.json()["command"]["leaseId"]

        recovered = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["cancel_turn"], "leaseTimeoutSeconds": 30},
        )
        assert recovered.status_code == 200
        recovered_command = recovered.json()["command"]
        assert recovered_command["commandId"] == command_id
        assert recovered_command["leaseId"] != first_lease

        stale_result = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={"leaseId": first_lease, "status": "accepted"},
        )
        assert stale_result.status_code == 404
        assert stale_result.json()["detail"]["code"] == "cloud_worker_command_not_leased"

    @pytest.mark.asyncio
    async def test_delivered_command_is_not_released_after_lease_expires(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-delivered",
        )
        target_id, worker_headers = await _create_enrolled_target(client, auth)
        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "delivered-lease",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "send_prompt",
                "payload": {"text": "do not duplicate"},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        first = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["send_prompt"], "leaseTimeoutSeconds": 0},
        )
        assert first.status_code == 200
        first_lease = first.json()["command"]["leaseId"]

        delivery = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/delivery",
            headers=worker_headers,
            json={"leaseId": first_lease, "status": "delivered"},
        )
        assert delivery.status_code == 200
        assert delivery.json()["status"] == "delivered"

        recovered = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["send_prompt"], "leaseTimeoutSeconds": 30},
        )
        assert recovered.status_code == 200
        assert recovered.json()["command"] is None

        result = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={"leaseId": first_lease, "status": "accepted"},
        )
        assert result.status_code == 200
        assert result.json()["status"] == "accepted"

    @pytest.mark.asyncio
    async def test_idempotency_key_is_scoped_to_target(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-idempotency",
        )
        first_target_id, _first_worker_headers = await _create_enrolled_target(
            client,
            auth,
            suffix="first",
        )
        second_target_id, _second_worker_headers = await _create_enrolled_target(
            client,
            auth,
            suffix="second",
        )

        first = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "same-key",
                "targetId": first_target_id,
                "sessionId": "session-1",
                "kind": "cancel_turn",
                "payload": {},
            },
        )
        assert first.status_code == 200

        second = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "same-key",
                "targetId": second_target_id,
                "sessionId": "session-1",
                "kind": "cancel_turn",
                "payload": {},
            },
        )
        assert second.status_code == 200
        assert second.json()["commandId"] != first.json()["commandId"]
        assert second.json()["targetId"] == second_target_id

        same_target_different_session = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "same-key",
                "targetId": first_target_id,
                "sessionId": "session-2",
                "kind": "cancel_turn",
                "payload": {},
            },
        )
        assert same_target_different_session.status_code == 200
        assert same_target_different_session.json()["commandId"] != first.json()["commandId"]

    @pytest.mark.asyncio
    async def test_unsupported_command_kind_is_rejected(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-kind",
        )
        target_id, _worker_headers = await _create_enrolled_target(client, auth)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "unsupported-command-kind",
                "targetId": target_id,
                "kind": "archive_session",
                "payload": {},
            },
        )
        assert created.status_code == 400
        assert created.json()["detail"]["code"] == "cloud_command_kind_unsupported"

    @pytest.mark.asyncio
    async def test_preconditions_are_rejected_until_supported(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-preconditions",
        )
        target_id, _worker_headers = await _create_enrolled_target(client, auth)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "with-preconditions",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "send_prompt",
                "payload": {"text": "hello"},
                "preconditions": {"interactionVersion": 1},
            },
        )
        assert created.status_code == 400
        assert created.json()["detail"]["code"] == "cloud_command_preconditions_unsupported"
