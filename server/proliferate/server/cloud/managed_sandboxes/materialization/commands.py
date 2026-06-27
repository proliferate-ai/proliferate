"""Command and file primitives for managed sandbox materialization."""

from __future__ import annotations

import shlex
import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from proliferate.db.store.managed_sandboxes import ManagedSandboxValue
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxRuntimeContext,
    get_configured_sandbox_provider,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    run_sandbox_command_logged,
)


@dataclass(frozen=True)
class MaterializationTarget:
    provider: SandboxProvider
    provider_sandbox: Any
    runtime_context: SandboxRuntimeContext


async def connect_materialization_target(
    sandbox: ManagedSandboxValue,
) -> MaterializationTarget:
    if not sandbox.e2b_sandbox_id:
        raise RuntimeError("Managed sandbox is missing an E2B sandbox id.")
    provider = get_configured_sandbox_provider()
    provider_sandbox = await provider.connect_running_sandbox(sandbox.e2b_sandbox_id)
    runtime_context = await provider.resolve_runtime_context(provider_sandbox)
    return MaterializationTarget(
        provider=provider,
        provider_sandbox=provider_sandbox,
        runtime_context=runtime_context,
    )


async def run_materialization_script(
    target: MaterializationTarget,
    *,
    sandbox_id: UUID,
    label: str,
    script: str,
    envs: dict[str, str] | None = None,
    timeout_seconds: int = 60,
    log_output_on_success: bool = True,
) -> None:
    result = await run_sandbox_command_logged(
        target.provider,
        target.provider_sandbox,
        workspace_id=sandbox_id,
        label=label,
        command="bash -lc " + shlex.quote(script),
        runtime_context=target.runtime_context,
        envs=envs,
        timeout_seconds=timeout_seconds,
        log_output_on_success=log_output_on_success,
    )
    assert_command_succeeded(result, f"Managed sandbox materialization failed: {label}")


async def write_private_file(
    target: MaterializationTarget,
    *,
    sandbox_id: UUID,
    path: str,
    content: str | bytes,
    mode: str = "600",
    allowed_root: str | None = None,
) -> None:
    quoted_path = shlex.quote(path)
    quoted_mode = shlex.quote(mode)
    quoted_allowed_root = shlex.quote(allowed_root) if allowed_root is not None else "''"
    tmp_path = f"{path}.tmp-{uuid.uuid4().hex}"
    quoted_tmp_path = shlex.quote(tmp_path)
    await run_materialization_script(
        target,
        sandbox_id=sandbox_id,
        label="materialization_prepare_private_file",
        script="\n".join(
            [
                "set -eu",
                f"target={quoted_path}",
                f"allowed_root={quoted_allowed_root}",
                _path_safety_functions(),
                'parent="$(dirname "$target")"',
                'ensure_safe_target_parent "$target" "$allowed_root"',
                'mkdir -p "$parent"',
                'ensure_safe_target_parent "$target" "$allowed_root"',
            ]
        ),
        timeout_seconds=30,
        log_output_on_success=False,
    )
    await target.provider.write_file(target.provider_sandbox, tmp_path, content)
    await run_materialization_script(
        target,
        sandbox_id=sandbox_id,
        label="materialization_commit_private_file",
        script="\n".join(
            [
                "set -eu",
                f"target={quoted_path}",
                f"tmp={quoted_tmp_path}",
                f"allowed_root={quoted_allowed_root}",
                _path_safety_functions(),
                'ensure_safe_target_parent "$target" "$allowed_root"',
                'ensure_safe_path_components "$tmp"',
                'if [ -L "$target" ] || [ -L "$tmp" ]; then',
                "  echo 'Refusing to write secret through a symlinked leaf.' >&2",
                '  rm -f -- "$tmp"',
                "  exit 47",
                "fi",
                f'chmod {quoted_mode} "$tmp"',
                'mv "$tmp" "$target"',
                f'chmod {quoted_mode} "$target"',
            ]
        ),
        timeout_seconds=30,
        log_output_on_success=False,
    )


async def remove_owned_file(
    target: MaterializationTarget,
    *,
    sandbox_id: UUID,
    path: str,
    allowed_root: str | None = None,
) -> None:
    quoted_path = shlex.quote(path)
    quoted_allowed_root = shlex.quote(allowed_root) if allowed_root is not None else "''"
    await run_materialization_script(
        target,
        sandbox_id=sandbox_id,
        label="materialization_remove_owned_file",
        script="\n".join(
            [
                "set -eu",
                f"target={quoted_path}",
                f"allowed_root={quoted_allowed_root}",
                _path_safety_functions(),
                'ensure_safe_target_parent "$target" "$allowed_root"',
                'if [ -L "$target" ]; then',
                "  echo 'Refusing to remove owned secret path that is now a symlink.' >&2",
                "  exit 47",
                "fi",
                'rm -f -- "$target"',
            ]
        ),
        timeout_seconds=30,
        log_output_on_success=False,
    )


async def reconcile_owned_files(
    target: MaterializationTarget,
    *,
    sandbox_id: UUID,
    previous_paths: set[str],
    desired_files: dict[str, bytes | str],
    allowed_root: str | None = None,
) -> None:
    for path, content in sorted(desired_files.items()):
        await write_private_file(
            target,
            sandbox_id=sandbox_id,
            path=path,
            content=content,
            allowed_root=allowed_root,
        )
    for path in sorted(previous_paths - set(desired_files)):
        await remove_owned_file(
            target,
            sandbox_id=sandbox_id,
            path=path,
            allowed_root=allowed_root,
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
  # shellcheck disable=SC2086
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
