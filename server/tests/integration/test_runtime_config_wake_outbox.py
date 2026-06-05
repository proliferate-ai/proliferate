from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.integrations.github import GitHubRepoBranches
from proliferate.server.cloud.repo_config import service as repo_config_service
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account


@pytest.mark.asyncio
async def test_runtime_config_refresh_enqueues_materialization_wake_outbox(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _repo_branches(*_args: object, **_kwargs: object) -> GitHubRepoBranches:
        return GitHubRepoBranches(
            default_branch="main",
            branches=["main"],
        )

    monkeypatch.setattr(repo_config_service, "get_repo_branches_for_credentials", _repo_branches)
    auth = await create_user_and_login(client, db_session, email_prefix="runtime-config-wake")
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token="gh-runtime-config-wake",
    )
    profile = await client.post("/v1/cloud/sandbox-profiles/personal", headers=auth.headers)
    assert profile.status_code == 200, profile.text
    profile_body = profile.json()
    target_id = profile_body["primaryTargetId"]

    created = await client.post(
        f"/v1/cloud/targets/{target_id}/configs/materialize",
        headers=auth.headers,
        json={
            "gitOwner": "proliferate-ai",
            "gitRepoName": "proliferate",
        },
    )
    assert created.status_code == 200, created.text
    first_command_id = UUID(created.json()["command"]["commandId"])

    refreshed = await client.post(
        f"/v1/cloud/sandbox-profiles/{profile_body['id']}/runtime-config/refresh",
        headers=auth.headers,
        json={"reason": "test_runtime_config_wake"},
    )
    assert refreshed.status_code == 200, refreshed.text

    command = (
        (
            await db_session.execute(
                select(CloudCommand)
                .where(CloudCommand.target_id == UUID(target_id))
                .where(CloudCommand.kind == "materialize_environment")
                .where(CloudCommand.id != first_command_id)
                .order_by(CloudCommand.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    assert command is not None
    outbox_task = await db_session.scalar(
        select(BackgroundOutboxTask).where(
            BackgroundOutboxTask.task_name == "runtime.wake_target",
            BackgroundOutboxTask.kwargs_json["command_id"].astext == str(command.id),
        )
    )
    assert outbox_task is not None
    assert outbox_task.kwargs_json["target_id"] == target_id
