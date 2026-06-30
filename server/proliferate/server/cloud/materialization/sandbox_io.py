"""Sandbox I/O primitives owned by cloud materialization."""

from __future__ import annotations

import secrets
import shlex
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox import (
    RuntimeEndpoint,
    SandboxProvider,
    SandboxRuntimeContext,
    get_sandbox_provider,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_runtime_env,
    build_runtime_launch_script,
)
from proliferate.server.cloud.runtime.liveness.health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.provisioning.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    build_detached_runtime_launch_command,
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
    runtime_launcher_path,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text


class CloudMaterializationCommandError(RuntimeError):
    pass


@dataclass(frozen=True)
class SandboxIOTarget:
    provider: SandboxProvider
    sandbox: Any
    endpoint: RuntimeEndpoint
    runtime_context: SandboxRuntimeContext


def _runtime_token(sandbox: CloudSandboxValue) -> str | None:
    if not sandbox.anyharness_bearer_token_ciphertext:
        return None
    return decrypt_text(sandbox.anyharness_bearer_token_ciphertext)


def _runtime_data_key(sandbox: CloudSandboxValue) -> str | None:
    if not sandbox.anyharness_data_key_ciphertext:
        return None
    return decrypt_text(sandbox.anyharness_data_key_ciphertext)


async def connect_ready_sandbox(
    db: AsyncSession,
    *,
    sandbox: CloudSandboxValue,
) -> SandboxIOTarget:
    if sandbox.destroyed_at is not None or sandbox.status == "destroyed":
        raise CloudMaterializationCommandError("Cloud sandbox has been destroyed.")

    provider = get_sandbox_provider(sandbox.e2b_template_ref)
    provider_sandbox_id = sandbox.e2b_sandbox_id
    if provider_sandbox_id is None:
        handle = await provider.create_sandbox(
            metadata={
                "proliferate_cloud_sandbox_id": str(sandbox.id),
                "proliferate_owner_user_id": str(sandbox.owner_user_id or ""),
            }
        )
        provider_sandbox_id = handle.sandbox_id
        refreshed = await cloud_sandboxes_store.record_cloud_sandbox_provider_sandbox(
            db,
            sandbox.id,
            e2b_sandbox_id=provider_sandbox_id,
            e2b_template_ref=provider.template_version,
        )
        if refreshed is not None:
            sandbox = refreshed
        await db.commit()

    provider_sandbox = await provider.resume_sandbox(provider_sandbox_id)
    endpoint = await provider.resolve_runtime_endpoint(provider_sandbox)
    runtime_context = await provider.resolve_runtime_context(provider_sandbox)
    runtime_token = _runtime_token(sandbox)
    data_key = _runtime_data_key(sandbox)

    if runtime_token is not None and data_key is not None:
        try:
            await wait_for_runtime_health(
                endpoint.runtime_url,
                workspace_id=sandbox.id,
                total_attempts=4,
                delay_seconds=0.5,
            )
        except Exception:
            await _launch_anyharness_runtime(
                db,
                provider=provider,
                provider_sandbox=provider_sandbox,
                sandbox_record=sandbox,
                endpoint=endpoint,
                runtime_context=runtime_context,
                runtime_token=runtime_token,
                anyharness_data_key=data_key,
            )
    else:
        runtime_token = secrets.token_urlsafe(32)
        data_key = generate_anyharness_data_key()
        await _launch_anyharness_runtime(
            db,
            provider=provider,
            provider_sandbox=provider_sandbox,
            sandbox_record=sandbox,
            endpoint=endpoint,
            runtime_context=runtime_context,
            runtime_token=runtime_token,
            anyharness_data_key=data_key,
        )

    if sandbox.anyharness_base_url != endpoint.runtime_url:
        await cloud_sandboxes_store.mark_cloud_sandbox_ready(
            db,
            sandbox.id,
            e2b_sandbox_id=provider_sandbox_id,
            e2b_template_ref=provider.template_version,
            anyharness_base_url=endpoint.runtime_url,
            anyharness_bearer_token_ciphertext=(
                sandbox.anyharness_bearer_token_ciphertext or encrypt_text(runtime_token)
            ),
            anyharness_data_key_ciphertext=(
                sandbox.anyharness_data_key_ciphertext or encrypt_text(data_key)
            ),
        )
        await db.commit()

    return SandboxIOTarget(
        provider=provider,
        sandbox=provider_sandbox,
        endpoint=endpoint,
        runtime_context=runtime_context,
    )


