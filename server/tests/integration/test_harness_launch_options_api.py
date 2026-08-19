from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.models.cloud.sandboxes import CloudSandbox, HarnessLaunchOptionState
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.helpers.worker_heartbeat import enroll_sandbox_worker


async def _sandbox(db: AsyncSession, owner_user_id: uuid.UUID, label: str) -> CloudSandbox:
    row = CloudSandbox(
        owner_user_id=owner_user_id,
        provider_sandbox_id=f"launch-options-{label}-{uuid.uuid4().hex[:8]}",
        status=CloudSandboxStatus.ready,
    )
    db.add(row)
    await db.commit()
    return row


def _payload(harness: str, revision: int, model: str) -> dict[str, object]:
    return {
        "harnessKind": harness,
        "basisRevision": f"basis-{revision}",
        "revision": revision,
        "state": "observed",
        "options": {
            "models": [
                {
                    "id": model,
                    "observedName": None,
                    "observedDescription": None,
                }
            ],
            "controls": [],
            "defaults": {"modelId": model, "controlValues": {}},
        },
        "observedAt": "2026-08-19T00:00:00Z",
        "probeAttemptedAt": "2026-08-19T00:00:00Z",
        "probeFailureCode": None,
    }


async def _upload(
    client: AsyncClient,
    worker_token: str,
    harness: str,
    payload_json: str,
    revision: int,
) -> None:
    response = await client.post(
        f"/v1/cloud/harness-launch-options/{harness}",
        headers={"Authorization": f"Bearer {worker_token}"},
        json={"sourceRevision": revision, "payloadJson": payload_json},
    )
    assert response.status_code == 204, response.text


@pytest.mark.asyncio
async def test_copy_is_verbatim_monotonic_and_target_scoped(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    first_auth = await create_user_and_login(
        client, db_session, email_prefix="launch-options-copy-a"
    )
    second_auth = await create_user_and_login(
        client, db_session, email_prefix="launch-options-copy-b"
    )
    first = await _sandbox(db_session, first_auth.user_id, "first")
    second = await _sandbox(db_session, second_auth.user_id, "second")
    first_token = await enroll_sandbox_worker(client, db_session, sandbox=first)
    second_token = await enroll_sandbox_worker(client, db_session, sandbox=second)

    first_payload = json.dumps(_payload("claude", 7, "fable"), separators=(", ", ": "))
    second_payload = json.dumps(_payload("claude", 3, "opus[1m]"), separators=(",", ":"))
    await _upload(client, first_token, "claude", first_payload, 7)
    await _upload(client, second_token, "claude", second_payload, 3)

    stored = (await db_session.execute(select(HarnessLaunchOptionState))).scalars().all()
    by_target = {row.cloud_sandbox_id: row for row in stored}
    assert by_target[first.id].payload_json == first_payload
    assert by_target[second.id].payload_json == second_payload

    stale_payload = json.dumps(_payload("claude", 6, "stale-model"))
    await _upload(client, first_token, "claude", stale_payload, 6)
    await db_session.refresh(by_target[first.id])
    assert by_target[first.id].source_revision == 7
    assert by_target[first.id].payload_json == first_payload

    first_read = await client.get(
        f"/v1/cloud/harness-launch-options/sandboxes/{first.id}/claude",
        headers=first_auth.headers,
    )
    second_read = await client.get(
        f"/v1/cloud/harness-launch-options/sandboxes/{second.id}/claude",
        headers=second_auth.headers,
    )
    assert first_read.status_code == 200, first_read.text
    assert second_read.status_code == 200, second_read.text
    assert first_read.json()["options"]["models"][0]["id"] == "fable"
    assert second_read.json()["options"]["models"][0]["id"] == "opus[1m]"
    assert first_read.json()["readiness"] is None


@pytest.mark.asyncio
async def test_copied_state_is_owner_isolated_and_rejects_rebuilt_envelopes(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await create_user_and_login(client, db_session, email_prefix="launch-options-owner")
    stranger = await create_user_and_login(
        client, db_session, email_prefix="launch-options-stranger"
    )
    sandbox = await _sandbox(db_session, owner.user_id, "owner")
    worker_token = await enroll_sandbox_worker(client, db_session, sandbox=sandbox)
    payload = _payload("grok", 1, "grok-4.6")
    await _upload(client, worker_token, "grok", json.dumps(payload), 1)

    hidden = await client.get(
        f"/v1/cloud/harness-launch-options/sandboxes/{sandbox.id}/grok",
        headers=stranger.headers,
    )
    assert hidden.status_code == 404

    payload["readiness"] = "ready"
    rejected = await client.post(
        "/v1/cloud/harness-launch-options/grok",
        headers={"Authorization": f"Bearer {worker_token}"},
        json={"sourceRevision": 2, "payloadJson": json.dumps(payload)},
    )
    assert rejected.status_code == 400
    assert rejected.json()["detail"]["code"] == "invalid_launch_options_envelope"
