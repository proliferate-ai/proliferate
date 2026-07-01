from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.cloud import (
    SUPPORTED_GIT_PROVIDER,
    CloudCommandKind,
    CloudCommandStatus,
    CloudTargetKind,
    CloudTargetStatus,
)
from proliferate.db import session_ops as db_session
from proliferate.db.store import billing_subjects as billing_subject_store
from proliferate.db.store.cloud_sync import commands as command_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_workspace_creation import (
    CloudWorkspaceUniqueConflictError,
    create_direct_target_cloud_workspace,
)
from proliferate.db.store.cloud_workspace_runtime import mark_workspace_error_by_id
from proliferate.db.store.cloud_workspaces import (
    get_cloud_workspace_by_id,
    get_existing_cloud_workspace,
    list_active_cloud_workspace_branches_for_user_repo,
)
from proliferate.db.store.repositories import get_cloud_repo_environment
from proliferate.lib.product.workspace_naming import resolve_generated_branch_name
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
    AutomationCommandResult,
    wait_for_command_result,
)
from proliferate.server.cloud.agent_auth.domain.status import allowed_agent_kinds
from proliferate.server.cloud.commands.client_state import (
    mark_pending_prompt_interaction_failed_for_command,
)
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.commands.service import enqueue_command
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.repos.service import (
    get_linked_github_account,
)
from proliferate.server.cloud.repos.service import (
    get_repo_branches_for_user as get_github_repo_branches,
)
from proliferate.server.cloud.workspaces.details import build_workspace_detail_for_request
from proliferate.server.cloud.workspaces.target_launch.models import (
    LaunchWorkspaceOnTargetRequest,
    WorkspaceTargetLaunchCommandIds,
    WorkspaceTargetLaunchResponse,
)
from proliferate.utils.time import utcnow

CLOUD_TARGET_LAUNCH_TEMPLATE_VERSION = "desktop-target-launch-v1"
TARGET_LAUNCH_COMMAND_WAIT_TIMEOUT = timedelta(seconds=240)
GENERATED_TARGET_LAUNCH_CREATE_MAX_ATTEMPTS = 5


@dataclass(frozen=True)
class ResolvedDirectTargetWorkspaceCreate:
    git_provider: str
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str
    display_name: str | None
    active_sandbox_count: int
    selected_agent_kinds: tuple[str, ...]
    cloud_repo_limit: int | None


def _target_launch_create_attempts(generated_name: bool) -> int:
    return GENERATED_TARGET_LAUNCH_CREATE_MAX_ATTEMPTS if generated_name else 1


def _should_retry_target_launch_create(generated_name: bool, attempt: int) -> bool:
    return generated_name and attempt + 1 < GENERATED_TARGET_LAUNCH_CREATE_MAX_ATTEMPTS


