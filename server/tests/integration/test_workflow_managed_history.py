"""Real-Postgres keyset and ownership proof for Workflow history."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.workflows import WorkflowInvocation
from proliferate.db.store.workflow_managed_history import decode_cursor
from tests.integration.cloud_api_helpers import register_and_login
from tests.integration.test_workflow_managed_execution_api import _definition, _headers


def _invocation_body(definition_id: str) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "workflowDefinitionId": definition_id,
        "expectedRevision": 1,
        "arguments": {"ticket": "PROL-123"},
        "target": {"kind": "managedCloud"},
    }


@pytest.mark.parametrize("cursor", ["a", "not-base64!", "", "x" * 513])
def test_cursor_decoder_rejects_malformed_values(cursor: str) -> None:
    with pytest.raises(ValueError, match="Invalid workflow history cursor"):
        decode_cursor(cursor)


def test_cursor_decoder_rejects_forged_naive_timestamp() -> None:
    raw = json.dumps(["2026-07-16T12:00:00", str(uuid4())]).encode()
    cursor = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    with pytest.raises(ValueError, match="Invalid workflow history cursor"):
        decode_cursor(cursor)


@pytest.mark.asyncio
async def test_history_keyset_is_stable_scoped_and_gap_free(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await register_and_login(client, "managed-history@example.com")
    foreign = await register_and_login(client, "managed-history-foreign@example.com")
    definition = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=_definition(),
    )
    definition_id = definition.json()["id"]
    invocation_ids = [uuid4() for _ in range(51)]
    for invocation_id in invocation_ids:
        created = await client.put(
            f"/v1/workflow-invocations/{invocation_id}",
            headers=_headers(owner),
            json=_invocation_body(definition_id),
        )
        assert created.status_code == 201

    other_definition = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json={**_definition(), "title": "Other managed run"},
    )
    other_invocation_id = uuid4()
    assert (
        await client.put(
            f"/v1/workflow-invocations/{other_invocation_id}",
            headers=_headers(owner),
            json=_invocation_body(other_definition.json()["id"]),
        )
    ).status_code == 201

    tied_at = datetime(2026, 7, 16, 12, tzinfo=UTC)
    await db_session.execute(
        update(WorkflowInvocation)
        .where(WorkflowInvocation.id.in_(invocation_ids))
        .values(created_at=tied_at)
    )
    await db_session.commit()

    first = await client.get(
        "/v1/workflow-invocations",
        params={"workflowDefinitionId": definition_id},
        headers=_headers(owner),
    )
    replay = await client.get(
        "/v1/workflow-invocations",
        params={"workflowDefinitionId": definition_id},
        headers=_headers(owner),
    )
    assert first.status_code == 200
    assert first.content == replay.content
    assert len(first.json()["items"]) == 50
    cursor = first.json()["nextCursor"]
    assert isinstance(cursor, str)
    second = await client.get(
        "/v1/workflow-invocations",
        params={"workflowDefinitionId": definition_id, "cursor": cursor},
        headers=_headers(owner),
    )
    assert second.status_code == 200
    assert len(second.json()["items"]) == 1
    assert second.json()["nextCursor"] is None
    observed = [UUID(item["id"]) for item in [*first.json()["items"], *second.json()["items"]]]
    assert observed == sorted(invocation_ids, reverse=True)
    assert len(set(observed)) == 51
    assert other_invocation_id not in observed

    foreign_page = await client.get(
        "/v1/workflow-invocations",
        params={"workflowDefinitionId": definition_id},
        headers=_headers(foreign),
    )
    assert foreign_page.status_code == 200
    assert foreign_page.json() == {"items": [], "nextCursor": None}

    invalid = await client.get(
        "/v1/workflow-invocations",
        params={"workflowDefinitionId": definition_id, "cursor": "a"},
        headers=_headers(owner),
    )
    assert invalid.status_code == 400
    assert invalid.json()["detail"]["code"] == "invalid_workflow_history_cursor"
