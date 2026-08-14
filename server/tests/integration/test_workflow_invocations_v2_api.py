"""Gen-2 workflow invocation freeze API over real PostgreSQL.

Includes the producer half of
``fixtures/contracts/workflow-definition/run-snapshot-v2.json``: the frozen
``invocation_json`` the server returns must match the fixture byte-for-byte
outside the instance-specific identity fields, because that payload is exactly
what the client courier hands the runtime's ``PUT /v1/workflow-runs``.
"""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import GitProvider
from proliferate.db.models.cloud.repositories import RepoConfig
from proliferate.db.store import workflow_managed_execution as managed_execution_store
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.workflows.domain.invocation import canonical_json
from tests.integration.cloud_api_helpers import register_and_login

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "contracts" / "workflow-definition"


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURE_ROOT / name).read_text())


async def _seed_repo(db: AsyncSession, *, user_id: str, name: str) -> RepoConfig:
    now = utcnow()
    repo = RepoConfig(
        user_id=UUID(user_id),
        git_provider=GitProvider.github,
        git_owner="proliferate-ai",
        git_repo_name=name,
        created_at=now,
        updated_at=now,
        deleted_at=None,
    )
    db.add(repo)
    await db.commit()
    return repo


async def _create_v2_definition(
    client: AsyncClient,
    tokens: dict[str, str],
    *,
    title: str = "Research and propose",
    description: str = "Research a topic, synthesize a proposal, gate on human review.",
) -> dict[str, object]:
    fixture = _fixture("v2-full.json")
    created = await client.post(
        "/v1/workflows",
        headers=_headers(tokens),
        json={
            "title": title,
            "description": description,
            "defaultRepoConfigId": None,
            "definition": deepcopy(fixture["definition"]),
        },
    )
    assert created.status_code == 201
    payload = created.json()
    assert isinstance(payload, dict)
    return payload


def _invocation_body(
    definition_id: str,
    repo_config_id: str,
    *,
    mode: str = "worktree",
    arguments: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "schemaVersion": 2,
        "workflowDefinitionId": definition_id,
        "arguments": {"topic": "workflow engines", "depth": "deep"}
        if arguments is None
        else arguments,
        "placement": {"repoConfigId": repo_config_id, "mode": mode},
    }


@pytest.mark.asyncio
async def test_v2_invocation_freezes_the_run_snapshot_contract_shape(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await register_and_login(client, "wf2-inv-owner@example.com")
    repo = await _seed_repo(db_session, user_id=owner["user_id"], name="snapshot-repo")
    definition = await _create_v2_definition(client, owner)

    invocation_id = str(uuid4())
    body = _invocation_body(str(definition["id"]), str(repo.id))
    created = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
        json=body,
    )
    assert created.status_code == 201
    frozen = created.json()

    expected = _fixture("run-snapshot-v2.json")
    expected["id"] = invocation_id
    expected["workflowDefinitionId"] = definition["id"]
    expected["createdAt"] = frozen["createdAt"]
    placement = expected["placement"]
    assert isinstance(placement, dict)
    placement["repoConfigId"] = str(repo.id)
    assert canonical_json(frozen) == canonical_json(expected)

    # The frozen record contains the definition verbatim.
    assert frozen["definition"] == definition["definition"]

    # Idempotent replay returns the identical frozen record.
    replay = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
        json=body,
    )
    assert replay.status_code == 200
    assert replay.json() == frozen

    # Same id with different input conflicts.
    conflicting = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
        json=_invocation_body(
            str(definition["id"]),
            str(repo.id),
            arguments={"topic": "something else"},
        ),
    )
    assert conflicting.status_code == 409

    # GET returns the frozen record directly (no managed-execution read).
    fetched = await client.get(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
    )
    assert fetched.status_code == 200
    assert fetched.json() == frozen

    # Gen-2 invocations never enter the managed-execution lane.
    managed = await managed_execution_store.get_managed_execution(
        db_session,
        invocation_id=UUID(invocation_id),
    )
    assert managed is None
    deliver = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/deliver",
        headers=_headers(owner),
    )
    assert deliver.status_code == 404
    cancel = await client.post(
        f"/v1/workflow-invocations/{invocation_id}/cancel",
        headers=_headers(owner),
    )
    assert cancel.status_code == 404


