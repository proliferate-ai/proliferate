"""Immutable workflow invocation API over real PostgreSQL."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import GitProvider
from proliferate.db.models.cloud.repositories import RepoConfig
from proliferate.db.models.workflows import WorkflowDefinition
from proliferate.utils.time import utcnow
from tests.integration.cloud_api_helpers import register_and_login


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _definition_payload(*, number: bool = False) -> dict[str, object]:
    input_type = "number" if number else "string"
    return {
        "title": "Portable workflow",
        "description": "",
        "defaultRepoConfigId": None,
        "inputs": [{"name": "ticket", "type": input_type, "required": True}],
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


def _invocation_body(definition_id: str, argument: object) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "workflowDefinitionId": definition_id,
        "expectedRevision": 1,
        "arguments": {"ticket": argument},
        "target": {"kind": "managedCloud"},
    }


async def _seed_repo(
    db: AsyncSession,
    *,
    user_id: str,
    name: str,
    deleted: bool = False,
) -> RepoConfig:
    now = utcnow()
    repo = RepoConfig(
        user_id=UUID(user_id),
        git_provider=GitProvider.github,
        git_owner="proliferate-ai",
        git_repo_name=name,
        created_at=now,
        updated_at=now,
        deleted_at=now if deleted else None,
    )
    db.add(repo)
    await db.commit()
    return repo


@pytest.mark.asyncio
async def test_invocation_snapshot_replay_conflict_get_and_owner_isolation(
    client: AsyncClient,
) -> None:
    owner = await register_and_login(client, "invocation-owner@example.com")
    intruder = await register_and_login(client, "invocation-intruder@example.com")
    created_definition = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=_definition_payload(),
    )
    assert created_definition.status_code == 201
    definition = created_definition.json()

    eligibility = await client.get(
        f"/v1/workflows/{definition['id']}/run-eligibility",
        headers=_headers(owner),
    )
    assert eligibility.status_code == 200
    assert eligibility.json() == {"eligible": True, "blockers": []}

    invocation_id = str(uuid4())
    request = _invocation_body(definition["id"], "PROL-123")
    created = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
        json=request,
    )
    assert created.status_code == 201
    frozen = created.json()
    assert frozen["id"] == invocation_id
    assert frozen["definitionRevision"] == 1
    assert frozen["placement"] == {"kind": "scratch"}
    harness = frozen["definition"]["stages"][0]["harnessConfig"]
    assert harness == {
        "agentKind": "claude",
        "modelSelection": {"kind": "targetDefault"},
        "permissionPolicy": "workflowDefault",
    }

    update = deepcopy(_definition_payload())
    update.update(
        {
            "title": "Changed after invocation",
            "description": "new",
            "expectedRevision": 1,
        }
    )
    update["stages"][0]["steps"][0]["prompt"] = "A different prompt"  # type: ignore[index]
    updated = await client.put(
        f"/v1/workflows/{definition['id']}",
        headers=_headers(owner),
        json=update,
    )
    assert updated.status_code == 200

    replay = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
        json=request,
    )
    assert replay.status_code == 200
    assert replay.json() == frozen
    loaded = await client.get(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
    )
    assert loaded.status_code == 200
    assert loaded.json() == frozen

    mismatch = deepcopy(request)
    mismatch["arguments"] = {"ticket": "OTHER"}
    conflict = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(owner),
        json=mismatch,
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "workflow_invocation_conflict"

    hidden_get = await client.get(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(intruder),
    )
    assert hidden_get.status_code == 404
    hidden_put = await client.put(
        f"/v1/workflow-invocations/{invocation_id}",
        headers=_headers(intruder),
        json=request,
    )
    assert hidden_put.status_code == 404


@pytest.mark.asyncio
async def test_real_postgres_advisory_lock_races(
    client: AsyncClient,
) -> None:
    owner = await register_and_login(client, "invocation-race-owner@example.com")
    other = await register_and_login(client, "invocation-race-other@example.com")
    definition_response = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=_definition_payload(),
    )
    assert definition_response.status_code == 201
    definition_id = definition_response.json()["id"]
    body = _invocation_body(definition_id, "SAME")
    other_definition_response = await client.post(
        "/v1/workflows",
        headers=_headers(other),
        json=_definition_payload(),
    )
    assert other_definition_response.status_code == 201
    other_body = _invocation_body(other_definition_response.json()["id"], "SAME")

    identical_id = str(uuid4())
    identical = await asyncio.gather(
        client.put(
            f"/v1/workflow-invocations/{identical_id}",
            headers=_headers(owner),
            json=body,
        ),
        client.put(
            f"/v1/workflow-invocations/{identical_id}",
            headers=_headers(owner),
            json=body,
        ),
    )
    assert sorted(response.status_code for response in identical) == [200, 201]
    assert identical[0].json() == identical[1].json()

    mismatch_id = str(uuid4())
    different = deepcopy(body)
    different["arguments"] = {"ticket": "DIFFERENT"}
    mismatch = await asyncio.gather(
        client.put(
            f"/v1/workflow-invocations/{mismatch_id}",
            headers=_headers(owner),
            json=body,
        ),
        client.put(
            f"/v1/workflow-invocations/{mismatch_id}",
            headers=_headers(owner),
            json=different,
        ),
    )
    assert sorted(response.status_code for response in mismatch) == [201, 409]

    foreign_id = str(uuid4())
    foreign = await asyncio.gather(
        client.put(
            f"/v1/workflow-invocations/{foreign_id}",
            headers=_headers(owner),
            json=body,
        ),
        client.put(
            f"/v1/workflow-invocations/{foreign_id}",
            headers=_headers(other),
            json=other_body,
        ),
    )
    assert sorted(response.status_code for response in foreign) == [201, 404]
    loser = next(response for response in foreign if response.status_code == 404)
    assert loser.json()["detail"]["code"] == "workflow_invocation_not_found"
    winner_index = next(
        index for index, response in enumerate(foreign) if response.status_code == 201
    )
    winner = owner if winner_index == 0 else other
    losing_user = other if winner_index == 0 else owner
    assert (
        await client.get(
            f"/v1/workflow-invocations/{foreign_id}",
            headers=_headers(winner),
        )
    ).status_code == 200
    assert (
        await client.get(
            f"/v1/workflow-invocations/{foreign_id}",
            headers=_headers(losing_user),
        )
    ).status_code == 404


@pytest.mark.asyncio
async def test_repository_worktree_snapshot_and_unavailable_repository_outcomes(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner = await register_and_login(client, "invocation-repo-owner@example.com")
    other = await register_and_login(client, "invocation-repo-other@example.com")
    owner_repo = await _seed_repo(
        db_session,
        user_id=owner["user_id"],
        name="invocation-owner-repo",
    )
    other_repo = await _seed_repo(
        db_session,
        user_id=other["user_id"],
        name="invocation-other-repo",
    )

    missing_repo_body = _definition_payload()
    missing_repo_body["defaultRepoConfigId"] = str(uuid4())
    missing_repo = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=missing_repo_body,
    )
    assert missing_repo.status_code == 400
    assert missing_repo.json()["detail"] == {
        "code": "invalid_workflow_definition",
        "message": "Default repository was not found.",
        "path": "defaultRepoConfigId",
    }

    body = _definition_payload()
    body["defaultRepoConfigId"] = str(owner_repo.id)
    created = await client.post("/v1/workflows", headers=_headers(owner), json=body)
    assert created.status_code == 201
    definition_id = created.json()["id"]
    invocation = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json=_invocation_body(definition_id, "PROL-123"),
    )
    assert invocation.status_code == 201
    assert invocation.json()["placement"] == {
        "kind": "repositoryWorktree",
        "repoConfigId": str(owner_repo.id),
    }

    await db_session.execute(
        update(RepoConfig).where(RepoConfig.id == owner_repo.id).values(deleted_at=utcnow())
    )
    await db_session.commit()
    deleted_repo = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json=_invocation_body(definition_id, "PROL-124"),
    )
    assert deleted_repo.status_code == 422
    assert deleted_repo.json()["detail"]["blockers"] == [
        {
            "code": "default_repository_unavailable",
            "path": "defaultRepoConfigId",
            "message": "The default repository is missing, deleted, or not owned by this user.",
        }
    ]

    await db_session.execute(
        update(WorkflowDefinition)
        .where(WorkflowDefinition.id == UUID(definition_id))
        .values(default_repo_config_id=other_repo.id)
    )
    await db_session.commit()
    foreign_repo = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json=_invocation_body(definition_id, "PROL-125"),
    )
    assert foreign_repo.status_code == 422
    assert foreign_repo.json()["detail"]["blockers"][0]["code"] == (
        "default_repository_unavailable"
    )


@pytest.mark.asyncio
async def test_new_invocation_requires_current_active_owned_definition(
    client: AsyncClient,
) -> None:
    owner = await register_and_login(client, "invocation-definition-owner@example.com")
    other = await register_and_login(client, "invocation-definition-other@example.com")

    stale_created = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=_definition_payload(),
    )
    assert stale_created.status_code == 201
    stale_id = stale_created.json()["id"]
    update_body = _definition_payload()
    update_body["expectedRevision"] = 1
    updated = await client.put(
        f"/v1/workflows/{stale_id}",
        headers=_headers(owner),
        json=update_body,
    )
    assert updated.status_code == 200
    stale = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json=_invocation_body(stale_id, "PROL-123"),
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "workflow_definition_revision_conflict"

    deleted_created = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=_definition_payload(),
    )
    assert deleted_created.status_code == 201
    deleted_id = deleted_created.json()["id"]
    deleted = await client.delete(
        f"/v1/workflows/{deleted_id}",
        params={"expectedRevision": 1},
        headers=_headers(owner),
    )
    assert deleted.status_code == 204
    absent = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json=_invocation_body(deleted_id, "PROL-123"),
    )
    assert absent.status_code == 404
    assert absent.json()["detail"]["code"] == "workflow_definition_not_found"

    foreign_created = await client.post(
        "/v1/workflows",
        headers=_headers(other),
        json=_definition_payload(),
    )
    assert foreign_created.status_code == 201
    foreign = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json=_invocation_body(foreign_created.json()["id"], "PROL-123"),
    )
    assert foreign.status_code == 404
    assert foreign.json()["detail"]["code"] == "workflow_definition_not_found"


@pytest.mark.asyncio
async def test_real_postgres_replay_canonicalizes_key_order_and_equal_numbers(
    client: AsyncClient,
) -> None:
    owner = await register_and_login(client, "invocation-canonical-owner@example.com")
    definition = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=_definition_payload(number=True),
    )
    assert definition.status_code == 201
    definition_id = definition.json()["id"]
    invocation_id = str(uuid4())
    bodies = [
        (
            '{"schemaVersion":1,"workflowDefinitionId":"'
            + definition_id
            + '","expectedRevision":1,"arguments":{"ticket":1},'
            '"target":{"kind":"managedCloud"}}'
        ),
        (
            '{"target":{"kind":"managedCloud"},"arguments":{"ticket":1.0},'
            '"expectedRevision":1,"workflowDefinitionId":"'
            + definition_id
            + '","schemaVersion":1}'
        ),
        (
            '{"arguments":{"ticket":1e0},"schemaVersion":1,'
            '"target":{"kind":"managedCloud"},"workflowDefinitionId":"'
            + definition_id
            + '","expectedRevision":1}'
        ),
    ]

    responses = []
    for raw in bodies:
        responses.append(
            await client.put(
                f"/v1/workflow-invocations/{invocation_id}",
                headers={**_headers(owner), "Content-Type": "application/json"},
                content=raw,
            )
        )
    assert [response.status_code for response in responses] == [201, 200, 200]
    assert responses[0].json() == responses[1].json() == responses[2].json()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "number_source",
    ["9007199254740992", "9007199254740992.0", "9.007199254740992e15"],
)
async def test_nonportable_numbers_are_coded_400_not_framework_422(
    client: AsyncClient,
    number_source: str,
) -> None:
    owner = await register_and_login(
        client,
        f"invocation-number-{number_source.replace('.', '-')[:20]}@example.com",
    )
    definition_response = await client.post(
        "/v1/workflows",
        headers=_headers(owner),
        json=_definition_payload(number=True),
    )
    assert definition_response.status_code == 201
    definition_id = definition_response.json()["id"]
    raw = (
        '{"schemaVersion":1,"workflowDefinitionId":"'
        + definition_id
        + '","expectedRevision":1,"arguments":{"ticket":'
        + number_source
        + '},"target":{"kind":"managedCloud"}}'
    )
    response = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers={**_headers(owner), "Content-Type": "application/json"},
        content=raw,
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_workflow_invocation"


@pytest.mark.asyncio
async def test_malformed_argument_422_never_reflects_value(
    client: AsyncClient,
) -> None:
    owner = await register_and_login(client, "invocation-redaction@example.com")
    response = await client.put(
        f"/v1/workflow-invocations/{uuid4()}",
        headers=_headers(owner),
        json={
            "schemaVersion": 1,
            "workflowDefinitionId": str(uuid4()),
            "expectedRevision": 1,
            "arguments": {"ticket": ["ARGUMENT_VALUE_MUST_NOT_LEAK"]},
            "target": {"kind": "managedCloud"},
        },
    )
    assert response.status_code == 422
    assert "ARGUMENT_VALUE_MUST_NOT_LEAK" not in response.text
    assert "[redacted]" in response.text

    for invalid_version in (True, 1.0, "1"):
        wrong_version = await client.put(
            f"/v1/workflow-invocations/{uuid4()}",
            headers=_headers(owner),
            json={
                "schemaVersion": invalid_version,
                "workflowDefinitionId": str(uuid4()),
                "expectedRevision": 1,
                "arguments": {},
                "target": {"kind": "managedCloud"},
            },
        )
        assert wrong_version.status_code == 422
