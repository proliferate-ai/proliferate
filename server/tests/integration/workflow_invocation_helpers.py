"""Shared helpers for workflow invocation API tests."""

from __future__ import annotations

from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import GitProvider, RepoEnvironmentKind
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.workflows import WorkflowInvocation
from proliferate.db.store import workflow_deliveries as delivery_store
from proliferate.db.store.workflow_delivery_custody import ManagedCloudTarget
from proliferate.utils.time import utcnow

INSTALL_ID = "desktop-install-1"
ACCEPT_SANDBOX = "sbx-accept"
ACCEPT_EPOCH = "epoch-accept"
ACCEPT_TARGET = ManagedCloudTarget(cloud_sandbox_id=ACCEPT_SANDBOX)


def _headers(tokens: dict[str, str], idempotency_key: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    return headers


def _definition_payload(default_repo_config_id: str | None = None) -> dict[str, object]:
    return {
        "title": "Diagnose ticket",
        "description": "Investigate one ticket and report the result.",
        "defaultRepoConfigId": default_repo_config_id,
        "inputs": [
            {"name": "ticket", "type": "string", "required": True},
            {"name": "attempts", "type": "number", "required": False},
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
                        "goal": {"objective": "Produce a diagnosis."},
                    }
                ],
            }
        ],
    }


def _invocation_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "expectedRevision": 1,
        "inputs": {"ticket": "PRO-123"},
        "target": {"kind": "managedCloud"},
        "placement": {
            "kind": "newWorkspace",
            "repository": {"kind": "definitionDefault"},
        },
    }
    payload.update(overrides)
    return payload


async def _create_definition(
    client: AsyncClient,
    tokens: dict[str, str],
    *,
    default_repo_config_id: str | None = None,
) -> dict[str, object]:
    response = await client.post(
        "/v1/workflows",
        headers=_headers(tokens),
        json=_definition_payload(default_repo_config_id),
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _invoke(
    client: AsyncClient,
    tokens: dict[str, str],
    definition_id: str,
    *,
    key: str,
    payload: dict[str, object] | None = None,
):
    return await client.post(
        f"/v1/workflows/{definition_id}/invocations",
        headers=_headers(tokens, idempotency_key=key),
        json=payload or _invocation_payload(),
    )


async def _seed_repo_with_environments(
    db: AsyncSession,
    *,
    user_id: str,
    git_repo_name: str = "proliferate",
    cloud: bool = True,
    local_paths: tuple[str, ...] = (),
    desktop_install_id: str = INSTALL_ID,
    default_branch: str | None = "main",
) -> tuple[RepoConfig, tuple[RepoEnvironment, ...]]:
    now = utcnow()
    repo = RepoConfig(
        user_id=UUID(user_id),
        git_provider=GitProvider.github,
        git_owner="proliferate-ai",
        git_repo_name=git_repo_name,
        created_at=now,
        updated_at=now,
    )
    db.add(repo)
    await db.flush()
    environments: list[RepoEnvironment] = []
    if cloud:
        environments.append(
            RepoEnvironment(
                repo_config_id=repo.id,
                environment_kind=RepoEnvironmentKind.cloud,
                default_branch=default_branch,
            )
        )
    for path in local_paths:
        environments.append(
            RepoEnvironment(
                repo_config_id=repo.id,
                environment_kind=RepoEnvironmentKind.local,
                desktop_install_id=desktop_install_id,
                local_path=path,
                default_branch=default_branch,
            )
        )
    db.add_all(environments)
    await db.commit()
    return repo, tuple(environments)


async def _seed_desktop_worker(
    db: AsyncSession,
    *,
    user_id: str,
    desktop_install_id: str = INSTALL_ID,
) -> None:
    now = utcnow()
    db.add(
        CloudRuntimeWorker(
            owner_user_id=UUID(user_id),
            runtime_kind="desktop",
            desktop_install_id=desktop_install_id,
            token_hash=f"hash-{uuid4().hex}",
            status="online",
            enrolled_at=now,
            last_seen_at=now,
        )
    )
    await db.commit()


async def _outbox_count(
    db: AsyncSession,
    task_name: str,
    invocation_id: str,
    *,
    key: str | None = None,
) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(BackgroundOutboxTask)
            .where(
                BackgroundOutboxTask.task_name == task_name,
                BackgroundOutboxTask.idempotency_key == (key or f"{task_name}:{invocation_id}"),
            )
        )
    ) or 0


