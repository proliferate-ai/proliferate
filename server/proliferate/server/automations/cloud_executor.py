"""Cloud automation executor."""

from __future__ import annotations

import asyncio
import logging
import re
import socket
import uuid
from dataclasses import dataclass
from datetime import timedelta

from proliferate.config import settings
from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS, CloudWorkspaceStatus
from proliferate.db.store.automation_run_claim_values import (
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
    AutomationRunClaimValue,
    automation_error_message,
)
from proliferate.db.store.automation_run_claims import (
    attach_anyharness_session_to_run,
    claim_cloud_automation_runs,
    heartbeat_run_claim,
    load_current_run_claim,
    mark_run_creating_session,
    mark_run_creating_workspace,
    mark_run_dispatched,
    mark_run_dispatching,
    mark_run_failed,
    mark_run_provisioning_workspace,
)
from proliferate.db.store.cloud_workspaces import load_cloud_workspace_by_id
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.anyharness_api import CloudRuntimeReconnectError
from proliferate.server.cloud.runtime.models import RuntimeConnectionTarget
from proliferate.server.cloud.runtime.service import get_workspace_connection, provision_workspace
from proliferate.server.cloud.runtime.session_api import (
    CloudRuntimePromptDeliveryUncertainError,
    CloudRuntimeRequestRejectedError,
    close_runtime_session,
    create_runtime_session,
    prompt_runtime_session,
)
from proliferate.server.cloud.workspaces.service import create_cloud_workspace_for_automation_run
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CloudExecutorConfig:
    executor_id: str
    claim_ttl: timedelta
    heartbeat_interval_seconds: float
    concurrency: int
    poll_interval_seconds: float
    sweep_limit: int
    branch_prefix: str
    max_branch_slug_chars: int


@dataclass(frozen=True)
class CloudRunSessionContext:
    claim: AutomationRunClaimValue
    target: RuntimeConnectionTarget


def build_cloud_executor_id() -> str:
    return f"cloud:{socket.gethostname()}:{uuid.uuid4().hex[:12]}"


def build_cloud_executor_config(
    *,
    executor_id: str | None = None,
    claim_ttl_seconds: float | None = None,
    heartbeat_interval_seconds: float | None = None,
    concurrency: int | None = None,
    poll_interval_seconds: float | None = None,
    sweep_limit: int | None = None,
    branch_prefix: str | None = None,
    max_branch_slug_chars: int | None = None,
) -> CloudExecutorConfig:
    return CloudExecutorConfig(
        executor_id=executor_id or build_cloud_executor_id(),
        claim_ttl=timedelta(
            seconds=max(
                1.0,
                claim_ttl_seconds
                if claim_ttl_seconds is not None
                else settings.automation_cloud_executor_claim_ttl_seconds,
            )
        ),
        heartbeat_interval_seconds=max(
            1.0,
            heartbeat_interval_seconds
            if heartbeat_interval_seconds is not None
            else settings.automation_cloud_executor_heartbeat_seconds,
        ),
        concurrency=max(
            1,
            concurrency
            if concurrency is not None
            else settings.automation_cloud_executor_concurrency,
        ),
        poll_interval_seconds=max(
            1.0,
            poll_interval_seconds
            if poll_interval_seconds is not None
            else settings.automation_cloud_executor_poll_seconds,
        ),
        sweep_limit=max(
            1,
            sweep_limit
            if sweep_limit is not None
            else settings.automation_cloud_executor_sweep_limit,
        ),
        branch_prefix=(
            branch_prefix
            if branch_prefix is not None
            else settings.automation_cloud_executor_branch_prefix
        ).strip("/ ")
        or "automation",
        max_branch_slug_chars=max(
            8,
            max_branch_slug_chars
            if max_branch_slug_chars is not None
            else settings.automation_cloud_executor_branch_slug_chars,
        ),
    )


def default_cloud_executor_config() -> CloudExecutorConfig:
    return build_cloud_executor_config()


