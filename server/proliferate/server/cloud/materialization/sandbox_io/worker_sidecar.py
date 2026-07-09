"""Boot the Proliferate worker as a sidecar inside a cloud sandbox.

The worker runs alongside the directly-launched AnyHarness process. It enrolls
back to Cloud, heartbeats, and writes the integration-gateway dotfile that
AnyHarness reads at session launch. Booting is best-effort: the sandbox is
fully usable over its direct AnyHarness bearer token even if the worker never
comes up, so failures here are logged and swallowed.
"""

from __future__ import annotations

import logging
import shlex

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.server.cloud.cloud_sandboxes.transactions import run_with_fresh_session
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.runtime.bootstrap import (
    build_worker_config,
    worker_binary_path,
    worker_config_path,
    worker_log_path,
)
from proliferate.server.cloud.runtime.sandbox_exec import run_sandbox_command_logged
from proliferate.server.cloud.runtime_workers.service import (
    create_cloud_sandbox_enrollment,
    worker_cloud_base_url,
)


def _detached_worker_launch_command(runtime_context: SandboxRuntimeContext) -> str:
    binary = shlex.quote(worker_binary_path(runtime_context))
    config = shlex.quote(worker_config_path(runtime_context))
    log = shlex.quote(worker_log_path(runtime_context))
    # A stale binary (e.g. an older template) simply means no worker this run.
    return "bash -lc " + shlex.quote(
        f"test -x {binary} && nohup {binary} --config {config} > {log} 2>&1 < /dev/null &"
    )


async def launch_worker_sidecar(
    *,
    provider: SandboxProvider,
    provider_sandbox: object,
    sandbox_record: CloudSandboxValue,
    runtime_context: SandboxRuntimeContext,
    runtime_bearer_token: str | None = None,
) -> None:
    owner_user_id = sandbox_record.owner_user_id
    if owner_user_id is None:
        return

    cloud_base_url = worker_cloud_base_url()
    if not cloud_base_url:
        return

    try:
        # Mint + commit the enrollment in its own transaction so it is durably
        # visible before the worker (a separate process) tries to consume it.
        enrollment_token = ""

        async def _mint(fresh_db: AsyncSession) -> None:
            nonlocal enrollment_token
            enrollment_token = await create_cloud_sandbox_enrollment(
                fresh_db,
                cloud_sandbox_id=sandbox_record.id,
                owner_user_id=owner_user_id,
                organization_id=sandbox_record.organization_id,
            )

        await run_with_fresh_session(_mint)

        await provider.write_file(
            provider_sandbox,
            worker_config_path(runtime_context),
            build_worker_config(
                cloud_base_url=cloud_base_url,
                enrollment_token=enrollment_token,
                runtime_context=runtime_context,
                runtime_bearer_token=runtime_bearer_token,
            ),
        )
        await run_sandbox_command_logged(
            provider,
            provider_sandbox,
            workspace_id=sandbox_record.id,
            label="materialization_launch_worker_sidecar",
            command=_detached_worker_launch_command(runtime_context),
            runtime_context=runtime_context,
            timeout_seconds=30,
            log_output_on_success=True,
        )
    except Exception as exc:  # noqa: BLE001 - sidecar boot is best-effort.
        log_cloud_event(
            "cloud worker sidecar boot failed",
            level=logging.WARNING,
            cloud_sandbox_id=str(sandbox_record.id),
            error=format_exception_message(exc),
        )
