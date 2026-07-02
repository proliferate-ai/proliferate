"""Authorization helpers for cloud target config materialization."""

from __future__ import annotations

from proliferate.db.store.cloud_sync.targets import CloudTargetSnapshot

from proliferate.server.cloud.errors import CloudApiError


def require_target_materializable(target: CloudTargetSnapshot) -> None:
    if target.status == "archived":
        raise CloudApiError(
            "target_config_target_archived",
            "Target is archived.",
            status_code=409,
        )
