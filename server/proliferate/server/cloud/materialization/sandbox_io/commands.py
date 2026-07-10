"""Command execution helpers for cloud sandbox materialization."""

from __future__ import annotations

import shlex
from uuid import UUID

from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
    SandboxIOTarget,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
)


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
            f"{label} failed with exit code {result_exit}: {stderr.strip()[:1000]}",
            exit_code=result_exit,
        )
    return result_stdout(result)