@pytest.mark.asyncio
async def test_v2_invocation_argument_and_placement_rejections(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await register_and_login(client, "wf2-inv-args@example.com")
    other = await register_and_login(client, "wf2-inv-args-other@example.com")
    repo = await _seed_repo(db_session, user_id=owner["user_id"], name="args-repo")
    foreign_repo = await _seed_repo(db_session, user_id=other["user_id"], name="foreign-repo")
    definition = await _create_v2_definition(client, owner)
    definition_id = str(definition["id"])

    async def put(body: dict[str, object]) -> int:
        response = await client.put(
            f"/v1/workflow-invocations/{uuid4()}",
            headers=_headers(owner),
            json=body,
        )
        return response.status_code

    # Undeclared argument name.
    assert (
        await put(
            _invocation_body(
                definition_id,
                str(repo.id),
                arguments={"topic": "x", "depth": "y", "ghost": "z"},
            )
        )
        == 400
    )
    # Missing required input.
    assert (
        await put(_invocation_body(definition_id, str(repo.id), arguments={"depth": "y"})) == 400
    )
    # Referenced optional input still needs an argument (prompts reference @input:depth... none do;
    # @input:topic is referenced and required). Optional-but-unreferenced may be omitted:
    assert (
        await put(_invocation_body(definition_id, str(repo.id), arguments={"topic": "x"})) == 201
    )
    # Placement repo must belong to the caller.
    assert await put(_invocation_body(definition_id, str(foreign_repo.id))) == 400
    # Placement mode is a closed enum.
    assert await put(_invocation_body(definition_id, str(repo.id), mode="floating")) == 422

    # A v2 invocation of a v1 definition is invalid.
    v1_created = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json={
            "title": "Legacy",
            "description": "",
            "defaultRepoConfigId": None,
            "inputs": [],
            "stages": [
                {
                    "harnessConfig": {"agentKind": "claude", "modelId": None, "effort": None},
                    "steps": [{"kind": "agent.prompt", "prompt": "Do it.", "goal": None}],
                }
            ],
        },
    )
    assert v1_created.status_code == 201
    assert await put(_invocation_body(str(v1_created.json()["id"]), str(repo.id))) == 400

    # Owner isolation: someone else's definition answers not-found.
    intruder_response = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(other),
        json=_invocation_body(definition_id, str(foreign_repo.id)),
    )
    assert intruder_response.status_code == 404


@pytest.mark.asyncio
async def test_v2_invocation_freezes_the_definition_at_trigger_time(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await register_and_login(client, "wf2-inv-freeze@example.com")
    repo = await _seed_repo(db_session, user_id=owner["user_id"], name="freeze-repo")
    definition = await _create_v2_definition(client, owner)
    definition_id = str(definition["id"])

    invocation_id = str(uuid4())
    first = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
        json=_invocation_body(definition_id, str(repo.id)),
    )
    assert first.status_code == 201
    assert first.json()["definitionRevision"] == 1

    minimal = _fixture("v2-minimal.json")
    updated = await client.put(
        f"/v1/workflows/{definition_id}",
        headers=_headers(owner),
        json={
            "title": "Rewritten",
            "description": "",
            "defaultRepoConfigId": None,
            "definition": deepcopy(minimal["definition"]),
            "expectedRevision": 1,
        },
    )
    assert updated.status_code == 200

    # The already-frozen invocation is untouched by the definition edit.
    fetched = await client.get(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
    )
    assert fetched.status_code == 200
    assert fetched.json()["definition"] == definition["definition"]
    assert fetched.json()["title"] == "Research and propose"

    # A new trigger freezes the post-edit definition at its new revision.
    second = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json=_invocation_body(definition_id, str(repo.id), arguments={}),
    )
    assert second.status_code == 201
    assert second.json()["definitionRevision"] == 2
    assert second.json()["definition"] == minimal["definition"]
