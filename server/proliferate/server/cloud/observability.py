"""Lightweight observability helpers for cloud worker control-plane paths."""

from __future__ import annotations

import logging
from uuid import UUID

logger = logging.getLogger(__name__)


def log_worker_update_status(
    *,
    target_id: UUID,
    worker_id: UUID,
    status: str,
    component: str | None,
    version: str | None,
) -> None:
    logger.info(
        "cloud worker update status",
        extra={
            "target_id": str(target_id),
            "worker_id": str(worker_id),
            "status": status,
            "component": component,
            "version": version,
        },
    )
