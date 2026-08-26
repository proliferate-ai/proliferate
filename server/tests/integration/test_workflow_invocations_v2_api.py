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
from sqlalchemy import select

from proliferate.db.models.repositories import RepoConfig
from proliferate.db.models.workflows import WorkflowDefinition, WorkflowInvocation
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

    # Verbatim at the storage layer too: the frozen invocation_json embeds the
    # exact definition_json bytes of the definition row, not a re-derivation.
    definition_row = (
        await db_session.execute(
            select(WorkflowDefinition).where(WorkflowDefinition.id == UUID(str(definition["id"])))
        )
    ).scalar_one()
    invocation_row = (
        await db_session.execute(
            select(WorkflowInvocation).where(WorkflowInvocation.id == UUID(invocation_id))
        )
    ).scalar_one()
    assert invocation_row.invocation_json["definition"] == definition_row.definition_json

    # A gen-1-shaped PUT is no longer a recognized wire shape at all: with the
    # v1 lane deleted the strict v2 request model rejects it at validation.
    v1_shaped_replay = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
        json={
            "schemaVersion": 1,
            "workflowDefinitionId": str(definition["id"]),
            "expectedRevision": 1,
            "arguments": {},
            "target": {"kind": "managedCloud"},
        },
    )
    assert v1_shaped_replay.status_code == 422

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

    # GET returns the frozen record directly.
    fetched = await client.get(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
    )
    assert fetched.status_code == 200
    assert fetched.json() == frozen

    # The gen-1 managed-delivery routes no longer exist.
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
    # Placement is shape-only (Ruling A): the CP freezes repoConfigId verbatim
    # and never resolves it — for local v1 it carries a runtime repo-root id,
    # which is not a CP repo-config id at all. A foreign CP repo id and a
    # non-UUID runtime id are both accepted; resolution is the engine's job.
    assert await put(_invocation_body(definition_id, str(foreign_repo.id))) == 201
    runtime_placed = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json=_invocation_body(definition_id, "rr_local_9f2c", mode="repo_root"),
    )
    assert runtime_placed.status_code == 201
    assert runtime_placed.json()["placement"] == {
        "repoConfigId": "rr_local_9f2c",
        "mode": "repo_root",
    }
    # Shape still holds: empty ids and unknown modes are rejected.
    assert await put(_invocation_body(definition_id, "")) == 422
    assert await put(_invocation_body(definition_id, str(repo.id), mode="floating")) == 422

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


@pytest.mark.asyncio
async def test_v2_invocation_freeze_drops_a_stored_empty_control_values_map(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Definitions saved before empty maps were omitted carry
    `controlValues: {}` in their stored rows. The freeze normalization strips
    it, so those saved workflows still produce a snapshot every runtime's
    strict definition parser accepts."""

    owner = await register_and_login(client, "wf2-inv-legacy@example.com")
    repo = await _seed_repo(db_session, user_id=owner["user_id"], name="legacy-repo")
    definition = await _create_v2_definition(client, owner)
    definition_id = str(definition["id"])

    row = (
        await db_session.execute(
            select(WorkflowDefinition).where(WorkflowDefinition.id == UUID(definition_id))
        )
    ).scalar_one()
    legacy = deepcopy(row.definition_json)
    legacy["nodes"][1]["model"] = {"agentKind": "codex", "controlValues": {}}
    row.definition_json = legacy
    await db_session.commit()

    created = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json=_invocation_body(definition_id, str(repo.id)),
    )
    assert created.status_code == 201
    assert created.json()["definition"]["nodes"][1]["model"] == {"agentKind": "codex"}


@pytest.mark.asyncio
async def test_v2_referenced_optional_input_needs_an_argument(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Ruling H: every prompt-referenced input needs an argument, optional or
    not — the client satisfies this by sending "" for blank optionals."""

    owner = await register_and_login(client, "wf2-inv-optional@example.com")
    repo = await _seed_repo(db_session, user_id=owner["user_id"], name="optional-repo")
    fixture = _fixture("v2-full.json")
    definition_doc = deepcopy(fixture["definition"])
    assert isinstance(definition_doc, dict)
    nodes = definition_doc["nodes"]
    assert isinstance(nodes, list) and isinstance(nodes[0], dict)
    nodes[0]["prompt"] = "Research @input:topic at @input:depth depth into @doc:research-findings"
    created = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json={
            "title": "Optional referenced",
            "description": "",
            "defaultRepoConfigId": None,
            "definition": definition_doc,
        },
    )
    assert created.status_code == 201
    definition_id = str(created.json()["id"])

    async def put(arguments: dict[str, object]) -> int:
        response = await client.put(
            f"/v1/workflow-invocations/{uuid4()}",
            headers=_headers(owner),
            json=_invocation_body(definition_id, str(repo.id), arguments=arguments),
        )
        return response.status_code

    # depth is optional but referenced: omitting it refuses the trigger.
    assert await put({"topic": "engines"}) == 400
    # The blank-optional convention: an empty string satisfies the rule.
    assert await put({"topic": "engines", "depth": ""}) == 201