async def launch_workspace_on_target(
    db: AsyncSession,
    user: ActorIdentity,
    body: LaunchWorkspaceOnTargetRequest,
) -> WorkspaceTargetLaunchResponse:
    prompt_text = body.prompt.strip()
    if not prompt_text:
        raise CloudApiError(
            "target_launch_prompt_required",
            "Enter a prompt before launching desktop dispatch.",
            status_code=400,
        )
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=body.target_id,
        user_id=user.id,
    )
    if target is None:
        raise CloudApiError(
            "target_launch_target_not_found",
            "Target not found.",
            status_code=404,
        )
    if target.owner_scope != "personal" or target.owner_user_id != user.id:
        raise CloudApiError(
            "target_launch_target_not_personal",
            "Launching on a desktop target requires a personal target.",
            status_code=409,
        )
    if target.kind not in {
        CloudTargetKind.desktop_dispatch.value,
        CloudTargetKind.ssh.value,
        CloudTargetKind.self_hosted_cloud.value,
    }:
        raise CloudApiError(
            "target_launch_target_kind_unsupported",
            "This target cannot launch new workspaces.",
            status_code=409,
        )
    if target.status != CloudTargetStatus.online.value:
        raise CloudApiError(
            "target_launch_target_offline",
            "Desktop dispatch requires the target worker to be online.",
            status_code=409,
        )

    generated_branch_conflicts: set[str] = set()
    for attempt in range(_target_launch_create_attempts(body.generated_name is True)):
        resolved = await _resolve_new_direct_target_workspace_create(
            db,
            user=user,
            body=body,
            generated_branch_conflicts=generated_branch_conflicts,
        )
        repo_root_path, worktree_path = _direct_target_workspace_paths(
            git_owner=resolved.git_owner,
            git_repo_name=resolved.git_repo_name,
            branch_name=resolved.git_branch,
            target_kind=target.kind,
            workspace_root=target.default_workspace_root,
        )
        billing_subject = await billing_subject_store.ensure_personal_billing_subject(db, user.id)
        try:
            workspace = await create_direct_target_cloud_workspace(
                db,
                target_id=target.id,
                user_id=user.id,
                billing_subject_id=billing_subject.id,
                created_by_user_id=user.id,
                display_name=resolved.display_name,
                git_provider=resolved.git_provider,
                git_owner=resolved.git_owner,
                git_repo_name=resolved.git_repo_name,
                git_branch=resolved.git_branch,
                git_base_branch=resolved.git_base_branch,
                worktree_path=worktree_path,
                origin_json=json.dumps(
                    {
                        "kind": "human",
                        "entrypoint": body.source,
                        "targetId": str(target.id),
                        "agentKind": body.agent_kind,
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                template_version=CLOUD_TARGET_LAUNCH_TEMPLATE_VERSION,
                origin="manual_mobile" if body.source == "mobile" else "manual_web",
            )
            workspace_id = workspace.id
            await db_session.commit_session(db)
            break
        except CloudWorkspaceUniqueConflictError as error:
            await db.rollback()
            if _should_retry_target_launch_create(body.generated_name is True, attempt):
                generated_branch_conflicts.add(resolved.git_branch)
                log_cloud_event(
                    "generated target launch workspace branch collided; retrying",
                    user_id=user.id,
                    target_id=target.id,
                    repo=f"{body.git_owner}/{body.git_repo_name}",
                    branch_name=resolved.git_branch,
                    attempt=attempt + 1,
                )
                continue
            raise CloudApiError(
                "cloud_branch_already_exists",
                (
                    f"A cloud workspace already exists for branch '{resolved.git_branch}'. "
                    "Open the existing workspace or choose a different branch."
                ),
                status_code=400,
            ) from error

    try:
        checkout = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=workspace_id,
            kind=CloudCommandKind.ensure_repo_checkout.value,
            payload=EnsureRepoCheckoutPayload(
                provider=resolved.git_provider,
                owner=resolved.git_owner,
                name=resolved.git_repo_name,
                path=repo_root_path,
                base_branch=resolved.git_base_branch,
            ).to_json(),
            idempotency_key=f"target-launch:{workspace_id}:checkout",
            source=body.source,
        )
        await _wait_for_target_launch_command(checkout, workspace_id=workspace_id)

        root_command = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=None,
            kind=CloudCommandKind.materialize_workspace.value,
            payload=MaterializeWorkspacePayload(
                mode="existing_path",
                path=repo_root_path,
                display_name=f"{resolved.git_owner}/{resolved.git_repo_name}",
                origin={"kind": "system", "entrypoint": "cloud"},
                creator_context={"kind": "human", "label": "Mobile"},
            ).to_json(),
            idempotency_key=f"target-launch:{workspace_id}:materialize-root",
            source=body.source,
        )
        root_result = parse_materialize_workspace_result(
            await _wait_for_target_launch_command(root_command, workspace_id=workspace_id),
        )

        worktree_command = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=workspace_id,
            kind=CloudCommandKind.materialize_workspace.value,
            payload=MaterializeWorkspacePayload(
                mode="worktree",
                repo_root_id=root_result.repo_root_id,
                target_path=worktree_path,
                new_branch_name=resolved.git_branch,
                base_branch=resolved.git_base_branch,
                name_conflict_policy="suffix_path",
                origin={"kind": "system", "entrypoint": "cloud"},
                creator_context={"kind": "human", "label": "Mobile"},
            ).to_json(),
            idempotency_key=f"target-launch:{workspace_id}:materialize-worktree",
            source=body.source,
        )
        materialized = parse_materialize_workspace_result(
            await _wait_for_target_launch_command(worktree_command, workspace_id=workspace_id),
        )
        if materialized.path != worktree_path:
            workspace.worktree_path = materialized.path
            workspace.updated_at = utcnow()
            await db_session.commit_session(db)

        start_payload = StartSessionPayload(
            workspace_id=materialized.anyharness_workspace_id,
            agent_kind=body.agent_kind,
            model_id=body.model_id,
            mode_id=body.mode_id,
            origin={"kind": "system", "entrypoint": "cloud"},
        ).to_json()
        start_payload["subagentsEnabled"] = False
        start_command = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=workspace_id,
            kind=CloudCommandKind.start_session.value,
            payload=start_payload,
            idempotency_key=f"target-launch:{workspace_id}:start-session",
            source=body.source,
        )
        started = parse_start_session_result(
            await _wait_for_target_launch_command(start_command, workspace_id=workspace_id),
        )

        config_command_ids: list[str] = []
        for update in body.session_config_updates:
            config_command = await _enqueue_target_launch_command(
                db,
                user=user,
                target_id=target.id,
                cloud_workspace_id=workspace_id,
                session_id=started.session_id,
                kind=CloudCommandKind.update_session_config.value,
                payload={"configId": update.config_id, "value": update.value},
                idempotency_key=(
                    f"target-launch:{workspace_id}:config:{update.config_id}:{update.value}"
                ),
                source=body.source,
            )
            config_command_ids.append(str(config_command.id))
            await _wait_for_target_launch_command(
                config_command,
                workspace_id=workspace_id,
            )

        prompt_id = body.prompt_id or f"target-launch:{workspace_id}:prompt:{uuid4().hex}"
        send_command = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=workspace_id,
            session_id=started.session_id,
            kind=CloudCommandKind.send_prompt.value,
            payload=SendPromptPayload(text=prompt_text, prompt_id=prompt_id).to_json(),
            idempotency_key=f"target-launch:{workspace_id}:send-prompt:{prompt_id}",
            source=body.source,
        )
        await _wait_for_target_launch_command(send_command, workspace_id=workspace_id)
    except CloudApiError as exc:
        message = format_exception_message(exc) or exc.message
        await _mark_workspace_error_tx(
            workspace_id, message, status_detail="Desktop dispatch failed"
        )
        raise
    except (RuntimeError, TimeoutError, ValueError) as exc:
        message = format_exception_message(exc) or str(exc)
        await _mark_workspace_error_tx(
            workspace_id, message, status_detail="Desktop dispatch failed"
        )
        raise CloudApiError(
            "target_launch_failed",
            message or "Desktop dispatch failed before the prompt could be sent.",
            status_code=502,
        ) from exc

    db.expire_all()
    refreshed = await get_cloud_workspace_by_id(db, workspace_id)
    if refreshed is None:
        raise CloudApiError(
            "target_launch_workspace_missing",
            "Launched workspace could not be loaded.",
            status_code=500,
        )
    return WorkspaceTargetLaunchResponse(
        workspace=await build_workspace_detail_for_request(db, refreshed),
        session_id=started.session_id,
        send_command_id=str(send_command.id),
        command_ids=WorkspaceTargetLaunchCommandIds(
            ensure_repo_checkout=str(checkout.id),
            materialize_root=str(root_command.id),
            materialize_worktree=str(worktree_command.id),
            start_session=str(start_command.id),
            send_prompt=str(send_command.id),
            update_session_config=config_command_ids,
        ),
    )


