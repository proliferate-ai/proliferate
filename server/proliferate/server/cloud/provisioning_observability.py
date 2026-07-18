"""Structured timing for managed Cloud provisioning phases."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.utils.time import duration_ms


@asynccontextmanager
async def provisioning_phase(
    *,
    scope: str,
    phase: str,
    operation_key: str | None = None,
    cloud_sandbox_id: UUID | None = None,
    repo_environment_id: UUID | None = None,
    cloud_workspace_id: UUID | None = None,
) -> AsyncIterator[None]:
    """Log a privacy-safe start and terminal outcome for one provisioning phase."""
    started_at = time.perf_counter()
    log_cloud_event(
        "cloud provisioning phase started",
        provisioning_scope=scope,
        provisioning_phase=phase,
        provisioning_outcome="started",
        operation_key=operation_key,
        cloud_sandbox_id=cloud_sandbox_id,
        repo_environment_id=repo_environment_id,
        cloud_workspace_id=cloud_workspace_id,
    )
    try:
        yield
    except asyncio.CancelledError as exc:
        log_cloud_event(
            "cloud provisioning phase cancelled",
            level=logging.WARNING,
            provisioning_scope=scope,
            provisioning_phase=phase,
            provisioning_outcome="cancelled",
            elapsed_ms=duration_ms(started_at),
            error_type=exc.__class__.__name__,
            operation_key=operation_key,
            cloud_sandbox_id=cloud_sandbox_id,
            repo_environment_id=repo_environment_id,
            cloud_workspace_id=cloud_workspace_id,
        )
        raise
    except Exception as exc:
        log_cloud_event(
            "cloud provisioning phase failed",
            level=logging.ERROR,
            provisioning_scope=scope,
            provisioning_phase=phase,
            provisioning_outcome="failed",
            elapsed_ms=duration_ms(started_at),
            error_type=exc.__class__.__name__,
            operation_key=operation_key,
            cloud_sandbox_id=cloud_sandbox_id,
            repo_environment_id=repo_environment_id,
            cloud_workspace_id=cloud_workspace_id,
        )
        raise
    else:
        log_cloud_event(
            "cloud provisioning phase finished",
            provisioning_scope=scope,
            provisioning_phase=phase,
            provisioning_outcome="success",
            elapsed_ms=duration_ms(started_at),
            operation_key=operation_key,
            cloud_sandbox_id=cloud_sandbox_id,
            repo_environment_id=repo_environment_id,
            cloud_workspace_id=cloud_workspace_id,
        )