def _automation_branch_name(
    claim: AutomationRunClaimValue,
    *,
    config: CloudExecutorConfig,
) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", claim.title.lower()).strip("-._")
    if not slug:
        slug = "run"
    slug = slug[: config.max_branch_slug_chars].strip("-._") or "run"
    run_id_suffix = claim.id.hex[:12]
    return f"{config.branch_prefix}/{slug}-{run_id_suffix}"


async def _fail_claim(
    claim: AutomationRunClaimValue,
    *,
    code: str,
    message: str | None = None,
) -> None:
    failed = await mark_run_failed(
        run_id=claim.id,
        claim_id=claim.claim_id,
        error_code=code,
        message=(message or automation_error_message(code)),
        now=utcnow(),
    )
    if not failed:
        logger.info(
            "automation cloud executor failed to mark run failed run_id=%s error_code=%s",
            claim.id,
            code,
        )


async def _heartbeat_loop(
    claim: AutomationRunClaimValue,
    *,
    config: CloudExecutorConfig,
    stop_event: asyncio.Event,
    stale_claim_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=config.heartbeat_interval_seconds)
            break
        except TimeoutError:
            pass
        try:
            refreshed = await heartbeat_run_claim(
                run_id=claim.id,
                claim_id=claim.claim_id,
                claim_ttl=config.claim_ttl,
                now=utcnow(),
            )
        except Exception:
            logger.exception("automation cloud executor heartbeat failed run_id=%s", claim.id)
            continue
        if refreshed is None:
            stale_claim_event.set()
            logger.info("automation cloud executor claim lost run_id=%s", claim.id)
            return


async def _require_current_claim(claim: AutomationRunClaimValue) -> AutomationRunClaimValue | None:
    current = await load_current_run_claim(
        run_id=claim.id,
        claim_id=claim.claim_id,
        now=utcnow(),
    )
    if current is None:
        logger.info("automation cloud executor claim is no longer current run_id=%s", claim.id)
    return current


async def _create_or_load_workspace(
    claim: AutomationRunClaimValue,
    *,
    config: CloudExecutorConfig,
) -> AutomationRunClaimValue | None:
    current = await mark_run_creating_workspace(
        run_id=claim.id,
        claim_id=claim.claim_id,
        now=utcnow(),
    )
    if current is None:
        return None
    if current.cloud_workspace_id is not None:
        return current

    user = await load_user_with_oauth_accounts_by_id(current.user_id)
    if user is None:
        await _fail_claim(current, code="user_not_found")
        return None

    try:
        workspace = await create_cloud_workspace_for_automation_run(
            user,
            run_id=current.id,
            claim_id=current.claim_id,
            git_owner=current.git_owner,
            git_repo_name=current.git_repo_name,
            branch_name=_automation_branch_name(current, config=config),
            display_name=current.title,
            required_agent_kind=current.agent_kind or "",
        )
    except CloudApiError as exc:
        await _fail_claim(current, code=exc.code, message=exc.message)
        return None
    if workspace is None:
        await _fail_claim(current, code="workspace_create_stale_claim")
        return None
    return await _require_current_claim(current)


async def _provision_workspace_for_claim(
    claim: AutomationRunClaimValue,
) -> AutomationRunClaimValue | None:
    current = await mark_run_provisioning_workspace(
        run_id=claim.id,
        claim_id=claim.claim_id,
        now=utcnow(),
    )
    if current is None or current.cloud_workspace_id is None:
        return None
    workspace = await load_cloud_workspace_by_id(current.cloud_workspace_id)
    if (
        workspace is not None
        and workspace.status == CloudWorkspaceStatus.ready.value
        and workspace.anyharness_workspace_id
    ):
        return await _require_current_claim(current)
    try:
        await provision_workspace(current.cloud_workspace_id)
    except Exception:
        logger.exception(
            "automation cloud executor provisioning failed run_id=%s workspace_id=%s",
            current.id,
            current.cloud_workspace_id,
        )
        await _fail_claim(current, code="workspace_provision_failed")
        return None
    return await _require_current_claim(current)


