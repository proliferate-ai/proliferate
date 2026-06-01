"""Runtime-config sync operations for managed AnyHarness runtimes."""

from __future__ import annotations

import time
from uuid import UUID

from proliferate.integrations import anyharness
from proliferate.server.cloud._logging import log_cloud_event
from proliferate.utils.time import duration_ms


async def apply_remote_runtime_config(
    runtime_url: str,
    access_token: str,
    body: dict[str, object],
    *,
    workspace_id: UUID | None = None,
) -> dict[str, object]:
    apply_started = time.perf_counter()
    response = await anyharness.apply_runtime_config(runtime_url, access_token, body)
    log_cloud_event(
        "cloud runtime config applied",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(apply_started),
        status=str(response.get("status") or ""),
        applied=bool(response.get("applied")),
    )
    return response
