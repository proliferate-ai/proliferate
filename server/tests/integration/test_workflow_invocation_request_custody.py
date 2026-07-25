"""Ingress custody for workflow invocation requests (findings B/G/I/J).

Raw-before-coercion validation, lone-surrogate exact 400s, existing-workspace
binding checks against Cloud projections, frozen setup config under
bundleDigest, and winner-uncommitted idempotency serialization on real
Postgres.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.db.models.cloud.repositories import RepoEnvironment
from proliferate.server.workflows import service as workflow_service
from proliferate.server.workflows.models import WorkflowInvocationCreateRequest
from proliferate.utils.time import utcnow
from tests.integration.cloud_api_helpers import register_and_login
from tests.integration.workflow_invocation_helpers import (
    INSTALL_ID,
    _create_definition,
    _headers,
    _invocation_payload,
    _invoke,
    _seed_cloud_workspace,
    _seed_desktop_worker,
    _seed_repo_with_environments,
)

pytestmark = pytest.mark.asyncio


class TestRawBeforeCoercion:
    @pytest.mark.parametrize("raw_revision", ['"1"', "true"])
    async def test_expected_revision_rejects_coercible_values(
        self, client: AsyncClient, raw_revision: str
    ) -> None:
        owner = await register_and_login(client, f"wf-strict-{len(raw_revision)}@example.com")
        definition = await _create_definition(client, owner)
        raw = (
            f'{{"expectedRevision": {raw_revision}, "inputs": {{"ticket": "PRO-1"}},'
            ' "target": {"kind": "managedCloud"},'
            ' "placement": {"kind": "newWorkspace", "repository": {"kind": "none"}}}'
        )
        response = await client.post(
            f"/v1/workflows/{definition['id']}/invocations",
            headers={
                **_headers(owner, idempotency_key="key-strict"),
                "Content-Type": "application/json",
            },
            content=raw,
        )
        assert response.status_code == 422, response.text

    async def test_stage_index_rejects_string_integers(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-strictsi-owner@example.com")
        definition = await _create_definition(client, owner)
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-si",
            payload=_invocation_payload(
                placement={
                    "kind": "existingWorkspace",
                    "workspaceId": "ws-1",
                    "sessionBindings": [{"stageIndex": "0", "sessionId": "sess-1"}],
                }
            ),
        )
        assert response.status_code == 422, response.text

    async def test_lone_surrogate_in_input_name_is_exact_400(self, client: AsyncClient) -> None:
        owner = await register_and_login(client, "wf-surrkey-owner@example.com")
        definition = await _create_definition(client, owner)
        raw = (
            '{"expectedRevision": 1, "inputs": {"bad\\ud800name": "x"},'
            ' "target": {"kind": "managedCloud"},'
            ' "placement": {"kind": "newWorkspace", "repository": {"kind": "none"}}}'
        )
        response = await client.post(
            f"/v1/workflows/{definition['id']}/invocations",
            headers={
                **_headers(owner, idempotency_key="key-sk"),
                "Content-Type": "application/json",
            },
            content=raw,
        )
        # The offending key is echoed in the typed detail path; the response
        # must still render as the exact structured 400, never a 500.
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == "workflow_request_not_canonical"


class TestExistingWorkspaceBindings:
    async def test_duplicate_session_ids_across_stages_rejected(
        self, client: AsyncClient
    ) -> None:
        owner = await register_and_login(client, "wf-dupsess-owner@example.com")
        payload = {
            "title": "Two stages",
            "description": "",
            "defaultRepoConfigId": None,
            "inputs": [{"name": "ticket", "type": "string", "required": True}],
            "stages": [
                {
                    "harnessConfig": {"agentKind": "claude", "modelId": "sonnet"},
                    "steps": [{"kind": "agent.prompt", "prompt": "One {{inputs.ticket}}."}],
                },
                {
                    "harnessConfig": {"agentKind": "claude", "modelId": "sonnet"},
                    "steps": [{"kind": "agent.prompt", "prompt": "Two."}],
                },
            ],
        }
        created = await client.post("/v1/workflows", headers=_headers(owner), json=payload)
        assert created.status_code == 201, created.text
        response = await _invoke(
            client,
            owner,
            created.json()["id"],
            key="key-dup",
            payload=_invocation_payload(
                placement={
                    "kind": "existingWorkspace",
                    "workspaceId": "ws-1",
                    "sessionBindings": [
                        {"stageIndex": 0, "sessionId": "sess-1"},
                        {"stageIndex": 1, "sessionId": "sess-1"},
                    ],
                }
            ),
        )
        assert response.status_code == 400
        assert "at most one stage" in response.json()["detail"]["message"]

    @pytest.mark.parametrize("scenario", ["foreign", "archived"])
    async def test_known_managed_workspace_projection_is_checked(
        self, client: AsyncClient, db_session: AsyncSession, scenario: str
    ) -> None:
        owner = await register_and_login(client, f"wf-ws-{scenario}@example.com")
        other = await register_and_login(client, f"wf-ws-{scenario}-other@example.com")
        workspace_owner = other if scenario == "foreign" else owner
        _, environments = await _seed_repo_with_environments(
            db_session, user_id=workspace_owner["user_id"]
        )
        await _seed_cloud_workspace(
            db_session,
            owner_user_id=workspace_owner["user_id"],
            repo_environment_id=environments[0].id,
            anyharness_workspace_id=f"ws-{scenario}",
            archived=scenario == "archived",
        )
        definition = await _create_definition(client, owner)
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key=f"key-{scenario}",
            payload=_invocation_payload(
                placement={"kind": "existingWorkspace", "workspaceId": f"ws-{scenario}"}
            ),
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == "workflow_workspace_conflict"

    async def test_unknown_target_local_workspace_defers_to_anyharness(
        self, client: AsyncClient
    ) -> None:
        owner = await register_and_login(client, "wf-ws-unknown@example.com")
        definition = await _create_definition(client, owner)
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-unknown-ws",
            payload=_invocation_payload(
                placement={"kind": "existingWorkspace", "workspaceId": "ws-never-seen"}
            ),
        )
        assert response.status_code == 201, response.text


class TestFrozenSetupConfig:
    async def test_setup_config_is_frozen_against_edit_and_delete(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-setup-owner@example.com")
        repo, environments = await _seed_repo_with_environments(
            db_session, user_id=owner["user_id"]
        )
        environment_id = environments[0].id
        await db_session.execute(
            update(RepoEnvironment)
            .where(RepoEnvironment.id == environment_id)
            .values(setup_script="make bootstrap", run_command="make run")
        )
        await db_session.commit()

        definition = await _create_definition(client, owner, default_repo_config_id=str(repo.id))
        created = await _invoke(client, owner, definition["id"], key="key-setup")
        assert created.status_code == 201, created.text
        repository = created.json()["resolvedPlacement"]["repository"]
        assert repository["setupScript"] == "make bootstrap"
        assert repository["runCommand"] == "make run"

        # Mutate, then soft-delete the environment: the frozen snapshot and
        # its replay must not change.
        await db_session.execute(
            update(RepoEnvironment)
            .where(RepoEnvironment.id == environment_id)
            .values(setup_script="rm -rf /", run_command="changed", deleted_at=utcnow())
        )
        await db_session.commit()

        replay = await _invoke(client, owner, definition["id"], key="key-setup")
        assert replay.status_code == 200
        assert replay.json()["resolvedPlacement"]["repository"] == repository

    async def test_desktop_placement_never_contains_local_paths(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        owner = await register_and_login(client, "wf-nolocal-owner@example.com")
        await _seed_desktop_worker(db_session, user_id=owner["user_id"])
        repo, _ = await _seed_repo_with_environments(
            db_session,
            user_id=owner["user_id"],
            cloud=False,
            local_paths=("/Users/dev/secret-location/proliferate",),
        )
        definition = await _create_definition(client, owner, default_repo_config_id=str(repo.id))
        response = await _invoke(
            client,
            owner,
            definition["id"],
            key="key-nolocal",
            payload=_invocation_payload(
                target={"kind": "desktop", "desktopInstallId": INSTALL_ID}
            ),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert "secret-location" not in response.text
        assert "localPath" not in body["resolvedPlacement"]["repository"]
        assert body["resolvedPlacement"]["repository"]["setupScript"] == ""


class TestWinnerUncommittedIdempotency:
    async def test_loser_blocks_on_winner_and_replays_frozen_resolution(
        self, client: AsyncClient, db_session: AsyncSession, test_engine: AsyncEngine
    ) -> None:
        """Finding G: same (user, key) races serialize on the advisory lock.

        The loser must not resolve mutable repository state independently —
        even when that state changes while the winner is still uncommitted —
        and must replay the winner's frozen row instead of erroring.
        """

        owner = await register_and_login(client, "wf-race-svc@example.com")
        repo, environments = await _seed_repo_with_environments(
            db_session, user_id=owner["user_id"], default_branch="main"
        )
        definition = await _create_definition(client, owner, default_repo_config_id=str(repo.id))
        user_id = UUID(owner["user_id"])
        definition_id = UUID(definition["id"])
        body = WorkflowInvocationCreateRequest.model_validate(_invocation_payload())
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

        async def loser() -> tuple[dict[str, object], bool]:
            async with session_factory() as session:
                invocation, _, created = await workflow_service.create_workflow_invocation(
                    session,
                    user_id=user_id,
                    workflow_definition_id=definition_id,
                    idempotency_key="key-g",
                    body=body,
                )
                await session.commit()
                return invocation.resolved_placement_json, created

        async with session_factory() as winner_session:
            winner, _, winner_created = await workflow_service.create_workflow_invocation(
                winner_session,
                user_id=user_id,
                workflow_definition_id=definition_id,
                idempotency_key="key-g",
                body=body,
            )
            assert winner_created is True
            loser_task = asyncio.create_task(loser())
            await asyncio.sleep(0.3)
            # The loser is parked on the advisory lock, not failing or
            # double-resolving.
            assert not loser_task.done()

            # Mutable state changes while the winner is uncommitted.
            await db_session.execute(
                update(RepoEnvironment)
                .where(RepoEnvironment.id == environments[0].id)
                .values(default_branch="rewritten")
            )
            await db_session.commit()

            await winner_session.commit()

        loser_placement, loser_created = await loser_task
        assert loser_created is False
        assert loser_placement == winner.resolved_placement_json
        assert loser_placement["baseRef"] == "main"
