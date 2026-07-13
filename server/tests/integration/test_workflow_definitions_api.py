"""HTTP and real-Postgres acceptance tests for personal workflow definitions."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.constants.cloud import GitProvider
from proliferate.db.models.cloud.repositories import RepoConfig
from proliferate.db.models.workflows import WorkflowDefinition
from proliferate.db.store.workflow_definitions import update_workflow_definition_if_revision
from proliferate.server.catalogs.service import read_agent_catalog
from tests.integration.cloud_api_helpers import register_and_login


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _workflow_payload() -> dict[str, object]:
    return {
        "title": "Diagnose ticket",
        "description": "Investigate one ticket and report the result.",
        "defaultRepoConfigId": None,
        "inputs": [
            {
                "name": "ticket",
                "type": "string",
                "required": True,
            }
        ],
        "stages": [
            {
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelId": "sonnet",
                    "effort": "high",
                },
                "steps": [
                    {
                        "kind": "agent.prompt",
                        "prompt": "Investigate {{inputs.ticket}}.",
                        "goal": {
                            "objective": "Produce an evidence-backed diagnosis.",
                        },
                    }
                ],
            }
        ],
    }


async def _seed_repo(
    db: AsyncSession,
    *,
    user_id: str,
    git_repo_name: str,
    deleted: bool = False,
) -> RepoConfig:
    from proliferate.utils.time import utcnow

    now = utcnow()
    repo = RepoConfig(
        user_id=UUID(user_id),
        git_provider=GitProvider.github,
        git_owner="proliferate-ai",
        git_repo_name=git_repo_name,
        created_at=now,
        updated_at=now,
        deleted_at=now if deleted else None,
    )
    db.add(repo)
    await db.commit()
    return repo


@pytest.mark.asyncio
async def test_personal_workflow_crud_owner_isolation_and_revision_conflicts(
    client: AsyncClient,
) -> None:
    owner = await register_and_login(client, "workflow-owner@example.com")
    intruder = await register_and_login(client, "workflow-intruder@example.com")
    owner_headers = _headers(owner)
    intruder_headers = _headers(intruder)

    created_response = await client.post(
        "/v1/workflows",
        headers=owner_headers,
        json=_workflow_payload(),
    )
    assert created_response.status_code == 201
    created = created_response.json()
    workflow_id = created["id"]
    assert created == {
        **_workflow_payload(),
        "id": workflow_id,
        "userId": owner["user_id"],
        "schemaVersion": 1,
        "revision": 1,
        "validatedCatalogVersion": read_agent_catalog().catalog.catalogVersion,
        "createdAt": created["createdAt"],
        "updatedAt": created["updatedAt"],
        "deletedAt": None,
    }

    owner_list = await client.get("/v1/workflows", headers=owner_headers)
    assert owner_list.status_code == 200
    assert [item["id"] for item in owner_list.json()["workflows"]] == [workflow_id]

    intruder_list = await client.get("/v1/workflows", headers=intruder_headers)
    assert intruder_list.status_code == 200
    assert intruder_list.json() == {"workflows": []}

    loaded = await client.get(f"/v1/workflows/{workflow_id}", headers=owner_headers)
    assert loaded.status_code == 200
    assert loaded.json() == created

    hidden = await client.get(f"/v1/workflows/{workflow_id}", headers=intruder_headers)
    assert hidden.status_code == 404
    assert hidden.json()["detail"]["code"] == "workflow_definition_not_found"

    intruder_delete = await client.delete(
        f"/v1/workflows/{workflow_id}",
        params={"expectedRevision": 1},
        headers=intruder_headers,
    )
    assert intruder_delete.status_code == 404
    assert intruder_delete.json()["detail"]["code"] == "workflow_definition_not_found"

    update_body = _workflow_payload()
    update_body.update(
        {
            "title": "Diagnose ticket carefully",
            "description": "Updated description.",
            "expectedRevision": 1,
        }
    )
    updated_response = await client.put(
        f"/v1/workflows/{workflow_id}",
        headers=owner_headers,
        json=update_body,
    )
    assert updated_response.status_code == 200
    updated = updated_response.json()
    assert updated["title"] == "Diagnose ticket carefully"
    assert updated["description"] == "Updated description."
    assert updated["revision"] == 2

    stale_update = await client.put(
        f"/v1/workflows/{workflow_id}",
        headers=owner_headers,
        json=update_body,
    )
    assert stale_update.status_code == 409
    assert stale_update.json() == {
        "detail": {
            "code": "workflow_definition_revision_conflict",
            "message": "Workflow definition changed since it was loaded.",
            "expectedRevision": 1,
            "currentRevision": 2,
        }
    }

    stale_and_now_invalid = deepcopy(update_body)
    stale_and_now_invalid["stages"][0]["harnessConfig"] = {  # type: ignore[index]
        "agentKind": "no-longer-available"
    }
    stale_invalid_response = await client.put(
        f"/v1/workflows/{workflow_id}",
        headers=owner_headers,
        json=stale_and_now_invalid,
    )
    assert stale_invalid_response.status_code == 409
    assert stale_invalid_response.json()["detail"]["currentRevision"] == 2

    stale_delete = await client.delete(
        f"/v1/workflows/{workflow_id}",
        params={"expectedRevision": 1},
        headers=owner_headers,
    )
    assert stale_delete.status_code == 409
    assert stale_delete.json()["detail"] == {
        "code": "workflow_definition_revision_conflict",
        "message": "Workflow definition changed since it was loaded.",
        "expectedRevision": 1,
        "currentRevision": 2,
    }

    deleted = await client.delete(
        f"/v1/workflows/{workflow_id}",
        params={"expectedRevision": 2},
        headers=owner_headers,
    )
    assert deleted.status_code == 204
    assert deleted.content == b""

    missing = await client.get(f"/v1/workflows/{workflow_id}", headers=owner_headers)
    assert missing.status_code == 404
    after_delete = await client.get("/v1/workflows", headers=owner_headers)
    assert after_delete.json() == {"workflows": []}


@pytest.mark.asyncio
async def test_two_real_postgres_writers_have_exactly_one_revision_winner(
    client: AsyncClient,
    test_engine: AsyncEngine,
) -> None:
    owner = await register_and_login(client, "workflow-race-owner@example.com")
    created_response = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=_workflow_payload(),
    )
    assert created_response.status_code == 201
    created = created_response.json()
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def replace(title: str) -> bool:
        async with session_factory() as session:
            updated = await update_workflow_definition_if_revision(
                session,
                user_id=UUID(owner["user_id"]),
                workflow_definition_id=UUID(created["id"]),
                expected_revision=1,
                title=title,
                description=created["description"],
                validated_catalog_version=created["validatedCatalogVersion"],
                default_repo_config_id=None,
                inputs_json=created["inputs"],
                stages_json=created["stages"],
            )
            await session.commit()
            return updated is not None

    winners = await asyncio.gather(replace("Writer A"), replace("Writer B"))

    assert winners.count(True) == 1
    assert winners.count(False) == 1
    loaded = await client.get(
        f"/v1/workflows/{created['id']}",
        headers=_headers(owner),
    )
    assert loaded.status_code == 200
    assert loaded.json()["revision"] == 2
    assert loaded.json()["title"] in {"Writer A", "Writer B"}


@pytest.mark.asyncio
async def test_optional_nested_fields_remain_omitted_and_blank_description_normalizes(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await register_and_login(client, "workflow-minimal-owner@example.com")
    response = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json={
            "title": "Minimal workflow",
            "description": "   ",
            "defaultRepoConfigId": None,
            "inputs": [],
            "stages": [
                {
                    "harnessConfig": {
                        "agentKind": "claude",
                        "modelId": None,
                        "effort": None,
                    },
                    "steps": [
                        {
                            "kind": "agent.prompt",
                            "prompt": "Investigate the repository.",
                            "goal": None,
                        }
                    ],
                }
            ],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["description"] == ""
    assert payload["defaultRepoConfigId"] is None
    assert payload["deletedAt"] is None
    assert payload["stages"] == [
        {
            "harnessConfig": {"agentKind": "claude"},
            "steps": [
                {
                    "kind": "agent.prompt",
                    "prompt": "Investigate the repository.",
                }
            ],
        }
    ]
    persisted = await db_session.get(WorkflowDefinition, UUID(payload["id"]))
    assert persisted is not None
    assert persisted.stages_json == payload["stages"]
    assert "harnessConfig" in persisted.stages_json[0]
    assert "harness_config" not in persisted.stages_json[0]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("harness_config", "goal", "expected_path", "expected_code"),
    [
        (
            {"agentKind": "unknown-agent"},
            None,
            "stages.0.harnessConfig.agentKind",
            "workflow_catalog_selection_unavailable",
        ),
        (
            {"agentKind": "claude", "modelId": "missing-model"},
            None,
            "stages.0.harnessConfig.modelId",
            "workflow_catalog_selection_unavailable",
        ),
        (
            {"agentKind": "claude", "modelId": "sonnet", "effort": "xhigh"},
            None,
            "stages.0.harnessConfig.effort",
            "workflow_catalog_selection_unavailable",
        ),
        (
            {"agentKind": "codex", "modelId": "gpt-5.5", "effort": "ultra"},
            None,
            "stages.0.harnessConfig.effort",
            "workflow_catalog_selection_unavailable",
        ),
        (
            {"agentKind": "claude", "effort": "high"},
            None,
            "stages.0.harnessConfig.effort",
            "invalid_workflow_definition",
        ),
        (
            {"agentKind": "cursor", "modelId": "composer-2.5"},
            {"objective": "Finish the goal."},
            "stages.0.steps.0.goal",
            "workflow_catalog_selection_unavailable",
        ),
    ],
)
async def test_catalog_validation_rejects_invalid_harness_model_effort_and_goal(
    client: AsyncClient,
    harness_config: dict[str, object],
    goal: dict[str, object] | None,
    expected_path: str,
    expected_code: str,
) -> None:
    user = await register_and_login(
        client,
        (
            "workflow-catalog-"
            f"{abs(hash(expected_path + str(harness_config))) % 1_000_000}@example.com"
        ),
    )
    body = _workflow_payload()
    stages = body["stages"]
    assert isinstance(stages, list)
    stage = stages[0]
    assert isinstance(stage, dict)
    stage["harnessConfig"] = harness_config
    steps = stage["steps"]
    assert isinstance(steps, list)
    step = steps[0]
    assert isinstance(step, dict)
    step["goal"] = goal

    response = await client.post(
        "/v1/workflows",
        headers=_headers(user),
        json=body,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == expected_code
    assert detail["path"] == expected_path


@pytest.mark.asyncio
async def test_default_repository_must_be_active_and_owned_by_current_user(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await register_and_login(client, "workflow-repo-owner@example.com")
    other = await register_and_login(client, "workflow-repo-other@example.com")
    owner_repo = await _seed_repo(
        db_session,
        user_id=owner["user_id"],
        git_repo_name="owner-repo",
    )
    other_repo = await _seed_repo(
        db_session,
        user_id=other["user_id"],
        git_repo_name="other-repo",
    )
    deleted_owner_repo = await _seed_repo(
        db_session,
        user_id=owner["user_id"],
        git_repo_name="deleted-repo",
        deleted=True,
    )

    valid_body = _workflow_payload()
    valid_body["defaultRepoConfigId"] = str(owner_repo.id)
    valid = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=valid_body,
    )
    assert valid.status_code == 201
    assert valid.json()["defaultRepoConfigId"] == str(owner_repo.id)

    for unavailable_repo_id in (other_repo.id, deleted_owner_repo.id):
        invalid_body = _workflow_payload()
        invalid_body["defaultRepoConfigId"] = str(unavailable_repo_id)
        invalid = await client.post(
            "/v1/workflows",
            headers=_headers(owner),
            json=invalid_body,
        )
        assert invalid.status_code == 400
        assert invalid.json()["detail"] == {
            "code": "invalid_workflow_definition",
            "message": "Default repository was not found.",
            "path": "defaultRepoConfigId",
        }

    cross_owner_body = _workflow_payload()
    cross_owner_body["defaultRepoConfigId"] = str(owner_repo.id)
    cross_owner = await client.post(
        "/v1/workflows",
        headers=_headers(other),
        json=cross_owner_body,
    )
    assert cross_owner.status_code == 400
    assert cross_owner.json()["detail"]["path"] == "defaultRepoConfigId"


@pytest.mark.asyncio
async def test_unknown_fields_are_rejected_at_every_definition_layer(
    client: AsyncClient,
) -> None:
    user = await register_and_login(client, "workflow-extra-fields@example.com")
    bodies: list[tuple[dict[str, object], tuple[object, ...]]] = []

    top_level = _workflow_payload()
    top_level["unexpected"] = True
    bodies.append((top_level, ("body", "unexpected")))

    input_level = deepcopy(_workflow_payload())
    input_level["inputs"][0]["unexpected"] = True  # type: ignore[index]
    bodies.append((input_level, ("body", "inputs", 0, "unexpected")))

    harness_level = deepcopy(_workflow_payload())
    harness_level["stages"][0]["harnessConfig"]["unexpected"] = True  # type: ignore[index]
    bodies.append((harness_level, ("body", "stages", 0, "harnessConfig", "unexpected")))

    step_level = deepcopy(_workflow_payload())
    step_level["stages"][0]["steps"][0]["unexpected"] = True  # type: ignore[index]
    bodies.append((step_level, ("body", "stages", 0, "steps", 0, "unexpected")))

    goal_level = deepcopy(_workflow_payload())
    goal_level["stages"][0]["steps"][0]["goal"]["unexpected"] = True  # type: ignore[index]
    bodies.append((goal_level, ("body", "stages", 0, "steps", 0, "goal", "unexpected")))

    snake_case_top_level = deepcopy(_workflow_payload())
    snake_case_top_level["default_repo_config_id"] = snake_case_top_level.pop(
        "defaultRepoConfigId"
    )
    bodies.append((snake_case_top_level, ("body", "default_repo_config_id")))

    snake_case_nested = deepcopy(_workflow_payload())
    nested_stage = snake_case_nested["stages"][0]  # type: ignore[index]
    nested_stage["harness_config"] = nested_stage.pop("harnessConfig")  # type: ignore[union-attr]
    bodies.append((snake_case_nested, ("body", "stages", 0, "harness_config")))

    for body, expected_location in bodies:
        response = await client.post(
            "/v1/workflows",
            headers=_headers(user),
            json=body,
        )
        assert response.status_code == 422
        assert any(
            tuple(error["loc"]) == expected_location and error["type"] == "extra_forbidden"
            for error in response.json()["detail"]
        )

    listed = await client.get("/v1/workflows", headers=_headers(user))
    assert listed.json() == {"workflows": []}
