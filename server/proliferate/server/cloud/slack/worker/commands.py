"""Command-launch helpers for deferred Slack bot jobs."""

from __future__ import annotations

import json
import re
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudCommandActorKind,
    CloudCommandKind,
    CloudCommandSource,
)
from proliferate.db import session_ops as db_session
from proliferate.db.store import cloud_repo_config as repo_store
from proliferate.db.store import cloud_sandbox_profiles as profile_store
from proliferate.db.store import cloud_workspaces
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as target_store
from proliferate.server.automations.worker.cloud_execution.command_models import (
    EnsureRepoCheckoutPayload,
    MaterializeWorkspacePayload,
    SendPromptPayload,
    StartSessionPayload,
)
from proliferate.server.automations.worker.cloud_execution.commands import (
    parse_materialize_workspace_result,
    parse_start_session_result,
)
from proliferate.server.automations.worker.cloud_executor_commands import (
    wait_for_command_result,
)
from proliferate.server.automations.worker.cloud_executor_config import (
    default_cloud_executor_config,
)
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.server.cloud.commands.preflight import stamp_and_validate_command_preflight
from proliferate.server.cloud.commands.service import (
    kick_off_command_wake_after_commit_if_required,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.live.service import publish_worker_control_after_commit
from proliferate.server.cloud.workspaces.service import get_configured_sandbox_provider
from proliferate.utils.crypto import encrypt_json
from proliferate.utils.time import utcnow

SYSTEM_SLACK_USER_UUID = UUID("00000000-0000-0000-0000-000000000007")
SLACK_COMMAND_WAIT_TIMEOUT = timedelta(seconds=240)


async def create_and_materialize_workspace(
    db: AsyncSession,
    *,
    organization_id: UUID,
    created_by_user_id: UUID,
    repo: repo_store.CloudRepoConfigValue,
    prompt: str,
    agent_kind: object,
    job_id: UUID,
) -> tuple[cloud_workspaces.CloudWorkspace, str]:
    profile = await profile_store.ensure_organization_sandbox_profile(
        db,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
    )
    target = await target_store.ensure_primary_profile_target(
        db,
        sandbox_profile_id=profile.id,
        created_by_user_id=created_by_user_id,
    )
    branch_name = _slack_branch_name(prompt=prompt, job_id=job_id)
    repo_root_path, worktree_path = _workspace_paths(
        repo=repo,
        branch_name=branch_name,
        workspace_root=target.default_workspace_root,
    )
    workspace = await cloud_workspaces.create_managed_cloud_workspace_for_profile(
        db,
        sandbox_profile_id=profile.id,
        target_id=target.id,
        created_by_user_id=created_by_user_id,
        display_name=f"Slack: {repo.git_owner}/{repo.git_repo_name}",
        git_provider="github",
        git_owner=repo.git_owner,
        git_repo_name=repo.git_repo_name,
        git_branch=branch_name,
        git_base_branch=repo.default_branch,
        worktree_path=worktree_path,
        origin_json=json.dumps(
            {
                "kind": "system",
                "entrypoint": "slack",
                "repoId": str(repo.id),
                "agentKind": str(agent_kind),
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        template_version=get_configured_sandbox_provider().template_version,
        repo_env_vars_ciphertext=encrypt_json(repo.env_vars) if repo.env_vars else None,
    )
    workspace.origin = "slack"
    workspace.updated_at = utcnow()
    await db.flush()
    exposure = await exposures_store.upsert_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=None,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
        visibility="shared_unclaimed",
        claimed_by_user_id=None,
        default_projection_level="live",
        commandable=True,
        status="active",
        origin="slack",
    )
    await publish_worker_control_after_commit(
        db,
        target_id=exposure.target_id,
        reason="exposures",
    )
    checkout = await enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        session_id=None,
        kind=CloudCommandKind.ensure_repo_checkout.value,
        payload=EnsureRepoCheckoutPayload(
            provider="github",
            owner=repo.git_owner,
            name=repo.git_repo_name,
            path=repo_root_path,
            base_branch=repo.default_branch,
        ).to_json(),
        idempotency_scope=f"slack-workspace:{workspace.id}",
        idempotency_key="ensure-repo-checkout",
        slack_user_id=None,
    )
    await db_session.commit_session(db)
    await wait_for_command_result(checkout, timeout=SLACK_COMMAND_WAIT_TIMEOUT)
    root_command = await enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        session_id=None,
        kind=CloudCommandKind.materialize_workspace.value,
        payload=MaterializeWorkspacePayload(
            mode="existing_path",
            path=repo_root_path,
            display_name=f"{repo.git_owner}/{repo.git_repo_name}",
            origin={"kind": "system", "entrypoint": "cloud"},
            creator_context={"kind": "human", "label": "Slack"},
        ).to_json(),
        idempotency_scope=f"slack-workspace:{workspace.id}",
        idempotency_key="materialize-root",
        slack_user_id=None,
    )
    await db_session.commit_session(db)
    root_result = parse_materialize_workspace_result(
        await wait_for_command_result(root_command, timeout=SLACK_COMMAND_WAIT_TIMEOUT),
    )
    worktree_command = await enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        session_id=None,
        kind=CloudCommandKind.materialize_workspace.value,
        payload=MaterializeWorkspacePayload(
            mode="worktree",
            repo_root_id=root_result.repo_root_id,
            target_path=worktree_path,
            new_branch_name=branch_name,
            base_branch=repo.default_branch,
            origin={"kind": "system", "entrypoint": "cloud"},
            creator_context={"kind": "human", "label": "Slack"},
        ).to_json(),
        idempotency_scope=f"slack-workspace:{workspace.id}",
        idempotency_key="materialize-worktree",
        slack_user_id=None,
    )
    await db_session.commit_session(db)
    materialized = parse_materialize_workspace_result(
        await wait_for_command_result(worktree_command, timeout=SLACK_COMMAND_WAIT_TIMEOUT),
    )
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
    )
    anyharness_workspace_id = (
        exposure.anyharness_workspace_id
        if exposure and exposure.anyharness_workspace_id
        else materialized.anyharness_workspace_id
    )
    return workspace, anyharness_workspace_id


