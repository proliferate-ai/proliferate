"""Git helpers for cloud workspace provisioning."""

from __future__ import annotations

import shlex
from pathlib import PurePosixPath
from typing import Any

from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.server.cloud.runtime.models import CloudProvisionInput
from proliferate.server.cloud.runtime.sandbox_exec import (
    result_exit_code,
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
)


def translate_clone_failure(stderr: str) -> str:
    normalized = stderr.lower()
    if (
        "write access to repository not granted" in normalized
        or "requested url returned error: 403" in normalized
    ):
        return "Reconnect GitHub and grant repository access before creating a cloud workspace."
    return f"Git clone failed: {normalized[:400]}"


def _tokenized_repo_url(ctx: CloudProvisionInput) -> str:
    return (
        f"https://x-access-token:{ctx.github_token}@github.com/"
        f"{ctx.git_owner}/{ctx.git_repo_name}.git"
    )


async def clone_repository(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    ctx: CloudProvisionInput,
    runtime_context: SandboxRuntimeContext,
) -> None:
    clone_cwd = str(PurePosixPath(runtime_context.runtime_workdir).parent)
    install_git_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=ctx.workspace_id,
        label="ensure_git_available",
        command=(
            'sh -lc "command -v git >/dev/null 2>&1 || (apt-get update && apt-get install -y git)"'
        ),
        user="root",
        timeout_seconds=240,
        log_output_on_success=True,
    )
    if result_exit_code(install_git_result) != 0:
        stderr = result_stderr(install_git_result) or result_stdout(install_git_result)
        raise RuntimeError(f"Failed to install git in cloud sandbox: {str(stderr).strip()[:400]}")

    clone_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=ctx.workspace_id,
        label="clone_repo",
        command=(
            f"rm -rf {shlex.quote(runtime_context.runtime_workdir)} && "
            f"git clone --depth 1 --branch {shlex.quote(ctx.git_base_branch)} "
            f"{shlex.quote(_tokenized_repo_url(ctx))} "
            f"{shlex.quote(runtime_context.runtime_workdir)}"
        ),
        cwd=clone_cwd,
        runtime_context=runtime_context,
        timeout_seconds=180,
    )
    if result_exit_code(clone_result) != 0:
        stderr = result_stderr(clone_result) or result_stdout(clone_result)
        raise RuntimeError(translate_clone_failure(str(stderr)))


async def checkout_cloud_branch(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    ctx: CloudProvisionInput,
    runtime_context: SandboxRuntimeContext,
) -> None:
    checkout_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=ctx.workspace_id,
        label="checkout_cloud_branch",
        command=(
            f"git -C {shlex.quote(runtime_context.runtime_workdir)} checkout --no-track "
            f"-b {shlex.quote(ctx.git_branch)} origin/{shlex.quote(ctx.git_base_branch)}"
        ),
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    if result_exit_code(checkout_result) != 0:
        stderr = result_stderr(checkout_result) or result_stdout(checkout_result)
        raise RuntimeError(f"Git branch checkout failed: {str(stderr).strip()[:400]}")


async def configure_git_identity(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    ctx: CloudProvisionInput,
    runtime_context: SandboxRuntimeContext,
) -> None:
    config_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=ctx.workspace_id,
        label="configure_git_identity",
        command=(
            "sh -lc "
            + shlex.quote(
                " && ".join(
                    [
                        (
                            f"git -C {shlex.quote(runtime_context.runtime_workdir)} "
                            f"config user.name {shlex.quote(ctx.git_user_name)}"
                        ),
                        (
                            f"git -C {shlex.quote(runtime_context.runtime_workdir)} "
                            f"config user.email {shlex.quote(ctx.git_user_email)}"
                        ),
                    ]
                )
            )
        ),
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    if result_exit_code(config_result) != 0:
        stderr = result_stderr(config_result) or result_stdout(config_result)
        raise RuntimeError(f"Failed to configure git identity: {str(stderr).strip()[:400]}")
