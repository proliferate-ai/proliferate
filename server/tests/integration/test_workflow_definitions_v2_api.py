"""HTTP and real-Postgres acceptance tests for gen-2 workflow definitions."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import GitProvider
from proliferate.db.models.cloud.repositories import RepoConfig
from proliferate.db.models.workflows import WorkflowDefinition
from proliferate.lib.infra.time.wall_clock import utcnow
from tests.integration.cloud_api_helpers import register_and_login

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "contracts" / "workflow-definition"


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _fixture_definition(name: str) -> dict[str, object]:
    fixture = json.loads((FIXTURE_ROOT / name).read_text())
    definition = fixture["definition"]
    assert isinstance(definition, dict)
    return deepcopy(definition)


def _v2_payload() -> dict[str, object]:
    return {
        "title": "Research and propose",
        "description": "Research a topic, then gate on review.",
        "defaultRepoConfigId": None,
        "definition": _fixture_definition("v2-full.json"),
    }


def _v1_payload() -> dict[str, object]:
    return {
        "title": "Legacy stage workflow",
        "description": "",
        "defaultRepoConfigId": None,
        "inputs": [{"name": "ticket", "type": "string", "required": True}],
        "stages": [
            {
                "harnessConfig": {"agentKind": "claude", "modelId": None, "effort": None},
                "steps": [
                    {
                        "kind": "agent.prompt",
                        "prompt": "Investigate {{inputs.ticket}}",
                        "goal": None,
                    }
                ],
            }
        ],
    }


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


@pytest.mark.asyncio
async def test_v2_definition_crud_lifecycle(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await register_and_login(client, "wf-v2-owner@example.com")

    created = await client.post("/v1/workflows", headers=_headers(owner), json=_v2_payload())
    assert created.status_code == 201
    payload = created.json()
    assert payload["schemaVersion"] == 2
    assert payload["revision"] == 1
    assert payload["definition"] == _fixture_definition("v2-full.json")
    assert "stages" not in payload
    assert "validatedCatalogVersion" not in payload

    row = await db_session.get(WorkflowDefinition, UUID(payload["id"]))
    assert row is not None
    assert row.schema_version == 2
    assert row.definition_json == _fixture_definition("v2-full.json")
    assert row.inputs_json == []
    assert row.stages_json == []

    fetched = await client.get(f"/v1/workflows/{payload['id']}", headers=_headers(owner))
    assert fetched.status_code == 200
    assert fetched.json() == payload

    updated_definition = _fixture_definition("v2-minimal.json")
    updated = await client.put(
        f"/v1/workflows/{payload['id']}",
        headers=_headers(owner),
        json={
            "title": "One step now",
            "description": "",
            "defaultRepoConfigId": None,
            "definition": updated_definition,
            "expectedRevision": 1,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2
    assert updated.json()["definition"] == updated_definition

    stale = await client.put(
        f"/v1/workflows/{payload['id']}",
        headers=_headers(owner),
        json={
            "title": "One step now",
            "description": "",
            "defaultRepoConfigId": None,
            "definition": updated_definition,
            "expectedRevision": 1,
        },
    )
    assert stale.status_code == 409

    deleted = await client.delete(
        f"/v1/workflows/{payload['id']}?expectedRevision=2",
        headers=_headers(owner),
    )
    assert deleted.status_code == 204
    gone = await client.get(f"/v1/workflows/{payload['id']}", headers=_headers(owner))
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_gen1_shaped_create_is_rejected_and_list_is_v2_only(client: AsyncClient) -> None:
    owner = await register_and_login(client, "wf-v2-mixed@example.com")

    # The gen-1 wire shape is no longer a recognized request at all.
    v1 = await client.post("/v1/workflows", headers=_headers(owner), json=_v1_payload())
    assert v1.status_code == 422
    v2 = await client.post("/v1/workflows", headers=_headers(owner), json=_v2_payload())
    assert v2.status_code == 201

    listed = await client.get("/v1/workflows", headers=_headers(owner))
    assert listed.status_code == 200
    items = listed.json()["workflows"]
    assert [item["schemaVersion"] for item in items] == [2]
    assert "definition" in items[0]
    assert "stages" not in items[0]


@pytest.mark.asyncio
async def test_v2_document_rejections_surface_paths(client: AsyncClient) -> None:
    owner = await register_and_login(client, "wf-v2-rejects@example.com")

    branching = _v2_payload()
    definition = branching["definition"]
    assert isinstance(definition, dict)
    definition["edges"] = [
        {"from": "n_research", "to": "n_synthesize"},
        {"from": "n_research", "to": "n_review"},
    ]
    rejected = await client.post("/v1/workflows", headers=_headers(owner), json=branching)
    assert rejected.status_code == 400
    detail = rejected.json()["detail"]
    assert detail["code"] == "invalid_workflow_definition"
    assert detail["path"] == "definition.edges.1.from"

    with_placement = _v2_payload()
    definition = with_placement["definition"]
    assert isinstance(definition, dict)
    definition["placement"] = {"repoConfigId": "x", "mode": "worktree"}
    rejected = await client.post("/v1/workflows", headers=_headers(owner), json=with_placement)
    assert rejected.status_code == 422



@pytest.mark.asyncio
async def test_v2_default_repository_is_an_opaque_runtime_space_id(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """defaultRepoConfigId lives in the runtime repo-root id space (Ruling A):
    the CP checks shape only (UUID-or-null) and never resolves it."""

    owner = await register_and_login(client, "wf-v2-repo-owner@example.com")

    payload = _v2_payload()
    runtime_space_id = "7f3a9c1e-2b4d-4e6f-8a90-123456789abc"
    payload["defaultRepoConfigId"] = runtime_space_id
    accepted = await client.post("/v1/workflows", headers=_headers(owner), json=payload)
    assert accepted.status_code == 201
    assert accepted.json()["defaultRepoConfigId"] == runtime_space_id

    other = await register_and_login(client, "wf-v2-repo-other@example.com")
    foreign_repo = await _seed_repo(db_session, user_id=other["user_id"], name="not-yours")
    payload["defaultRepoConfigId"] = str(foreign_repo.id)
    cp_id_shaped = await client.post("/v1/workflows", headers=_headers(owner), json=payload)
    assert cp_id_shaped.status_code == 201

    payload["defaultRepoConfigId"] = "rr_local_9f2c"
    malformed = await client.post("/v1/workflows", headers=_headers(owner), json=payload)
    assert malformed.status_code == 422

    payload["defaultRepoConfigId"] = None
    nullable = await client.post("/v1/workflows", headers=_headers(owner), json=payload)
    assert nullable.status_code == 201
    assert nullable.json()["defaultRepoConfigId"] is None


@pytest.mark.asyncio
async def test_v1_shaped_body_cannot_update_a_v2_definition(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """A gen-1-shaped update body rejects at the wire (the v1 lane is gone)
    and the stored v2 row is untouched — no destructive partial write."""

    owner = await register_and_login(client, "wf-v2-downgrade-guard@example.com")
    created = await client.post("/v1/workflows", headers=_headers(owner), json=_v2_payload())
    assert created.status_code == 201
    definition_id = str(created.json()["id"])

    downgraded = await client.put(
        f"/v1/workflows/{definition_id}",
        headers=_headers(owner),
        json={**_v1_payload(), "expectedRevision": 1},
    )
    assert downgraded.status_code == 422

    # The row is untouched: still v2, document intact, revision unchanged.
    row = (
        await db_session.execute(
            select(WorkflowDefinition).where(WorkflowDefinition.id == UUID(definition_id))
        )
    ).scalar_one()
    assert row.schema_version == 2
    assert row.definition_json == _fixture_definition("v2-full.json")
    assert row.revision == 1

    fetched = await client.get(f"/v1/workflows/{definition_id}", headers=_headers(owner))
    assert fetched.status_code == 200
    assert fetched.json() == created.json()
