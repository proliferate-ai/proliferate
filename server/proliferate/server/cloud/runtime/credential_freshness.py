"""Credential freshness orchestration for shared cloud runtime environments."""

from __future__ import annotations

import logging
import re
import shlex
from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath
from uuid import UUID

from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.store.cloud_credentials import CloudCredentialRecord
from proliferate.db.store.cloud_repo_config import load_cloud_repo_config_for_user
from proliferate.db.store.cloud_runtime_environments import (
    load_runtime_environment_by_id,
    load_runtime_environment_with_sandbox,
    runtime_environment_credential_apply_lock,
    save_runtime_environment_state,
)
from proliferate.integrations.anyharness import CloudRuntimeReconnectError, list_runtime_workspaces
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxRuntimeContext,
    get_sandbox_provider,
)
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.credentials.session_loader import load_cloud_credentials_for_user
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.anyharness_api import (
    reconcile_remote_agents,
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_detached_supervisor_launch_command,
    build_runtime_env,
    build_runtime_launch_script,
    build_supervisor_config,
    supervisor_config_path,
)
from proliferate.server.cloud.runtime.credentials import (
    ProvisionCredentials,
    normalize_provision_credentials,
    write_credential_files,
)
from proliferate.server.cloud.runtime.domain.credential_revision import (
    CredentialFreshnessStatus,
    CredentialRevisionPlan,
    build_credential_revision_plan,
    classify_credential_freshness,
    credential_apply_is_already_current,
    decide_process_credential_restart,
    filter_active_supported_credentials,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    build_detached_runtime_launch_command,
    result_exit_code,
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
    runtime_launcher_path,
)
from proliferate.utils.crypto import decrypt_json, decrypt_text
from proliferate.utils.time import utcnow

_RUNNING_SANDBOX_STATES = frozenset({"running", "started"})

logger = logging.getLogger("proliferate.cloud")


@dataclass(frozen=True)
class CredentialRevisionState:
    files_revision: str
    process_revision: str
    credentials: ProvisionCredentials
    missing_credentials: bool

    @property
    def plan(self) -> CredentialRevisionPlan:
        return CredentialRevisionPlan(
            files_revision=self.files_revision,
            process_revision=self.process_revision,
            missing_credentials=self.missing_credentials,
        )


@dataclass(frozen=True)
class CredentialFreshnessSnapshot:
    status: CredentialFreshnessStatus
    files_current: bool
    process_current: bool
    requires_restart: bool
    last_error: str | None
    last_error_at: datetime | None
    files_applied_at: datetime | None
    process_applied_at: datetime | None


def _active_supported_credentials(
    records: list[CloudCredentialRecord],
) -> list[CloudCredentialRecord]:
    return filter_active_supported_credentials(records)


def build_credential_revision_state(
    records: list[CloudCredentialRecord],
) -> CredentialRevisionState:
    active_records = _active_supported_credentials(records)
    revision_plan = build_credential_revision_plan(active_records)
    credential_payloads = {
        record.provider: decrypt_json(record.payload_ciphertext) for record in active_records
    }
    return CredentialRevisionState(
        files_revision=revision_plan.files_revision,
        process_revision=revision_plan.process_revision,
        credentials=normalize_provision_credentials(credential_payloads),
        missing_credentials=revision_plan.missing_credentials,
    )


async def build_runtime_credential_freshness_snapshot(
    environment: CloudRuntimeEnvironment | None,
) -> CredentialFreshnessSnapshot | None:
    if environment is None:
        return None
    records = await load_cloud_credentials_for_user(environment.user_id)
    revisions = build_credential_revision_state(records)
    return build_credential_freshness_snapshot(environment, revisions)


def build_credential_freshness_snapshot(
    environment: CloudRuntimeEnvironment,
    revisions: CredentialRevisionState,
) -> CredentialFreshnessSnapshot:
    decision = classify_credential_freshness(
        runtime_status=environment.status,
        active_sandbox_id=environment.active_sandbox_id,
        files_applied_revision=environment.credential_files_applied_revision,
        process_applied_revision=environment.credential_process_applied_revision,
        credential_last_error=environment.credential_last_error,
        credential_last_error_at=environment.credential_last_error_at,
        credential_files_applied_at=environment.credential_files_applied_at,
        credential_process_applied_at=environment.credential_process_applied_at,
        revisions=revisions.plan,
    )
    return CredentialFreshnessSnapshot(
        status=decision.status,
        files_current=decision.files_current,
        process_current=decision.process_current,
        requires_restart=decision.requires_restart,
        last_error=decision.last_error,
        last_error_at=decision.last_error_at,
        files_applied_at=decision.files_applied_at,
        process_applied_at=decision.process_applied_at,
    )


