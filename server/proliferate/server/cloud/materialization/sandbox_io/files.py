"""Atomic file writes and owned-file cleanup for materialization."""

from __future__ import annotations

import secrets
import shlex
from uuid import UUID

from proliferate.server.cloud.materialization.sandbox_io.commands import (
    run_materialization_script,
)
from proliferate.server.cloud.materialization.sandbox_io.safety import path_safety_functions
from proliferate.server.cloud.materialization.sandbox_io.target import SandboxIOTarget


async def write_private_file_atomic(
    target: SandboxIOTarget,
    *,
    operation_id: UUID,
    path: str,
    content: str | bytes,
    mode: str = "600",
    allowed_root: str | None = None,
) -> None:
    temp_root = f"/home/user/.proliferate/materialization/tmp/{operation_id}"
    temp_path = f"{temp_root}/{secrets.token_hex(16)}"
    preflight_script = path_safety_functions()
    preflight_script += "\n"
    preflight_script += "\n".join(
        [
            f"target={shlex.quote(path)}",
            f"tmp_root={shlex.quote(temp_root)}",
            f"allowed_root={shlex.quote(allowed_root or '')}",
            'ensure_safe_target_parent "$target" "$allowed_root"',
            'ensure_safe_target_parent "$tmp_root" "/home/user/.proliferate/materialization/tmp"',
            'if [ -L "$target" ]; then',
            '  echo "Refusing to overwrite symlink target: $target" >&2',
            "  exit 47",
            "fi",
            'mkdir -p "$(dirname "$target")"',
            'mkdir -p "$tmp_root"',
            'chmod 700 "$tmp_root"',
        ]
    )
    await run_materialization_script(
        target,
        operation_id=operation_id,
        label="materialization_prepare_private_file_write",
        script=preflight_script,
        timeout_seconds=30,
    )
    await target.provider.write_file(target.sandbox, temp_path, content)
    script = path_safety_functions()
    script += "\n"
    script += "\n".join(
        [
            f"target={shlex.quote(path)}",
            f"tmp={shlex.quote(temp_path)}",
            f"mode={shlex.quote(mode)}",
            f"allowed_root={shlex.quote(allowed_root or '')}",
            'ensure_safe_target_parent "$target" "$allowed_root"',
            'ensure_safe_target_parent "$tmp" "/home/user/.proliferate/materialization/tmp"',
            'if [ -L "$target" ]; then',
            '  echo "Refusing to overwrite symlink target: $target" >&2',
            "  exit 47",
            "fi",
            'if [ -L "$tmp" ]; then',
            '  echo "Refusing to move symlink temp file: $tmp" >&2',
            "  exit 47",
            "fi",
            'chmod "$mode" "$tmp"',
            'mv -f -- "$tmp" "$target"',
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
    lines = [path_safety_functions()]
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
