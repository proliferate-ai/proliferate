from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.cloud.helpers.auth import AuthSession, create_user_and_login


async def _create_enrolled_target(
    client: AsyncClient,
    auth: AuthSession,
) -> tuple[str, dict[str, str]]:
    create = await client.post(
        "/v1/cloud/targets/enrollments",
        headers=auth.headers,
        json={
            "displayName": "Command Target",
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
            "machineFingerprint": "command-machine",
            "hostname": "command-target",
            "workerVersion": "0.1.0",
        },
    )
    assert worker_enroll.status_code == 200
    worker = worker_enroll.json()
    return enrollment["target"]["id"], {"Authorization": f"Bearer {worker['workerToken']}"}


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
                "idempotencyKey": "start-session-not-yet",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {},
            },
        )
        assert created.status_code == 400
        assert created.json()["detail"]["code"] == "cloud_command_kind_unsupported"