async def _create_or_load_session(
    claim: AutomationRunClaimValue,
) -> CloudRunSessionContext | None:
    if claim.cloud_workspace_id is None:
        return None
    workspace = await load_cloud_workspace_by_id(claim.cloud_workspace_id)
    if workspace is None:
        await _fail_claim(claim, code="workspace_missing")
        return None
    if workspace.user_id != claim.user_id:
        logger.error(
            "automation cloud executor workspace ownership mismatch run_id=%s "
            "workspace_id=%s run_user_id=%s workspace_user_id=%s",
            claim.id,
            claim.cloud_workspace_id,
            claim.user_id,
            workspace.user_id,
        )
        await _fail_claim(claim, code="workspace_ownership_mismatch")
        return None

    try:
        target = await get_workspace_connection(workspace)
    except CloudApiError as exc:
        await _fail_claim(claim, code=exc.code, message=exc.message)
        return None
    except CloudRuntimeReconnectError:
        logger.exception("automation cloud executor runtime connection failed run_id=%s", claim.id)
        await _fail_claim(claim, code="runtime_not_ready")
        return None

    if claim.agent_kind not in target.ready_agent_kinds:
        await _fail_claim(claim, code="agent_not_ready")
        return None
    if target.anyharness_workspace_id is None:
        await _fail_claim(claim, code="runtime_not_ready")
        return None

    current = await mark_run_creating_session(
        run_id=claim.id,
        claim_id=claim.claim_id,
        anyharness_workspace_id=target.anyharness_workspace_id,
        now=utcnow(),
    )
    if current is None:
        return None
    if current.anyharness_session_id is not None:
        return CloudRunSessionContext(claim=current, target=target)

    try:
        session = await create_runtime_session(
            target.runtime_url,
            target.access_token,
            anyharness_workspace_id=target.anyharness_workspace_id,
            agent_kind=current.agent_kind or "",
            model_id=current.model_id,
            mode_id=current.mode_id,
        )
    except CloudRuntimeReconnectError:
        logger.exception("automation cloud executor session create failed run_id=%s", claim.id)
        await _fail_claim(current, code="session_create_failed")
        return None

    attached = await attach_anyharness_session_to_run(
        run_id=current.id,
        claim_id=current.claim_id,
        anyharness_workspace_id=target.anyharness_workspace_id,
        anyharness_session_id=session.session_id,
        now=utcnow(),
    )
    if not attached:
        try:
            await close_runtime_session(
                target.runtime_url,
                target.access_token,
                session_id=session.session_id,
            )
        except CloudRuntimeReconnectError:
            logger.warning(
                "automation cloud executor could not close orphan session run_id=%s session_id=%s",
                claim.id,
                session.session_id,
                exc_info=True,
            )
        return None
    refreshed = await _require_current_claim(current)
    if refreshed is None:
        return None
    return CloudRunSessionContext(claim=refreshed, target=target)


async def _send_prompt(context: CloudRunSessionContext) -> None:
    claim = context.claim
    target_workspace_id = context.target.anyharness_workspace_id
    if (
        claim.cloud_workspace_id is None
        or claim.anyharness_session_id is None
        or target_workspace_id is None
    ):
        await _fail_claim(claim, code="stale_claim")
        return

    dispatching = await mark_run_dispatching(
        run_id=claim.id,
        claim_id=claim.claim_id,
        now=utcnow(),
    )
    if dispatching is None:
        return
    session_id = dispatching.anyharness_session_id
    assert session_id is not None
    try:
        await prompt_runtime_session(
            context.target.runtime_url,
            context.target.access_token,
            session_id=session_id,
            prompt=claim.prompt,
        )
    except CloudRuntimePromptDeliveryUncertainError:
        logger.exception(
            "automation cloud executor prompt delivery uncertain run_id=%s",
            claim.id,
        )
        await _fail_claim(dispatching, code=AUTOMATION_ERROR_DISPATCH_UNCERTAIN)
        return
    except CloudRuntimeRequestRejectedError:
        logger.exception("automation cloud executor prompt rejected run_id=%s", claim.id)
        await _fail_claim(dispatching, code="prompt_send_failed")
        return
    except CloudRuntimeReconnectError:
        logger.exception("automation cloud executor prompt send failed run_id=%s", claim.id)
        await _fail_claim(dispatching, code="prompt_send_failed")
        return
    dispatched = await mark_run_dispatched(
        run_id=claim.id,
        claim_id=claim.claim_id,
        anyharness_workspace_id=target_workspace_id,
        anyharness_session_id=session_id,
        now=utcnow(),
    )
    if dispatched:
        logger.info("automation cloud executor dispatched run_id=%s", claim.id)
    else:
        logger.warning(
            "automation cloud executor could not mark prompt-accepted run dispatched run_id=%s",
            claim.id,
        )