def _safe_apply_error_message() -> str:
    return "Could not apply synced cloud credentials. Retry credential sync."


async def _load_runtime_credentials_context(
    environment: CloudRuntimeEnvironment,
) -> tuple[str, str, dict[str, str]]:
    if not environment.runtime_token_ciphertext:
        raise CloudRuntimeReconnectError("Cloud runtime token is not available.")
    if not environment.anyharness_data_key_ciphertext:
        raise CloudRuntimeReconnectError("Cloud runtime data key is not available.")

    repo_config = await load_cloud_repo_config_for_user(
        user_id=environment.user_id,
        git_owner=environment.git_owner,
        git_repo_name=environment.git_repo_name,
    )
    return (
        decrypt_text(environment.runtime_token_ciphertext),
        decrypt_text(environment.anyharness_data_key_ciphertext),
        repo_config.env_vars if repo_config is not None and repo_config.configured else {},
    )


async def _connect_runtime_sandbox(
    environment: CloudRuntimeEnvironment,
) -> tuple[SandboxProvider, object, SandboxRuntimeContext]:
    loaded = await load_runtime_environment_with_sandbox(environment.id)
    if loaded is None or loaded.sandbox is None:
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud runtime environment does not have an active sandbox yet.",
            status_code=409,
        )
    sandbox_record = loaded.sandbox
    if not sandbox_record.external_sandbox_id:
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud runtime environment sandbox is not ready yet.",
            status_code=409,
        )
    provider = get_sandbox_provider(sandbox_record.provider)
    sandbox_state = await provider.get_sandbox_state(sandbox_record.external_sandbox_id)
    if sandbox_state is None or sandbox_state.state not in _RUNNING_SANDBOX_STATES:
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud runtime environment is not running right now.",
            status_code=409,
        )
    sandbox = await provider.connect_running_sandbox(sandbox_record.external_sandbox_id)
    runtime_context = await provider.resolve_runtime_context(sandbox)
    return provider, sandbox, runtime_context


async def _runtime_has_live_sessions(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID,
) -> bool:
    for remote_workspace in await list_runtime_workspaces(runtime_url, access_token):
        if remote_workspace.live_session_count > 0:
            log_cloud_event(
                "cloud runtime credential relaunch blocked by live session",
                workspace_id=workspace_id,
                runtime_workspace_id=remote_workspace.workspace_id,
            )
            return True
    return False


async def _supervisor_config_exists(
    provider: SandboxProvider,
    sandbox: object,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> bool:
    result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="check_supervisor_config_for_credential_refresh",
        command=f"test -f {shlex.quote(supervisor_config_path(runtime_context))}",
        runtime_context=runtime_context,
        timeout_seconds=15,
    )
    return result_exit_code(result) == 0


async def _stop_legacy_runtime_process(
    provider: SandboxProvider,
    sandbox: object,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> None:
    pattern = _pgrep_pattern_for_runtime_binary(runtime_context.runtime_binary_path)
    script = f"""
pattern={shlex.quote(pattern)}
pids="$(pgrep -f "$pattern" || true)"
if [ -z "$pids" ]; then
  exit 0
fi
kill $pids || true
for _ in $(seq 1 20); do
  pgrep -f "$pattern" >/dev/null 2>&1 || exit 0
  sleep 0.25
done
pids="$(pgrep -f "$pattern" || true)"
if [ -z "$pids" ]; then
  exit 0
fi
kill -9 $pids || true
for _ in $(seq 1 10); do
  pgrep -f "$pattern" >/dev/null 2>&1 || exit 0
  sleep 0.25
done
exit 1
""".strip()
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="stop_legacy_runtime_for_credential_refresh",
            command="sh -lc " + shlex.quote(script),
            runtime_context=runtime_context,
            timeout_seconds=15,
        ),
        "Cloud legacy runtime stop failed",
    )


def _pgrep_pattern_for_runtime_binary(runtime_binary_path: str) -> str:
    pattern = re.escape(runtime_binary_path)
    if pattern.startswith("/"):
        return "[/]" + pattern[1:]
    return pattern