async def start_session(
    db: AsyncSession,
    *,
    organization_id: UUID,
    target_id: UUID,
    cloud_workspace_id: UUID,
    anyharness_workspace_id: str,
    session_id: str,
    agent_kind: str,
    model_id: str | None,
    mode_id: str | None,
    slack_user_id: str | None,
    idempotency_key: str,
) -> str:
    command = await enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
        session_id=None,
        kind=CloudCommandKind.start_session.value,
        payload=StartSessionPayload(
            workspace_id=anyharness_workspace_id,
            agent_kind=agent_kind,
            model_id=model_id,
            mode_id=mode_id,
            origin={"kind": "system", "entrypoint": "cloud"},
        ).to_json(),
        idempotency_scope=f"slack-session:{session_id}",
        idempotency_key=idempotency_key,
        workspace_id=anyharness_workspace_id,
        slack_user_id=slack_user_id,
    )
    await db_session.commit_session(db)
    result = parse_start_session_result(
        await wait_for_command_result(command, timeout=SLACK_COMMAND_WAIT_TIMEOUT),
    )
    return result.session_id


async def enqueue_send_prompt(
    db: AsyncSession,
    *,
    organization_id: UUID,
    target_id: UUID,
    cloud_workspace_id: UUID,
    anyharness_workspace_id: str,
    session_id: str,
    prompt_text: str,
    prompt_id: str,
    slack_user_id: str | None,
    idempotency_key: str,
) -> commands_store.CloudCommandSnapshot:
    return await enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
        session_id=session_id,
        kind=CloudCommandKind.send_prompt.value,
        payload=SendPromptPayload(text=prompt_text, prompt_id=prompt_id).to_json(),
        idempotency_scope=f"slack-session:{session_id}",
        idempotency_key=idempotency_key,
        workspace_id=anyharness_workspace_id,
        slack_user_id=slack_user_id,
    )


