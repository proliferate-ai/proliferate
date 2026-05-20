from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from proliferate.db.store.cloud_runtime_config.revisions import (
    SandboxProfileRuntimeConfigRevisionSnapshot,
)
from proliferate.server.cloud.commands.service import (
    _raise_runtime_config_blocked_if_needed,
)
from proliferate.server.cloud.errors import CloudApiError


def _revision(manifest_json: str) -> SandboxProfileRuntimeConfigRevisionSnapshot:
    return SandboxProfileRuntimeConfigRevisionSnapshot(
        id=uuid4(),
        sandbox_profile_id=uuid4(),
        sequence=1,
        content_hash="sha256:manifest",
        manifest_json=manifest_json,
        warnings_json=None,
        source="server",
        generated_by_user_id=None,
        created_at=datetime.now(UTC),
    )


def test_runtime_config_preflight_rejects_blocking_errors() -> None:
    revision = _revision(
        '{"blockingErrors":[{"code":"mcp_auth_not_ready","message":"Reconnect"}]}'
    )

    with pytest.raises(CloudApiError) as exc:
        _raise_runtime_config_blocked_if_needed(revision)

    assert exc.value.code == "cloud_command_runtime_config_blocked"
    assert exc.value.status_code == 409


def test_runtime_config_preflight_allows_manifest_without_blocking_errors() -> None:
    _raise_runtime_config_blocked_if_needed(_revision('{"blockingErrors":[]}'))
