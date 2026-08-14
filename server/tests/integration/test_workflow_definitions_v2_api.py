"""HTTP and real-Postgres acceptance tests for gen-2 workflow definitions."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from uuid import UUID

import pytest
from httpx import AsyncClient
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
async def test_v1_and_v2_definitions_list_side_by_side(client: AsyncClient) -> None:
    owner = await register_and_login(client, "wf-v2-mixed@example.com")

    v1 = await client.post("/v1/workflows", headers=_headers(owner), json=_v1_payload())
    assert v1.status_code == 201
    v2 = await client.post("/v1/workflows", headers=_headers(owner), json=_v2_payload())
    assert v2.status_code == 201

    listed = await client.get("/v1/workflows", headers=_headers(owner))
    assert listed.status_code == 200
    by_version = {item["schemaVersion"]: item for item in listed.json()["workflows"]}
    assert set(by_version) == {1, 2}
    assert "stages" in by_version[1]
    assert "definition" in by_version[2]

    eligibility = await client.get(
        f"/v1/workflows/{v2.json()['id']}/run-eligibility",
        headers=_headers(owner),
    )
    assert eligibility.status_code == 200
    assert eligibility.json() == {"eligible": True, "blockers": []}


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

    cross_version = await client.post("/v1/workflows", headers=_headers(owner), json=_v1_payload())
    assert cross_version.status_code == 201
    upgraded = await client.put(
        f"/v1/workflows/{cross_version.json()['id']}",
        headers=_headers(owner),
        json={**_v2_payload(), "expectedRevision": 1},
    )
    assert upgraded.status_code == 400
    assert upgraded.json()["detail"]["path"] == "definition.schemaVersion"


@pytest.mark.asyncio
async def test_v2_default_repository_must_be_owned(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await register_and_login(client, "wf-v2-repo-owner@example.com")
    other = await register_and_login(client, "wf-v2-repo-other@example.com")
    foreign_repo = await _seed_repo(db_session, user_id=other["user_id"], name="not-yours")

    payload = _v2_payload()
    payload["defaultRepoConfigId"] = str(foreign_repo.id)
    rejected = await client.post("/v1/workflows", headers=_headers(owner), json=payload)
    assert rejected.status_code == 400
    assert rejected.json()["detail"]["path"] == "defaultRepoConfigId"

    own_repo = await _seed_repo(db_session, user_id=owner["user_id"], name="yours")
    payload["defaultRepoConfigId"] = str(own_repo.id)
    accepted = await client.post("/v1/workflows", headers=_headers(owner), json=payload)
    assert accepted.status_code == 201
    assert accepted.json()["defaultRepoConfigId"] == str(own_repo.id)
