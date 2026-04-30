"""Executor claim persistence for automation runs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID, uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.automations import AutomationRun
from proliferate.db.models.cloud import CloudWorkspace
from proliferate.db.store.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
    AUTOMATION_RUN_STATUS_CANCELLED,
    AUTOMATION_RUN_STATUS_CLAIMED,
    AUTOMATION_RUN_STATUS_CREATING_SESSION,
    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
    AUTOMATION_RUN_STATUS_DISPATCHED,
    AUTOMATION_RUN_STATUS_DISPATCHING,
    AUTOMATION_RUN_STATUS_FAILED,
    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
    AUTOMATION_RUN_STATUS_QUEUED,
)
from proliferate.db.store.cloud_workspaces import create_cloud_workspace_record

AUTOMATION_ERROR_DISPATCH_UNCERTAIN: Final = "dispatch_uncertain"
AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE: Final = (
    "Prompt delivery could not be confirmed after the executor stopped responding."
)
AUTOMATION_ERROR_AGENT_NOT_CONFIGURED: Final = "agent_not_configured"
AUTOMATION_ERROR_AGENT_NOT_CONFIGURED_MESSAGE: Final = (
    "Choose an agent before this cloud automation can run."
)
AUTOMATION_ERROR_MESSAGES: Final = {
    AUTOMATION_ERROR_AGENT_NOT_CONFIGURED: AUTOMATION_ERROR_AGENT_NOT_CONFIGURED_MESSAGE,
    "agent_not_ready": "The requested cloud agent is not ready in the runtime.",
    "user_not_found": "The automation owner is no longer available.",
    "workspace_missing": "The cloud workspace for this run could not be found.",
    "workspace_create_stale_claim": "The executor lost its claim while creating the workspace.",
    "workspace_provision_failed": "Cloud workspace provisioning failed.",
    "runtime_not_ready": "The cloud runtime was not ready.",
    "session_create_failed": "The cloud runtime could not create a session.",
    "prompt_send_failed": "The cloud runtime could not accept the automation prompt.",
    "stale_claim": "The executor lost its claim before the run was dispatched.",
    "unexpected_executor_error": "The cloud executor hit an unexpected error before dispatch.",
    "workspace_ownership_mismatch": "The cloud workspace for this run is invalid.",
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN: AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE,
}
AUTOMATION_ERROR_DEFAULT_MESSAGE: Final = "The cloud executor could not dispatch this run."


def automation_error_message(code: str) -> str:
    return AUTOMATION_ERROR_MESSAGES.get(code, AUTOMATION_ERROR_DEFAULT_MESSAGE)


_RECLAIMABLE_STATUSES: Final = frozenset(
    {
        AUTOMATION_RUN_STATUS_CLAIMED,
        AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
        AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
        AUTOMATION_RUN_STATUS_CREATING_SESSION,
    }
)
_TERMINAL_STATUSES: Final = frozenset(
    {
        AUTOMATION_RUN_STATUS_DISPATCHED,
        AUTOMATION_RUN_STATUS_FAILED,
        AUTOMATION_RUN_STATUS_CANCELLED,
    }
)


@dataclass(frozen=True)
class AutomationRunClaimValue:
    id: UUID
    automation_id: UUID
    user_id: UUID
    status: str
    title: str
    prompt: str
    git_provider: str
    git_owner: str
    git_repo_name: str
    agent_kind: str | None
    model_id: str | None
    mode_id: str | None
    reasoning_effort: str | None
    executor_id: str
    claim_id: UUID
    claim_expires_at: datetime
    cloud_workspace_id: UUID | None
    anyharness_workspace_id: str | None
    anyharness_session_id: str | None


def _claim_value(run: AutomationRun) -> AutomationRunClaimValue:
    if run.executor_id is None or run.claim_id is None or run.claim_expires_at is None:
        raise RuntimeError("Automation run claim was loaded without active claim metadata.")
    return AutomationRunClaimValue(
        id=run.id,
        automation_id=run.automation_id,
        user_id=run.user_id,
        status=run.status,
        title=run.title_snapshot,
        prompt=run.prompt_snapshot,
        git_provider=run.git_provider_snapshot,
        git_owner=run.git_owner_snapshot,
        git_repo_name=run.git_repo_name_snapshot,
        agent_kind=run.agent_kind_snapshot,
        model_id=run.model_id_snapshot,
        mode_id=run.mode_id_snapshot,
        reasoning_effort=run.reasoning_effort_snapshot,
        executor_id=run.executor_id,
        claim_id=run.claim_id,
        claim_expires_at=run.claim_expires_at,
        cloud_workspace_id=run.cloud_workspace_id,
        anyharness_workspace_id=run.anyharness_workspace_id,
        anyharness_session_id=run.anyharness_session_id,
    )


def _claim_is_active(run: AutomationRun, now: datetime) -> bool:
    return run.claim_expires_at is not None and run.claim_expires_at > now


async def _load_claimed_run_for_update(
    db: AsyncSession,
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
    allowed_statuses: frozenset[str],
    lock: bool = True,
) -> AutomationRun | None:
    query = select(AutomationRun).where(
        AutomationRun.id == run_id,
        AutomationRun.claim_id == claim_id,
        AutomationRun.execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD,
        AutomationRun.status.in_(allowed_statuses),
    )
    if lock:
        query = query.with_for_update()
    run = (await db.execute(query)).scalar_one_or_none()
    if run is None or not _claim_is_active(run, now):
        return None
    return run


def _clear_claim(run: AutomationRun) -> None:
    run.executor_kind = None
    run.executor_id = None
    run.claim_id = None
    run.claim_expires_at = None


async def claim_cloud_automation_runs(
    *,
    executor_id: str,
    claim_ttl: timedelta,
    limit: int,
    now: datetime,
) -> list[AutomationRunClaimValue]:
    async with db_engine.async_session_factory() as db:
        rows = list(
            (
                await db.execute(
                    select(AutomationRun)
                    .where(
                        AutomationRun.execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD,
                        or_(
                            AutomationRun.status == AUTOMATION_RUN_STATUS_QUEUED,
                            (
                                AutomationRun.status.in_(_RECLAIMABLE_STATUSES)
                                & (AutomationRun.claim_expires_at.is_not(None))
                                & (AutomationRun.claim_expires_at <= now)
                            ),
                        ),
                    )
                    .order_by(AutomationRun.created_at.asc(), AutomationRun.id.asc())
                    .limit(max(1, limit))
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        expires_at = now + claim_ttl
        values: list[AutomationRunClaimValue] = []
        for run in rows:
            if run.agent_kind_snapshot is None:
                run.status = AUTOMATION_RUN_STATUS_FAILED
                run.failed_at = now
                run.last_error_code = AUTOMATION_ERROR_AGENT_NOT_CONFIGURED
                run.last_error_message = AUTOMATION_ERROR_AGENT_NOT_CONFIGURED_MESSAGE
                _clear_claim(run)
                run.updated_at = now
                continue
            run.status = AUTOMATION_RUN_STATUS_CLAIMED
            run.executor_kind = AUTOMATION_EXECUTOR_KIND_CLOUD
            run.executor_id = executor_id
            run.claim_id = uuid4()
            run.claimed_at = now
            run.claim_expires_at = expires_at
            run.last_heartbeat_at = now
            run.failed_at = None
            run.last_error_code = None
            run.last_error_message = None
            run.updated_at = now
            values.append(_claim_value(run))
        await db.commit()
        return values


async def load_current_run_claim(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
) -> AutomationRunClaimValue | None:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CLAIMED,
                    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_CREATING_SESSION,
                    AUTOMATION_RUN_STATUS_DISPATCHING,
                }
            ),
            lock=False,
        )
        if run is None:
            return None
        return _claim_value(run)


async def heartbeat_run_claim(
    *,
    run_id: UUID,
    claim_id: UUID,
    claim_ttl: timedelta,
    now: datetime,
) -> AutomationRunClaimValue | None:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CLAIMED,
                    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_CREATING_SESSION,
                    AUTOMATION_RUN_STATUS_DISPATCHING,
                }
            ),
        )
        if run is None:
            return None
        run.claim_expires_at = now + claim_ttl
        run.last_heartbeat_at = now
        run.updated_at = now
        await db.commit()
        return _claim_value(run)


async def mark_run_creating_workspace(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
) -> AutomationRunClaimValue | None:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CLAIMED}),
        )
        if run is None:
            return None
        run.status = AUTOMATION_RUN_STATUS_CREATING_WORKSPACE
        run.updated_at = now
        await db.commit()
        return _claim_value(run)


async def create_cloud_workspace_for_claimed_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    user_id: UUID,
    display_name: str | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    git_base_branch: str,
    origin_json: str | None,
    template_version: str,
    now: datetime,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CREATING_WORKSPACE}),
        )
        if run is None or run.user_id != user_id:
            return None
        if run.cloud_workspace_id is not None:
            return None
        workspace = await create_cloud_workspace_record(
            db,
            user_id=user_id,
            display_name=display_name,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=git_branch,
            git_base_branch=git_base_branch,
            origin_json=origin_json,
            template_version=template_version,
            commit=False,
        )
        run.cloud_workspace_id = workspace.id
        run.updated_at = now
        await db.commit()
        await db.refresh(workspace)
        return workspace


async def attach_cloud_workspace_to_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    cloud_workspace_id: UUID,
    now: datetime,
) -> bool:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CLAIMED,
                    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                }
            ),
        )
        if run is None:
            return False
        run.cloud_workspace_id = cloud_workspace_id
        run.updated_at = now
        await db.commit()
        return True


async def mark_run_provisioning_workspace(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
) -> AutomationRunClaimValue | None:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                }
            ),
        )
        if run is None or run.cloud_workspace_id is None:
            return None
        run.status = AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE
        run.updated_at = now
        await db.commit()
        return _claim_value(run)


async def mark_run_creating_session(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    now: datetime,
) -> AutomationRunClaimValue | None:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CLAIMED,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_CREATING_SESSION,
                }
            ),
        )
        if run is None:
            return None
        run.status = AUTOMATION_RUN_STATUS_CREATING_SESSION
        run.anyharness_workspace_id = anyharness_workspace_id
        run.updated_at = now
        await db.commit()
        return _claim_value(run)


async def attach_anyharness_session_to_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    anyharness_session_id: str,
    now: datetime,
) -> bool:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CREATING_SESSION}),
        )
        if run is None:
            return False
        run.anyharness_workspace_id = anyharness_workspace_id
        run.anyharness_session_id = anyharness_session_id
        run.updated_at = now
        await db.commit()
        return True


async def mark_run_dispatching(
    *,
    run_id: UUID,
    claim_id: UUID,
    now: datetime,
) -> AutomationRunClaimValue | None:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CREATING_SESSION}),
        )
        if run is None or run.anyharness_session_id is None or run.anyharness_workspace_id is None:
            return None
        run.status = AUTOMATION_RUN_STATUS_DISPATCHING
        run.dispatch_started_at = now
        run.updated_at = now
        await db.commit()
        return _claim_value(run)


async def mark_run_dispatched(
    *,
    run_id: UUID,
    claim_id: UUID,
    anyharness_workspace_id: str,
    anyharness_session_id: str,
    now: datetime,
) -> bool:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_DISPATCHING}),
        )
        if run is None:
            return False
        run.status = AUTOMATION_RUN_STATUS_DISPATCHED
        run.dispatched_at = now
        run.anyharness_workspace_id = anyharness_workspace_id
        run.anyharness_session_id = anyharness_session_id
        _clear_claim(run)
        run.updated_at = now
        await db.commit()
        return True


async def mark_run_failed(
    *,
    run_id: UUID,
    claim_id: UUID,
    error_code: str,
    message: str,
    now: datetime,
) -> bool:
    async with db_engine.async_session_factory() as db:
        run = await _load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset(
                {
                    AUTOMATION_RUN_STATUS_CLAIMED,
                    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
                    AUTOMATION_RUN_STATUS_CREATING_SESSION,
                    AUTOMATION_RUN_STATUS_DISPATCHING,
                }
            ),
        )
        if run is None:
            return False
        run.status = AUTOMATION_RUN_STATUS_FAILED
        run.failed_at = now
        run.last_error_code = error_code
        run.last_error_message = message
        _clear_claim(run)
        run.updated_at = now
        await db.commit()
        return True


async def sweep_expired_dispatching_runs(*, now: datetime, limit: int = 100) -> int:
    if limit <= 0:
        return 0
    async with db_engine.async_session_factory() as db:
        runs = list(
            (
                await db.execute(
                    select(AutomationRun)
                    .where(
                        AutomationRun.execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD,
                        AutomationRun.status == AUTOMATION_RUN_STATUS_DISPATCHING,
                        AutomationRun.claim_expires_at.is_not(None),
                        AutomationRun.claim_expires_at <= now,
                    )
                    .order_by(AutomationRun.claim_expires_at.asc(), AutomationRun.id.asc())
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for run in runs:
            run.status = AUTOMATION_RUN_STATUS_FAILED
            run.failed_at = now
            run.last_error_code = AUTOMATION_ERROR_DISPATCH_UNCERTAIN
            run.last_error_message = AUTOMATION_ERROR_DISPATCH_UNCERTAIN_MESSAGE
            _clear_claim(run)
            run.updated_at = now
        await db.commit()
        return len(runs)


def is_terminal_status(status: str) -> bool:
    return status in _TERMINAL_STATUSES
