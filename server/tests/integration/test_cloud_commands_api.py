from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.cloud.helpers.auth import AuthSession, create_user_and_login


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
                "idempotencyKey": "start-session-not-yet",
                "targetId": target_id,
                "kind": "start_session",
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