async def _reconcile_runtime_agents(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID,
    credentials: ProvisionCredentials,
) -> None:
    if not credentials.synced_providers:
        return
    await reconcile_remote_agents(
        runtime_url,
        access_token,
        workspace_id=workspace_id,
        synced_providers=credentials.synced_providers,
    )


async def _persist_credential_apply_failure(
    environment: CloudRuntimeEnvironment,
    *,
    workspace_id: UUID,
    error: BaseException,
    revisions: CredentialRevisionState,
) -> CredentialFreshnessSnapshot:
    log_cloud_event(
        "cloud runtime credential apply failed",
        level=logging.ERROR,
        runtime_environment_id=environment.id,
        workspace_id=workspace_id,
        error=format_exception_message(error),
        error_type=error.__class__.__name__,
    )
    logger.exception(
        "cloud runtime credential apply traceback",
        extra={
            "runtime_environment_id": str(environment.id),
            "workspace_id": str(workspace_id),
        },
    )
    try:
        environment = await save_runtime_environment_state(
            environment.id,
            credential_last_error=_safe_apply_error_message(),
            credential_last_error_at=utcnow(),
        )
    except Exception as save_error:
        log_cloud_event(
            "cloud runtime credential apply failure persist failed",
            level=logging.ERROR,
            runtime_environment_id=environment.id,
            workspace_id=workspace_id,
            error=format_exception_message(save_error),
            error_type=save_error.__class__.__name__,
        )
        environment.credential_last_error = _safe_apply_error_message()
        environment.credential_last_error_at = utcnow()
    return build_credential_freshness_snapshot(environment, revisions)


async def _relaunch_runtime_with_credentials(
    provider: SandboxProvider,
    sandbox: object,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
    runtime_url: str,
    access_token: str,
    anyharness_data_key: str,
    credentials: ProvisionCredentials,
    repo_env_vars: dict[str, str],
) -> None:
    runtime_env = build_runtime_env(
        credentials,
        access_token,
        anyharness_data_key=anyharness_data_key,
        repo_env_vars=repo_env_vars,
    )
    use_supervisor = await _supervisor_config_exists(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
    )
    if not use_supervisor:
        await provider.write_file(
            sandbox,
            runtime_launcher_path(runtime_context),
            build_runtime_launch_script(provider, runtime_context, runtime_env),
        )
        assert_command_succeeded(
            await run_sandbox_command_logged(
                provider,
                sandbox,
                workspace_id=workspace_id,
                label="chmod_legacy_runtime_launcher_for_credential_refresh",
                command=f"chmod +x {runtime_launcher_path(runtime_context)}",
                runtime_context=runtime_context,
                timeout_seconds=30,
            ),
            "Cloud legacy runtime launcher update failed",
        )
        await _stop_legacy_runtime_process(
            provider,
            sandbox,
            workspace_id=workspace_id,
            runtime_context=runtime_context,
        )
        start_result = await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="relaunch_legacy_runtime_for_credential_refresh",
            command=build_detached_runtime_launch_command(runtime_context),
            runtime_context=runtime_context,
            cwd=runtime_context.runtime_workdir,
            timeout_seconds=30,
            log_output_on_success=True,
        )
        if result_exit_code(start_result) != 0:
            stderr = result_stderr(start_result) or result_stdout(start_result)
            raise CloudRuntimeReconnectError(
                f"Cloud runtime relaunch failed: {stderr.strip()[:200]}"
            )
        await wait_for_runtime_health(
            runtime_url,
            workspace_id=workspace_id,
            required_successes=1,
            total_attempts=30,
            delay_seconds=0.5,
        )
        await verify_runtime_auth_enforced(runtime_url, access_token, workspace_id=workspace_id)
        await _reconcile_runtime_agents(
            runtime_url,
            access_token,
            workspace_id=workspace_id,
            credentials=credentials,
        )
        return

    config_path = supervisor_config_path(runtime_context)
    config_dir = str(PurePosixPath(config_path).parent)
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="mkdir_supervisor_config_for_credential_refresh",
            command=f"mkdir -p {shlex.quote(config_dir)} && chmod 700 {shlex.quote(config_dir)}",
            runtime_context=runtime_context,
            timeout_seconds=30,
        ),
        "Cloud supervisor config directory setup failed",
    )
    await provider.write_file(
        sandbox,
        config_path,
        build_supervisor_config(provider, runtime_context, runtime_env),
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="chmod_supervisor_config_for_credential_refresh",
            command=f"chmod 600 {shlex.quote(config_path)}",
            runtime_context=runtime_context,
            timeout_seconds=30,
        ),
        "Cloud supervisor config update failed",
    )
    start_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="relaunch_supervisor_for_credential_refresh",
        command=build_detached_supervisor_launch_command(runtime_context),
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    if result_exit_code(start_result) != 0:
        stderr = result_stderr(start_result) or result_stdout(start_result)
        raise CloudRuntimeReconnectError(f"Cloud runtime relaunch failed: {stderr.strip()[:200]}")
    await wait_for_runtime_health(
        runtime_url,
        workspace_id=workspace_id,
        required_successes=1,
        total_attempts=30,
        delay_seconds=0.5,
    )
    await verify_runtime_auth_enforced(runtime_url, access_token, workspace_id=workspace_id)
    await _reconcile_runtime_agents(
        runtime_url,
        access_token,
        workspace_id=workspace_id,
        credentials=credentials,
    )