async def _resolve_new_direct_target_workspace_create(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    body: LaunchWorkspaceOnTargetRequest,
    generated_branch_conflicts: set[str] | None = None,
) -> ResolvedDirectTargetWorkspaceCreate:
    if body.git_provider != SUPPORTED_GIT_PROVIDER:
        raise CloudApiError(
            "unsupported_repo_provider",
            "Only GitHub repositories are supported for desktop dispatch.",
            status_code=400,
        )
    if get_linked_github_account(user) is None:
        raise CloudApiError(
            "github_link_required",
            "Connect a GitHub account before launching desktop dispatch.",
            status_code=400,
        )
    cleaned_branch_name = body.branch_name.strip()
    if not cleaned_branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Choose a new branch before launching desktop dispatch.",
            status_code=400,
        )
    if body.agent_kind not in allowed_agent_kinds():
        raise CloudApiError(
            "unsupported_agent_kind",
            "The selected agent is not supported for desktop dispatch.",
            status_code=400,
        )

    repo_environment = await get_cloud_repo_environment(
        db,
        user_id=user.id,
        git_owner=body.git_owner,
        git_repo_name=body.git_repo_name,
    )
    if repo_environment is None:
        raise CloudApiError(
            "cloud_repo_not_configured",
            "Configure cloud settings for this repo before launching desktop dispatch.",
            status_code=409,
        )

    repo_branches = await get_github_repo_branches(
        user,
        git_owner=body.git_owner,
        git_repo_name=body.git_repo_name,
        missing_access_message="Connect a GitHub account before launching desktop dispatch.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before launching desktop dispatch."
        ),
    )
    cleaned_base_branch = body.base_branch.strip() if body.base_branch else ""
    resolved_base_branch = cleaned_base_branch or (repo_environment.default_branch or "").strip()
    if not resolved_base_branch:
        resolved_base_branch = repo_branches.default_branch.strip()
    if resolved_base_branch not in repo_branches.branches:
        raise CloudApiError(
            "github_branch_not_found",
            f"The base branch '{resolved_base_branch}' was not found on GitHub.",
            status_code=400,
        )
    active_cloud_branches = await list_active_cloud_workspace_branches_for_user_repo(
        db,
        user_id=user.id,
        git_provider=body.git_provider,
        git_owner=body.git_owner,
        git_repo_name=body.git_repo_name,
    )
    existing_cloud_workspace = await get_existing_cloud_workspace(
        db,
        user_id=user.id,
        git_provider=body.git_provider,
        git_owner=body.git_owner,
        git_repo_name=body.git_repo_name,
        git_branch=cleaned_branch_name,
    )
    if body.generated_name is True:
        cleaned_branch_name = resolve_generated_branch_name(
            cleaned_branch_name,
            set(repo_branches.branches)
            | active_cloud_branches
            | (generated_branch_conflicts or set()),
        )
    elif cleaned_branch_name in repo_branches.branches:
        raise CloudApiError(
            "github_branch_already_exists",
            f"The branch '{cleaned_branch_name}' already exists on GitHub.",
            status_code=400,
        )
    elif existing_cloud_workspace is not None:
        raise CloudApiError(
            "cloud_branch_already_exists",
            (
                f"A cloud workspace already exists for branch '{cleaned_branch_name}'. "
                "Open the existing workspace or choose a different branch."
            ),
            status_code=400,
        )
    return ResolvedDirectTargetWorkspaceCreate(
        git_provider=body.git_provider,
        git_owner=body.git_owner,
        git_repo_name=body.git_repo_name,
        git_branch=cleaned_branch_name,
        git_base_branch=resolved_base_branch,
        display_name=(
            body.display_name.strip() if body.display_name and body.display_name.strip() else None
        ),
        active_sandbox_count=0,
        selected_agent_kinds=(body.agent_kind,),
        cloud_repo_limit=None,
    )