async def _launch_anyharness_runtime(
    db: AsyncSession,
    *,
    provider: SandboxProvider,
    provider_sandbox: object,
    sandbox_record: CloudSandboxValue,
    endpoint: RuntimeEndpoint,
    runtime_context: SandboxRuntimeContext,
    runtime_token: str,
    anyharness_data_key: str,
) -> None:
    launcher_path = runtime_launcher_path(runtime_context)
    await provider.write_file(
        provider_sandbox,
        launcher_path,
        build_runtime_launch_script(
            provider,
            runtime_context,
            build_runtime_env(
                runtime_token,
                anyharness_data_key=anyharness_data_key,
            ),
        ),
    )
    chmod_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_chmod_anyharness_launcher",
        command=f"chmod 700 {shlex.quote(launcher_path)}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    assert_command_succeeded(chmod_result, "AnyHarness launcher chmod failed")

    start_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_launch_anyharness",
        command=build_detached_runtime_launch_command(runtime_context),
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    assert_command_succeeded(start_result, "AnyHarness launch failed")
    await wait_for_runtime_health(
        endpoint.runtime_url,
        workspace_id=sandbox_record.id,
        total_attempts=30,
        delay_seconds=0.5,
    )
    await verify_runtime_auth_enforced(
        endpoint.runtime_url,
        runtime_token,
        workspace_id=sandbox_record.id,
    )
    await cloud_sandboxes_store.mark_cloud_sandbox_ready(
        db,
        sandbox_record.id,
        e2b_sandbox_id=sandbox_record.e2b_sandbox_id or "",
        e2b_template_ref=provider.template_version,
        anyharness_base_url=endpoint.runtime_url,
        anyharness_bearer_token_ciphertext=encrypt_text(runtime_token),
        anyharness_data_key_ciphertext=encrypt_text(anyharness_data_key),
    )
    await db.commit()


async def run_materialization_script(
    target: SandboxIOTarget,
    *,
    operation_id: UUID,
    label: str,
    script: str,
    envs: dict[str, str] | None = None,
    timeout_seconds: int = 60,
    cwd: str | None = None,
    log_output_on_success: bool = False,
) -> str:
    result = await run_sandbox_command_logged(
        target.provider,
        target.sandbox,
        workspace_id=operation_id,
        label=label,
        command="bash -lc " + shlex.quote(script),
        runtime_context=target.runtime_context,
        cwd=cwd,
        envs=envs,
        timeout_seconds=timeout_seconds,
        log_output_on_success=log_output_on_success,
    )
    if result_exit := getattr(result, "exit_code", getattr(result, "exitCode", 0)):
        stderr = result_stderr(result) or result_stdout(result)
        raise CloudMaterializationCommandError(
            f"{label} failed with exit code {result_exit}: {stderr.strip()[:1000]}"
        )
    return result_stdout(result)


async def write_private_file_atomic(
    target: SandboxIOTarget,
    *,
    operation_id: UUID,
    path: str,
    content: str | bytes,
    mode: str = "600",
    allowed_root: str | None = None,
) -> None:
    temp_path = f"{path}.proliferate-tmp-{secrets.token_hex(8)}"
    await target.provider.write_file(target.sandbox, temp_path, content)
    script = _path_safety_functions()
    script += "\n"
    script += "\n".join(
        [
            f"target={shlex.quote(path)}",
            f"tmp={shlex.quote(temp_path)}",
            f"mode={shlex.quote(mode)}",
            f"allowed_root={shlex.quote(allowed_root or '')}",
            'ensure_safe_target_parent "$target" "$allowed_root"',
            'if [ -L "$target" ]; then',
            '  echo "Refusing to overwrite symlink target: $target" >&2',
            "  exit 47",
            "fi",
            'mkdir -p "$(dirname "$target")"',
            'chmod "$mode" "$tmp"',
            'mv -f "$tmp" "$target"',
            'chmod "$mode" "$target"',
        ]
    )
    await run_materialization_script(
        target,
        operation_id=operation_id,
        label="materialization_write_private_file",
        script=script,
        timeout_seconds=30,
    )


async def remove_owned_files(
    target: SandboxIOTarget,
    *,
    operation_id: UUID,
    paths: set[str],
    allowed_root: str | None = None,
) -> None:
    if not paths:
        return
    lines = [_path_safety_functions()]
    lines.append(f"allowed_root={shlex.quote(allowed_root or '')}")
    for path in sorted(paths):
        lines.extend(
            [
                f"target={shlex.quote(path)}",
                'ensure_safe_target_parent "$target" "$allowed_root"',
                'rm -f -- "$target"',
            ]
        )
    await run_materialization_script(
        target,
        operation_id=operation_id,
        label="materialization_remove_owned_files",
        script="\n".join(lines),
        timeout_seconds=30,
    )


def _path_safety_functions() -> str:
    return r"""
ensure_safe_path_components() {
  check_path="$1"
  case "$check_path" in
    /*) ;;
    *)
      echo "Refusing to materialize a non-absolute path." >&2
      exit 47
      ;;
  esac

  current=""
  rest="${check_path#/}"
  old_ifs="$IFS"
  IFS="/"
  set -- $rest
  IFS="$old_ifs"
  for part in "$@"; do
    [ -n "$part" ] || continue
    current="${current}/${part}"
    if [ -L "$current" ]; then
      echo "Refusing to materialize through a symlink component: $current" >&2
      exit 47
    fi
  done
}

ensure_safe_target_parent() {
  check_target="$1"
  check_root="${2:-}"
  parent="$(dirname "$check_target")"
  ensure_safe_path_components "$parent"
  if [ -n "$check_root" ]; then
    ensure_safe_path_components "$check_root"
    root_real="$(realpath -m "$check_root")"
    parent_real="$(realpath -m "$parent")"
    case "$parent_real" in
      "$root_real"|"$root_real"/*) ;;
      *)
        echo "Refusing to materialize outside allowed root." >&2
        exit 47
        ;;
    esac
  fi
}
""".strip()