async def _outbox_count_for_invocation(
    db: AsyncSession,
    task_name: str,
    invocation_id: str,
) -> int:
    """All enqueued tasks for the invocation, regardless of idempotency key.

    A "no task was enqueued" proof must not assume the key shape: a task
    enqueued under any key would silently pass a key-scoped count of 0.
    """

    return (
        await db.scalar(
            select(func.count())
            .select_from(BackgroundOutboxTask)
            .where(
                BackgroundOutboxTask.task_name == task_name,
                BackgroundOutboxTask.kwargs_json["invocation_id"].astext == invocation_id,
            )
        )
    ) or 0


async def _force_accept(
    db: AsyncSession,
    invocation_id: UUID,
    *,
    cloud_sandbox_id: str = ACCEPT_SANDBOX,
    epoch: str = ACCEPT_EPOCH,
) -> None:
    """Drive a delivery through the full custody flow to `accepted`."""

    target = ManagedCloudTarget(cloud_sandbox_id=cloud_sandbox_id)
    handed = await delivery_store.mark_delivery_handoff_started(
        db, invocation_id=invocation_id, expected_target=target
    )
    assert handed is not None
    bundle_digest = await db.scalar(
        select(WorkflowInvocation.bundle_digest).where(WorkflowInvocation.id == invocation_id)
    )
    assert bundle_digest is not None
    fixed = await delivery_store.fix_runtime_payload(
        db,
        invocation_id=invocation_id,
        run_json={
            "runId": str(invocation_id),
            "contractVersion": 1,
            "bundleDigest": bundle_digest,
        },
        anyharness_data_epoch=epoch,
        expected_target=target,
    )
    assert fixed is not None and fixed.runtime_payload_digest is not None
    accepted = await delivery_store.record_delivery_accepted(
        db,
        invocation_id=invocation_id,
        anyharness_run_id=str(invocation_id),
        expected_runtime_payload_digest=fixed.runtime_payload_digest,
        expected_data_epoch=epoch,
        expected_target=target,
    )
    assert accepted is not None
    await db.commit()


async def _project(
    db: AsyncSession,
    invocation_id: UUID,
    *,
    revision: int,
    observation: dict[str, object],
) -> None:
    delivery = await delivery_store.get_workflow_delivery(db, invocation_id=invocation_id)
    assert delivery is not None
    assert delivery.runtime_payload_digest is not None
    assert delivery.anyharness_data_epoch is not None
    assert delivery.cloud_sandbox_id is not None
    applied = await delivery_store.update_runtime_projection(
        db,
        invocation_id=invocation_id,
        anyharness_run_id=str(invocation_id),
        runtime_revision=revision,
        runtime_observation_json=observation,
        runtime_observed_at=utcnow(),
        expected_runtime_payload_digest=delivery.runtime_payload_digest,
        expected_data_epoch=delivery.anyharness_data_epoch,
        expected_target=ManagedCloudTarget(cloud_sandbox_id=delivery.cloud_sandbox_id),
    )
    assert applied is not None
    await db.commit()


CLEANUP_BLOCKED_OBSERVATION: dict[str, object] = {
    "status": "finalizing",
    "error": {
        "code": "workflow_session_cleanup_requires_abandon",
        "message": "Agent binary was removed; session cleanup cannot complete.",
    },
}


async def _seed_cloud_workspace(
    db: AsyncSession,
    *,
    owner_user_id: str,
    repo_environment_id: UUID,
    anyharness_workspace_id: str,
    archived: bool = False,
) -> CloudWorkspace:
    now = utcnow()
    workspace = CloudWorkspace(
        owner_user_id=UUID(owner_user_id),
        repo_environment_id=repo_environment_id,
        display_name="Workspace",
        git_branch="workflow/test",
        anyharness_workspace_id=anyharness_workspace_id,
        created_at=now,
        updated_at=now,
        archived_at=now if archived else None,
    )
    db.add(workspace)
    await db.commit()
    return workspace
