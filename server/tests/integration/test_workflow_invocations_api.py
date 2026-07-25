"""HTTP and real-Postgres acceptance tests for workflow invocation creation."""

from __future__ import annotations

import asyncio
import json
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.db.store import workflow_invocations as invocation_store
from tests.integration.cloud_api_helpers import register_and_login
from tests.integration.workflow_invocation_helpers import (
    INSTALL_ID,
    _create_definition,
    _definition_payload,
    _headers,
    _invocation_payload,
    _invoke,
    _outbox_count,
    _seed_desktop_worker,
    _seed_repo_with_environments,
)

pytestmark = pytest.mark.asyncio


class TestInvokeManagedCloud:
    async def test_invoke_scratch_creates_invocation_delivery_and_outbox(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-invoke-owner@example.com")
        definition = await _create_definition(client, owner)
        response = await _invoke(client, owner, definition["id"], key="key-1")
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["workflowDefinitionId"] == definition["id"]
        assert body["definitionRevision"] == 1
        assert body["titleSnapshot"] == "Diagnose ticket"
        assert body["targetKind"] == "managedCloud"
        assert len(body["requestHash"]) == 64
        assert len(body["bundleDigest"]) == 64
        assert body["arguments"] == {"ticket": "PRO-123"}
        # Null definition default resolves to none and therefore scratch.
        assert body["resolvedPlacement"] == {
            "kind": "newWorkspace",
            "repository": {"kind": "none"},
        }
        assert body["delivery"]["status"] == "queued"
        assert await _outbox_count(db_session, "workflows.deliver_managed_run", body["id"]) == 1

        detail = await client.get(
            f"/v1/workflows/invocations/{body['id']}", headers=_headers(owner)
        )
        assert detail.status_code == 200
        bundle = detail.json()["resolvedBundle"]
        assert bundle["runId"] == body["id"]
        assert bundle["resolvedStages"][0]["steps"][0]["prompt"] == "Investigate PRO-123."

    async def test_exact_replay_returns_same_invocation_with_200(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-replay-owner@example.com")
        definition = await _create_definition(client, owner)
        first = await _invoke(client, owner, definition["id"], key="key-r")
        assert first.status_code == 201
        second = await _invoke(client, owner, definition["id"], key="key-r")
        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]
        assert (
            await _outbox_count(db_session, "workflows.deliver_managed_run", first.json()["id"])
            == 1
        )

    async def test_same_key_different_request_conflicts(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-conflict-owner@example.com")
        definition = await _create_definition(client, owner)
        first = await _invoke(client, owner, definition["id"], key="key-c")
        assert first.status_code == 201
        second = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-c",
            payload=_invocation_payload(inputs={"ticket": "PRO-999"}),
        )
        assert second.status_code == 409
        assert second.json()["detail"]["code"] == "workflow_invocation_idempotency_conflict"

    async def test_concurrent_identical_requests_create_one_invocation(
        self, client: AsyncClient, test_engine: AsyncEngine
    ) -> None:
        owner = await register_and_login(client, "wf-race-owner@example.com")
        definition = await _create_definition(client, owner)

        first, second = await asyncio.gather(
            _invoke(client, owner, definition["id"], key="key-race"),
            _invoke(client, owner, definition["id"], key="key-race"),
        )
        # The (user, key) advisory lock serializes the pair: exactly one
        # creation and one replay — never two 201s, never a loser error.
        assert sorted([first.status_code, second.status_code]) == [200, 201]
        assert first.json()["id"] == second.json()["id"]

        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
        async with session_factory() as session:
            listed = await invocation_store.list_workflow_invocations(
                session, user_id=UUID(owner["user_id"])
            )
        assert len(listed) == 1

    async def test_replay_survives_definition_default_change(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-freeze-owner@example.com")
        repo, _ = await _seed_repo_with_environments(db_session, user_id=owner["user_id"])
        definition = await _create_definition(client, owner, default_repo_config_id=str(repo.id))
        first = await _invoke(client, owner, definition["id"], key="key-f")
        assert first.status_code == 201
        resolved = first.json()["resolvedPlacement"]
        assert resolved["repository"]["kind"] == "repositoryEnvironment"
        assert resolved["repository"]["repositoryIdentity"] == (
            "github:proliferate-ai/proliferate"
        )
        assert resolved["baseRef"] == "main"

        # Remove the default (a revision-2 update); the frozen invocation and
        # its replay must not change.
        update = await client.put(
            f"/v1/workflows/{definition['id']}",
            headers=_headers(owner),
            json={**_definition_payload(None), "expectedRevision": 1},
        )
        assert update.status_code == 200

        replay = await _invoke(client, owner, definition["id"], key="key-f")
        assert replay.status_code == 200
        assert replay.json()["resolvedPlacement"] == resolved

    async def test_cloud_default_without_cloud_environment_unavailable(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-noenv-owner@example.com")
        repo, _ = await _seed_repo_with_environments(
            db_session, user_id=owner["user_id"], cloud=False
        )
        definition = await _create_definition(client, owner, default_repo_config_id=str(repo.id))
        response = await _invoke(client, owner, definition["id"], key="key-n")
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "workflow_repository_environment_unavailable"

    async def test_explicit_environment_must_match_target_kind(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-envkind-owner@example.com")
        await _seed_desktop_worker(db_session, user_id=owner["user_id"])
        _, environments = await _seed_repo_with_environments(
            db_session,
            user_id=owner["user_id"],
            cloud=False,
            local_paths=("/Users/dev/proliferate",),
        )
        definition = await _create_definition(client, owner)
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-e",
            payload=_invocation_payload(
                placement={
                    "kind": "newWorkspace",
                    "repository": {
                        "kind": "environment",
                        "repoEnvironmentId": str(environments[0].id),
                    },
                }
            ),
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "workflow_repository_environment_unavailable"


class TestInvokeValidation:
    async def test_revision_conflict(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-rev-owner@example.com")
        definition = await _create_definition(client, owner)
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-rc",
            payload=_invocation_payload(expectedRevision=2),
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "workflow_definition_revision_conflict"

    async def test_missing_idempotency_key_rejected(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-nokey-owner@example.com")
        definition = await _create_definition(client, owner)
        response = await client.post(
            f"/v1/workflows/{definition['id']}/invocations",
            headers=_headers(owner),
            json=_invocation_payload(),
        )
        assert response.status_code == 422

    @pytest.mark.parametrize(
        ("inputs", "expected_code"),
        [
            ({"ticket": "PRO-1", "nope": "x"}, "workflow_input_unknown"),
            ({}, "workflow_input_missing"),
            ({"ticket": 7}, "workflow_input_type_mismatch"),
            (
                {"ticket": "PRO-1", "attempts": 9007199254740993},
                "workflow_input_number_outside_exact_range",
            ),
        ],
    )
    async def test_argument_validation_maps_to_typed_400(
        self,
        client: AsyncClient,
        inputs: dict[str, object],
        expected_code: str,
    ) -> None:
        owner = await register_and_login(client, f"wf-args-{expected_code}@example.com")
        definition = await _create_definition(client, owner)
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-v",
            payload=_invocation_payload(inputs=inputs),
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == expected_code

    async def test_non_finite_number_is_structured_400(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-nan-owner@example.com")
        definition = await _create_definition(client, owner)
        raw = json.dumps(
            _invocation_payload(inputs={"ticket": "PRO-1", "attempts": None})
        ).replace('"attempts": null', '"attempts": NaN')
        response = await client.post(
            f"/v1/workflows/{definition['id']}/invocations",
            headers={
                **_headers(owner, idempotency_key="key-nan"),
                "Content-Type": "application/json",
            },
            content=raw,
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == "workflow_input_number_not_finite"

    async def test_lone_surrogate_is_structured_400(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-surrogate-owner@example.com")
        definition = await _create_definition(client, owner)
        raw = (
            '{"expectedRevision": 1, "inputs": {"ticket": "bad \\ud800 text"},'
            ' "target": {"kind": "managedCloud"},'
            ' "placement": {"kind": "newWorkspace", "repository": {"kind": "none"}}}'
        )
        response = await client.post(
            f"/v1/workflows/{definition['id']}/invocations",
            headers={
                **_headers(owner, idempotency_key="key-s"),
                "Content-Type": "application/json",
            },
            content=raw,
        )
        # Exactly the typed 400 — not a tolerated 422 and never a 500 from
        # echoing the surrogate through the error body.
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == "workflow_request_not_canonical"

    async def test_session_binding_stage_index_out_of_range(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-binding-owner@example.com")
        definition = await _create_definition(client, owner)
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-b",
            payload=_invocation_payload(
                placement={
                    "kind": "existingWorkspace",
                    "workspaceId": "ws-1",
                    "sessionBindings": [{"stageIndex": 5, "sessionId": "sess-1"}],
                }
            ),
        )
        assert response.status_code == 400
        assert "out of range" in response.json()["detail"]["message"]

    async def test_existing_workspace_placement_passes_through(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-existing-owner@example.com")
        definition = await _create_definition(client, owner)
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-w",
            payload=_invocation_payload(
                placement={
                    "kind": "existingWorkspace",
                    "workspaceId": "ws-9",
                    "sessionBindings": [{"stageIndex": 0, "sessionId": "sess-1"}],
                }
            ),
        )
        assert response.status_code == 201, response.text
        assert response.json()["resolvedPlacement"] == {
            "kind": "existingWorkspace",
            "workspaceId": "ws-9",
            "sessionBindings": [{"stageIndex": 0, "sessionId": "sess-1"}],
        }


class TestInvokeDesktop:
    async def test_desktop_without_enrolled_worker_unavailable(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-nodesk-owner@example.com")
        definition = await _create_definition(client, owner)
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-d0",
            payload=_invocation_payload(
                target={"kind": "desktop", "desktopInstallId": INSTALL_ID}
            ),
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "workflow_target_unavailable"

    async def test_desktop_default_resolution_and_no_outbox(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-desk-owner@example.com")
        await _seed_desktop_worker(db_session, user_id=owner["user_id"])
        repo, environments = await _seed_repo_with_environments(
            db_session,
            user_id=owner["user_id"],
            cloud=False,
            local_paths=("/Users/dev/proliferate",),
        )
        definition = await _create_definition(client, owner, default_repo_config_id=str(repo.id))
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-d1",
            payload=_invocation_payload(
                target={"kind": "desktop", "desktopInstallId": INSTALL_ID}
            ),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["targetKind"] == "desktop"
        assert body["desktopInstallId"] == INSTALL_ID
        assert body["resolvedPlacement"]["repository"]["repoEnvironmentId"] == str(
            environments[0].id
        )
        # Desktop delivery is heartbeat pull; no managed outbox item exists.
        assert await _outbox_count(db_session, "workflows.deliver_managed_run", body["id"]) == 0

    async def test_desktop_ambiguous_local_paths_rejected(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-ambig-owner@example.com")
        await _seed_desktop_worker(db_session, user_id=owner["user_id"])
        repo, _ = await _seed_repo_with_environments(
            db_session,
            user_id=owner["user_id"],
            cloud=False,
            local_paths=("/Users/dev/a", "/Users/dev/b"),
        )
        definition = await _create_definition(client, owner, default_repo_config_id=str(repo.id))
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-d2",
            payload=_invocation_payload(
                target={"kind": "desktop", "desktopInstallId": INSTALL_ID}
            ),
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "workflow_repository_environment_ambiguous"