def _direct_target_workspace_paths(
    *,
    git_owner: str,
    git_repo_name: str,
    branch_name: str,
    target_kind: str,
    workspace_root: str | None,
) -> tuple[str, str]:
    default_root = (
        "~/Proliferate/workspaces"
        if target_kind == CloudTargetKind.desktop_dispatch.value
        else "~/proliferate-workspaces"
    )
    root = (workspace_root or default_root).rstrip("/") or default_root
    owner = git_owner.strip().replace("/", "-")
    name = git_repo_name.strip().replace("/", "-")
    branch_segment = branch_name.strip().replace("/", "-")
    return (
        f"{root}/repos/{owner}/{name}",
        f"{root}/worktrees/{owner}/{name}/{branch_segment}",
    )


async def _enqueue_target_launch_command(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    target_id: UUID,
    cloud_workspace_id: UUID | None,
    kind: str,
    payload: dict[str, object],
    idempotency_key: str,
    source: str,
    session_id: str | None = None,
) -> command_store.CloudCommandSnapshot:
    command = await enqueue_command(
        db,
        user=user,
        body=CreateCloudCommandRequest.model_validate(
            {
                "idempotencyKey": idempotency_key,
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": session_id,
                "kind": kind,
                "payload": payload,
                "source": source,
            }
        ),
    )
    await db_session.commit_session(db)
    return command


async def _wait_for_target_launch_command(
    command: command_store.CloudCommandSnapshot,
    *,
    workspace_id: UUID,
) -> AutomationCommandResult:
    del workspace_id
    try:
        return await wait_for_command_result(
            command,
            timeout=TARGET_LAUNCH_COMMAND_WAIT_TIMEOUT,
        )
    except (RuntimeError, TimeoutError):
        await _mark_target_launch_command_failed_interaction_if_needed(command.id)
        raise


async def _mark_target_launch_command_failed_interaction_if_needed(
    command_id: UUID,
) -> None:
    async with db_session.open_async_session() as fresh_db:
        latest = await command_store.get_command_by_id(fresh_db, command_id)
        if latest is None:
            return
        if latest.status not in {
            CloudCommandStatus.rejected.value,
            CloudCommandStatus.failed_delivery.value,
            CloudCommandStatus.expired.value,
            CloudCommandStatus.superseded.value,
        }:
            return
        await mark_pending_prompt_interaction_failed_for_command(fresh_db, latest)
        await publish_command_status_after_commit(fresh_db, latest)
        await db_session.commit_session(fresh_db)


async def _mark_workspace_error_tx(workspace_id: UUID, message: str, **kwargs: object) -> None:
    async with db_session.open_async_transaction() as db:
        await mark_workspace_error_by_id(db, workspace_id, message, **kwargs)
