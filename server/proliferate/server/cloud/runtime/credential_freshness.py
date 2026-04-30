"""Credential freshness orchestration for shared cloud runtime environments."""

from __future__ import annotations

import logging
import re
import shlex
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

import httpx

from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS, CloudRuntimeEnvironmentStatus
from proliferate.db.models.cloud import CloudCredential, CloudRuntimeEnvironment
from proliferate.db.store.cloud_credentials import load_cloud_credentials_for_user
from proliferate.db.store.cloud_repo_config import load_cloud_repo_config_for_user
from proliferate.db.store.cloud_runtime_environments import (
    load_runtime_environment_by_id,
    load_runtime_environment_with_sandbox,
    runtime_environment_credential_apply_lock,
    save_runtime_environment_state,
)
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxRuntimeContext,
    get_sandbox_provider,
)
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.anyharness_api import (
    CloudRuntimeReconnectError,
    reconcile_remote_agents,
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_runtime_env,
    build_runtime_launch_script,
)
from proliferate.server.cloud.runtime.credentials import (
    ProvisionCredentials,
    normalize_provision_credentials,
    write_credential_files,
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

CredentialFreshnessStatus = Literal[
    "current",
    "stale",
    "restart_required",
    "apply_failed",
    "missing_credentials",
]

_EMPTY_FILES_REVISION = "credential-files:v1:empty"
_EMPTY_PROCESS_REVISION = "credential-process:v1:empty"
_RUNNING_SANDBOX_STATES = frozenset({"running", "started"})

logger = logging.getLogger("proliferate.cloud")


@dataclass(frozen=True)
class CredentialRevisionState:
    files_revision: str
    process_revision: str
    credentials: ProvisionCredentials
    missing_credentials: bool


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


def _active_supported_credentials(records: list[CloudCredential]) -> list[CloudCredential]:
    return [
        record
        for record in records
        if record.provider in SUPPORTED_CLOUD_AGENTS and record.revoked_at is None
    ]


def _revision_for(records: list[CloudCredential], auth_mode: str, prefix: str) -> str:
    parts = sorted(
        f"{record.provider}:{record.auth_mode}:{record.payload_format}:{record.id}"
        for record in records
        if record.auth_mode == auth_mode
    )
    if not parts:
        return _EMPTY_FILES_REVISION if auth_mode == "file" else _EMPTY_PROCESS_REVISION
    return f"{prefix}:v1:{','.join(parts)}"


def build_credential_revision_state(
    records: list[CloudCredential],
) -> CredentialRevisionState:
    active_records = _active_supported_credentials(records)
    credential_payloads = {
        record.provider: decrypt_json(record.payload_ciphertext) for record in active_records
    }
    return CredentialRevisionState(
        files_revision=_revision_for(active_records, "file", "credential-files"),
        process_revision=_revision_for(active_records, "env", "credential-process"),
        credentials=normalize_provision_credentials(credential_payloads),
        missing_credentials=not active_records,
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
    assume_legacy_current = not revisions.missing_credentials
    files_current = _revision_is_current(
        environment,
        applied_revision=environment.credential_files_applied_revision,
        desired_revision=revisions.files_revision,
        assume_legacy_current=assume_legacy_current,
    )
    process_current = _revision_is_current(
        environment,
        applied_revision=environment.credential_process_applied_revision,
        desired_revision=revisions.process_revision,
        assume_legacy_current=assume_legacy_current,
    )
    requires_restart = not process_current
    if files_current and process_current:
        status: CredentialFreshnessStatus = (
            "missing_credentials" if revisions.missing_credentials else "current"
        )
    elif environment.credential_last_error:
        status = "apply_failed"
    elif requires_restart:
        status = "restart_required"
    else:
        status = "stale"
    return CredentialFreshnessSnapshot(
        status=status,
        files_current=files_current,
        process_current=process_current,
        requires_restart=requires_restart,
        last_error=environment.credential_last_error,
        last_error_at=environment.credential_last_error_at,
        files_applied_at=environment.credential_files_applied_at,
        process_applied_at=environment.credential_process_applied_at,
    )


def _revision_is_current(
    environment: CloudRuntimeEnvironment,
    *,
    applied_revision: str | None,
    desired_revision: str,
    assume_legacy_current: bool,
) -> bool:
    if applied_revision == desired_revision:
        return True
    return (
        applied_revision is None
        and assume_legacy_current
        and environment.status == CloudRuntimeEnvironmentStatus.running.value
        and environment.active_sandbox_id is not None
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
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{runtime_url}/v1/workspaces",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, list):
        raise CloudRuntimeReconnectError("Cloud runtime did not return a valid workspace list.")
    for item in payload:
        if not isinstance(item, dict):
            continue
        summary = item.get("executionSummary")
        if not isinstance(summary, dict):
            continue
        live_count = summary.get("liveSessionCount")
        if isinstance(live_count, int) and live_count > 0:
            log_cloud_event(
                "cloud runtime credential relaunch blocked by live session",
                workspace_id=workspace_id,
                runtime_workspace_id=item.get("id"),
            )
            return True
    return False


async def _stop_runtime_process(
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
            label="stop_runtime_for_credential_refresh",
            command="sh -lc " + shlex.quote(script),
            runtime_context=runtime_context,
            timeout_seconds=15,
        ),
        "Cloud runtime stop failed",
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
            label="chmod_runtime_launcher_for_credential_refresh",
            command=f"chmod +x {runtime_launcher_path(runtime_context)}",
            runtime_context=runtime_context,
            timeout_seconds=30,
        ),
        "Cloud runtime launcher update failed",
    )
    await _stop_runtime_process(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
    )
    start_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="relaunch_runtime_for_credential_refresh",
        command=build_detached_runtime_launch_command(runtime_context),
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
        if snapshot.status == "current" or (
            revisions.missing_credentials and snapshot.files_current and snapshot.process_current
        ):
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

            if not allow_process_restart:
                return snapshot

            (
                access_token,
                anyharness_data_key,
                repo_env_vars,
            ) = await _load_runtime_credentials_context(environment)
            runtime_url = environment.runtime_url
            if not runtime_url:
                raise CloudRuntimeReconnectError("Cloud runtime URL is not available.")
            if await _runtime_has_live_sessions(
                runtime_url,
                access_token,
                workspace_id=workspace_id,
            ):
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