async def apply_run_config_updates(
    db: AsyncSession,
    *,
    organization_id: UUID,
    target_id: UUID,
    cloud_workspace_id: UUID,
    anyharness_workspace_id: str,
    session_id: str,
    run_snapshot: dict[str, object],
    slack_user_id: str | None,
    idempotency_key_prefix: str,
) -> None:
    for control_key, value in snapshot_session_config_updates(run_snapshot):
        command = await enqueue_command(
            db,
            organization_id=organization_id,
            target_id=target_id,
            cloud_workspace_id=cloud_workspace_id,
            session_id=session_id,
            kind=CloudCommandKind.update_session_config.value,
            payload={"normalizedControl": control_key, "value": value},
            idempotency_scope=f"slack-session:{session_id}",
            idempotency_key=f"{idempotency_key_prefix}:config:{control_key}",
            workspace_id=anyharness_workspace_id,
            slack_user_id=slack_user_id,
        )
        await db_session.commit_session(db)
        result = await wait_for_command_result(command, timeout=SLACK_COMMAND_WAIT_TIMEOUT)
        if _config_apply_state(result.body) != "applied":
            raise CloudApiError(
                "slack_agent_config_apply_failed",
                "Slack could not apply the selected agent configuration.",
                status_code=502,
            )


async def enqueue_command(
    db: AsyncSession,
    *,
    organization_id: UUID,
    target_id: UUID,
    cloud_workspace_id: UUID | None,
    session_id: str | None,
    kind: str,
    payload: dict[str, object],
    idempotency_scope: str,
    idempotency_key: str,
    slack_user_id: str | None,
    workspace_id: str | None = None,
) -> commands_store.CloudCommandSnapshot:
    target = await target_store.get_target_by_id(db, target_id)
    if target is None:
        raise CloudApiError("cloud_target_not_found", "Cloud target not found.", status_code=404)
    payload = await stamp_and_validate_command_preflight(
        db,
        actor_user_id=SYSTEM_SLACK_USER_UUID,
        target_id=target_id,
        kind=kind,
        payload=payload,
    )
    existing = await commands_store.get_command_by_idempotency(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
    )
    if existing is not None:
        await kick_off_command_wake_after_commit_if_required(db, target=target, command=existing)
        return existing
    command = await commands_store.create_command(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
        target_id=target_id,
        organization_id=organization_id,
        actor_user_id=None,
        actor_kind=CloudCommandActorKind.slack.value,
        source=CloudCommandSource.slack.value,
        workspace_id=workspace_id,
        session_id=session_id,
        cloud_workspace_id=cloud_workspace_id,
        kind=kind,
        payload_json=compact_command_json(payload) or "{}",
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=compact_command_json(
            {
                "slackUserId": slack_user_id,
                "organizationId": str(organization_id),
                "cloudWorkspaceId": str(cloud_workspace_id) if cloud_workspace_id else None,
            }
        ),
    )
    await kick_off_command_wake_after_commit_if_required(db, target=target, command=command)
    return command


def snapshot_control(snapshot: dict[str, object], key: str) -> str | None:
    controls = snapshot.get("control_values")
    if not isinstance(controls, dict):
        return None
    return _string_or_none(controls.get(key))


def snapshot_session_config_updates(snapshot: dict[str, object]) -> list[tuple[str, str]]:
    controls = snapshot.get("control_values")
    if not isinstance(controls, dict):
        return []
    updates: list[tuple[str, str]] = []
    for key in sorted(controls):
        if key in {"mode", "model"}:
            continue
        value = controls.get(key)
        if isinstance(value, str) and value.strip():
            updates.append((key, value))
    return updates


def _slack_branch_name(*, prompt: str, job_id: UUID) -> str:
    config = default_cloud_executor_config()
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", prompt.lower()).strip("-._")[
        : config.max_branch_slug_chars
    ]
    slug = slug or "slack"
    return f"{config.branch_prefix}/{slug}-{job_id.hex[:12]}"


def _workspace_paths(
    *,
    repo: repo_store.CloudRepoConfigValue,
    branch_name: str,
    workspace_root: str | None,
) -> tuple[str, str]:
    owner = repo.git_owner.strip().replace("/", "-")
    name = repo.git_repo_name.strip().replace("/", "-")
    root = (workspace_root or "/workspace").rstrip("/") or "/workspace"
    repo_root_path = f"{root}/repos/{owner}/{name}"
    worktree_path = f"{root}/worktrees/{owner}/{name}/{branch_name.replace('/', '-')}"
    return repo_root_path, worktree_path


def _config_apply_state(body: dict[str, object]) -> str | None:
    value = body.get("applyState")
    return value if isinstance(value, str) and value.strip() else None


def _string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