async def ensure_runtime_environment_credentials_current(
    runtime_environment_id: UUID,
    *,
    workspace_id: UUID,
    allow_process_restart: bool,
) -> CredentialFreshnessSnapshot:
    async with runtime_environment_credential_apply_lock(runtime_environment_id):
        environment = await load_runtime_environment_by_id(runtime_environment_id)
        if environment is None:
            raise CloudApiError(
                "workspace_not_ready",
                "Cloud runtime environment was not found.",
                status_code=409,
            )
        records = await load_cloud_credentials_for_user(environment.user_id)
        revisions = build_credential_revision_state(records)
        snapshot = build_credential_freshness_snapshot(environment, revisions)
        if credential_apply_is_already_current(snapshot, revisions.plan):
            return snapshot

        try:
            provider, sandbox, runtime_context = await _connect_runtime_sandbox(environment)
            files_applied = False
            now = utcnow()
            if not snapshot.files_current:
                await write_credential_files(
                    provider,
                    sandbox,
                    workspace_id=workspace_id,
                    credentials=revisions.credentials,
                    runtime_context=runtime_context,
                )
                environment = await save_runtime_environment_state(
                    environment.id,
                    credential_files_applied_revision=revisions.files_revision,
                    credential_files_applied_at=now,
                    credential_last_error=None,
                    credential_last_error_at=None,
                )
                files_applied = True

            snapshot = build_credential_freshness_snapshot(environment, revisions)
            if snapshot.process_current:
                can_reconcile = (
                    files_applied
                    and environment.runtime_url
                    and environment.runtime_token_ciphertext
                )
                if can_reconcile:
                    await _reconcile_runtime_agents(
                        environment.runtime_url,
                        decrypt_text(environment.runtime_token_ciphertext),
                        workspace_id=workspace_id,
                        credentials=revisions.credentials,
                    )
                return snapshot

            restart_decision = decide_process_credential_restart(
                requires_restart=snapshot.requires_restart,
                allow_process_restart=allow_process_restart,
                runtime_has_live_sessions=False,
            )
            if not restart_decision.allowed:
                return snapshot

            (
                access_token,
                anyharness_data_key,
                repo_env_vars,
            ) = await _load_runtime_credentials_context(environment)
            runtime_url = environment.runtime_url
            if not runtime_url:
                raise CloudRuntimeReconnectError("Cloud runtime URL is not available.")
            has_live_sessions = await _runtime_has_live_sessions(
                runtime_url,
                access_token,
                workspace_id=workspace_id,
            )
            restart_decision = decide_process_credential_restart(
                requires_restart=snapshot.requires_restart,
                allow_process_restart=allow_process_restart,
                runtime_has_live_sessions=has_live_sessions,
            )
            if not restart_decision.allowed:
                return snapshot

            await _relaunch_runtime_with_credentials(
                provider,
                sandbox,
                workspace_id=workspace_id,
                runtime_context=runtime_context,
                runtime_url=runtime_url,
                access_token=access_token,
                anyharness_data_key=anyharness_data_key,
                credentials=revisions.credentials,
                repo_env_vars=repo_env_vars,
            )
            environment = await save_runtime_environment_state(
                environment.id,
                credential_process_applied_revision=revisions.process_revision,
                credential_process_applied_at=utcnow(),
                credential_last_error=None,
                credential_last_error_at=None,
            )
            return build_credential_freshness_snapshot(environment, revisions)
        except CloudApiError:
            raise
        except Exception as exc:
            return await _persist_credential_apply_failure(
                environment,
                workspace_id=workspace_id,
                error=exc,
                revisions=revisions,
            )
