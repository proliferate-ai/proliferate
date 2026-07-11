"""Target validation and workspace provisioning for workflow triggers."""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import (
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    WORKFLOW_TRIGGER_KIND_POLL,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
)
from proliferate.db.store import cloud_workflows as workflow_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repositories_store
from proliferate.db.store.cloud_workflows import WorkflowRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.definition import has_parallel_groups


def split_repo_full_name(repo_full_name: str | None) -> tuple[str, str]:
    """Parse an ``owner/name`` repository pin."""

    cleaned = (repo_full_name or "").strip()
    owner, _, name = cleaned.partition("/")
    if not owner or not name or "/" in name:
        raise CloudApiError(
            "invalid_repo",
            "Pin a repository as 'owner/name'.",
            status_code=400,
        )
    return owner, name


async def ensure_trigger_target_workspace(
    db: AsyncSession, *, user: ActorIdentity, repo_full_name: str | None
) -> UUID:
    """Resolve or provision the caller's cloud workspace for a repository pin."""

    owner, name = split_repo_full_name(repo_full_name)
    repo_environment = await repositories_store.get_cloud_repo_environment(
        db, user_id=user.id, git_owner=owner, git_repo_name=name
    )
    if repo_environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_found",
            "Configure this repository as a cloud environment before pinning it to a trigger.",
            status_code=404,
        )
    existing = await cloud_workspace_store.get_active_cloud_workspace_for_repo_environment(
        db, user_id=user.id, repo_environment_id=repo_environment.id
    )
    if existing is not None:
        return existing.id
    workspace = await cloud_workspace_store.create_cloud_workspace(
        db,
        user_id=user.id,
        repo_environment_id=repo_environment.id,
        display_name=f"{owner}/{name}",
        git_branch=f"workflow-trigger/{uuid4().hex[:12]}",
        git_base_branch=repo_environment.default_branch or "main",
    )
    if workspace is None:  # pragma: no cover - the generated branch is unique
        raise CloudApiError(
            "cloud_workspace_create_failed",
            "Could not provision a workspace for the pinned repository.",
            status_code=409,
        )
    return workspace.id


def validate_trigger_target_mode(mode: str, *, kind: str = WORKFLOW_TRIGGER_KIND_SCHEDULE) -> None:
    if mode == WORKFLOW_TARGET_MODE_LOCAL:
        return
    if mode != WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        target_kind = "poll" if kind == WORKFLOW_TRIGGER_KIND_POLL else "scheduled"
        raise CloudApiError(
            "invalid_target_mode",
            f"target_mode must be 'personal_cloud' or 'local' for {target_kind} triggers.",
            status_code=400,
        )


async def assert_parallel_target_supported(
    db: AsyncSession, *, workflow: WorkflowRecord, target_mode: str
) -> None:
    """Reject local triggers for definitions containing parallel groups."""

    if target_mode != WORKFLOW_TARGET_MODE_LOCAL or workflow.current_version_id is None:
        return
    version = await workflow_store.get_version(db, workflow.current_version_id)
    if version is None:
        return
    if has_parallel_groups(version.definition_json.get("agents")):
        raise CloudApiError(
            "parallel_local_unsupported",
            "Workflows with parallel groups are cloud-only in v1; a local (desktop) "
            "target is not supported for their triggers.",
            status_code=400,
        )