async def process_cloud_automation_run(
    claim: AutomationRunClaimValue,
    *,
    config: CloudExecutorConfig,
) -> None:
    heartbeat_stop = asyncio.Event()
    stale_claim = asyncio.Event()
    heartbeat_task = asyncio.create_task(
        _heartbeat_loop(
            claim,
            config=config,
            stop_event=heartbeat_stop,
            stale_claim_event=stale_claim,
        ),
    )
    try:
        # Defense in depth; claim selection and write validation should already enforce these.
        if claim.agent_kind is None:
            await _fail_claim(claim, code="agent_not_configured")
            return
        if claim.agent_kind not in SUPPORTED_CLOUD_AGENTS:
            await _fail_claim(claim, code="agent_not_ready")
            return

        current = await _create_or_load_workspace(claim, config=config)
        if current is None or stale_claim.is_set():
            return
        current = await _provision_workspace_for_claim(current)
        if current is None or stale_claim.is_set():
            return
        context = await _create_or_load_session(current)
        if context is None or stale_claim.is_set():
            return
        await _send_prompt(context)
    except Exception:
        logger.exception("automation cloud executor unexpected failure run_id=%s", claim.id)
        await _fail_claim(claim, code="unexpected_executor_error")
    finally:
        heartbeat_stop.set()
        try:
            await asyncio.wait_for(heartbeat_task, timeout=2.0)
        except TimeoutError:
            heartbeat_task.cancel()
        except Exception:
            logger.exception(
                "automation cloud executor heartbeat cleanup failed run_id=%s",
                claim.id,
            )


async def run_cloud_executor_loop(
    *,
    stop_event: asyncio.Event,
    config: CloudExecutorConfig | None = None,
) -> None:
    resolved = config or default_cloud_executor_config()
    logger.info(
        "Automation cloud executor started executor_id=%s concurrency=%s",
        resolved.executor_id,
        resolved.concurrency,
    )
    tasks: set[asyncio.Task[None]] = set()
    while not stop_event.is_set():
        if not settings.automations_enabled:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=resolved.poll_interval_seconds)
            except TimeoutError:
                continue
            continue

        done = {task for task in tasks if task.done()}
        for task in done:
            tasks.remove(task)
            try:
                task.result()
            except Exception:
                logger.exception("automation cloud executor task crashed")

        try:
            available = max(0, resolved.concurrency - len(tasks))
            if available:
                claims = await claim_cloud_automation_runs(
                    executor_id=resolved.executor_id,
                    claim_ttl=resolved.claim_ttl,
                    limit=available,
                    now=utcnow(),
                )
                for claim in claims:
                    tasks.add(
                        asyncio.create_task(process_cloud_automation_run(claim, config=resolved))
                    )
        except Exception:
            logger.exception("automation cloud executor claim loop failed")

        timeout = resolved.poll_interval_seconds if not tasks else 1.0
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=timeout)
        except TimeoutError:
            continue

    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    logger.info("Automation cloud executor stopped executor_id=%s", resolved.executor_id)
