"""Health and auth probes for managed AnyHarness runtimes."""

from __future__ import annotations

import asyncio
import logging
import time
from uuid import UUID

from proliferate.integrations import anyharness
from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.utils.time import duration_ms


async def wait_for_runtime_health(
    runtime_url: str,
    *,
    workspace_id: UUID | None = None,
    required_successes: int = 1,
    total_attempts: int = 10,
    delay_seconds: float = 0.5,
) -> None:
    successes = 0
    log_cloud_event(
        "cloud runtime health wait started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        required_successes=required_successes,
        max_attempts=total_attempts,
    )
    for attempt in range(1, total_attempts + 1):
        attempt_started = time.perf_counter()
        try:
            probe = await anyharness.probe_runtime_health(runtime_url)
            if probe.is_success:
                successes += 1
                log_cloud_event(
                    "cloud runtime health probe succeeded",
                    workspace_id=workspace_id,
                    runtime_url=runtime_url,
                    attempt=attempt,
                    consecutive_successes=successes,
                    elapsed_ms=duration_ms(attempt_started),
                )
                if successes >= required_successes:
                    log_cloud_event(
                        "cloud runtime health wait finished",
                        workspace_id=workspace_id,
                        runtime_url=runtime_url,
                        attempts=attempt,
                        required_successes=required_successes,
                    )
                    return
            else:
                successes = 0
                log_cloud_event(
                    "cloud runtime health probe returned non-success",
                    level=logging.WARNING,
                    workspace_id=workspace_id,
                    runtime_url=runtime_url,
                    attempt=attempt,
                    status_code=probe.status_code,
                    elapsed_ms=duration_ms(attempt_started),
                    response_preview=probe.response_preview,
                )
        except CloudRuntimeReconnectError as exc:
            successes = 0
            log_cloud_event(
                "cloud runtime health probe failed",
                level=logging.WARNING,
                workspace_id=workspace_id,
                runtime_url=runtime_url,
                attempt=attempt,
                elapsed_ms=duration_ms(attempt_started),
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )
        await asyncio.sleep(delay_seconds)
    raise CloudRuntimeReconnectError("AnyHarness did not become healthy in the cloud sandbox.")


async def verify_runtime_auth_enforced(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID | None = None,
) -> None:
    verify_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime auth verification started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
    )
    try:
        probe = await anyharness.check_runtime_auth_enforcement(runtime_url, access_token)
    except CloudRuntimeReconnectError as exc:
        log_cloud_event(
            "cloud runtime auth verification failed",
            level=logging.WARNING,
            workspace_id=workspace_id,
            runtime_url=runtime_url,
            elapsed_ms=duration_ms(verify_started),
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        raise CloudRuntimeReconnectError(
            "Failed to verify bearer authentication on the cloud runtime."
        ) from exc

    if not probe.authenticated_success:
        log_cloud_event(
            "cloud runtime auth verification rejected bearer token",
            level=logging.WARNING,
            workspace_id=workspace_id,
            runtime_url=runtime_url,
            elapsed_ms=duration_ms(verify_started),
            status_code=probe.authenticated_status_code,
            response_preview=probe.authenticated_response_preview,
        )
        if probe.authenticated_status_code == 401:
            raise CloudRuntimeReconnectError(
                "Runtime rejected the stored bearer token during auth verification."
            )
        raise CloudRuntimeReconnectError(
            "Runtime failed authenticated auth verification in the cloud sandbox."
        )

    if probe.unauthenticated_status_code != 401:
        log_cloud_event(
            "cloud runtime auth verification accepted unauthenticated request",
            level=logging.WARNING,
            workspace_id=workspace_id,
            runtime_url=runtime_url,
            elapsed_ms=duration_ms(verify_started),
            status_code=probe.unauthenticated_status_code,
            response_preview=probe.unauthenticated_response_preview,
        )
        raise CloudRuntimeReconnectError(
            "Runtime did not reject an unauthenticated request during auth verification."
        )

    log_cloud_event(
        "cloud runtime auth verification finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(verify_started),
    )
