"""Cloud automation executor configuration and naming helpers."""

from __future__ import annotations

import re
import socket
import uuid
from dataclasses import dataclass
from datetime import timedelta

from proliferate.config import settings
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue


@dataclass(frozen=True)
class CloudExecutorConfig:
    executor_id: str
    claim_ttl: timedelta
    heartbeat_interval_seconds: float
    concurrency: int
    poll_interval_seconds: float
    sweep_limit: int
    branch_prefix: str
    max_branch_slug_chars: int


def build_cloud_executor_id() -> str:
    return f"cloud:{socket.gethostname()}:{uuid.uuid4().hex[:12]}"


def build_cloud_executor_config(
    *,
    executor_id: str | None = None,
    claim_ttl_seconds: float | None = None,
    heartbeat_interval_seconds: float | None = None,
    concurrency: int | None = None,
    poll_interval_seconds: float | None = None,
    sweep_limit: int | None = None,
    branch_prefix: str | None = None,
    max_branch_slug_chars: int | None = None,
) -> CloudExecutorConfig:
    return CloudExecutorConfig(
        executor_id=executor_id or build_cloud_executor_id(),
        claim_ttl=timedelta(
            seconds=max(
                1.0,
                claim_ttl_seconds
                if claim_ttl_seconds is not None
                else settings.automation_cloud_executor_claim_ttl_seconds,
            )
        ),
        heartbeat_interval_seconds=max(
            1.0,
            heartbeat_interval_seconds
            if heartbeat_interval_seconds is not None
            else settings.automation_cloud_executor_heartbeat_seconds,
        ),
        concurrency=max(
            1,
            concurrency
            if concurrency is not None
            else settings.automation_cloud_executor_concurrency,
        ),
        poll_interval_seconds=max(
            1.0,
            poll_interval_seconds
            if poll_interval_seconds is not None
            else settings.automation_cloud_executor_poll_seconds,
        ),
        sweep_limit=max(
            1,
            sweep_limit
            if sweep_limit is not None
            else settings.automation_cloud_executor_sweep_limit,
        ),
        branch_prefix=(
            branch_prefix
            if branch_prefix is not None
            else settings.automation_cloud_executor_branch_prefix
        ).strip("/ ")
        or "automation",
        max_branch_slug_chars=max(
            8,
            max_branch_slug_chars
            if max_branch_slug_chars is not None
            else settings.automation_cloud_executor_branch_slug_chars,
        ),
    )


def default_cloud_executor_config() -> CloudExecutorConfig:
    return build_cloud_executor_config()


def automation_branch_name(
    claim: AutomationRunClaimValue,
    *,
    config: CloudExecutorConfig,
) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", claim.title.lower()).strip("-._")
    if not slug:
        slug = "run"
    slug = slug[: config.max_branch_slug_chars].strip("-._") or "run"
    run_id_suffix = claim.id.hex[:12]
    return f"{config.branch_prefix}/{slug}-{run_id_suffix}"
