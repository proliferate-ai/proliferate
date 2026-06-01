from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.server.cloud.workspaces import service as workspace_service
from tests.unit.db_session_helpers import NoopDb, patch_async_session_factory

INTERACT_WITH_DB = "cloud_workspace_user_can_interact_with_db"


def _patch_session_factory(monkeypatch: pytest.MonkeyPatch, db: NoopDb) -> NoopDb:
    return patch_async_session_factory(monkeypatch, workspace_service.db_engine, db)


@pytest.mark.asyncio
async def test_get_cloud_connection_uses_request_session_for_runtime_probe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_db = NoopDb(name="request")
    lookup_db = _patch_session_factory(monkeypatch, NoopDb(name="lookup"))
    user_id = uuid4()
    workspace = SimpleNamespace(id=uuid4(), owner_scope="personal", target_id=None)

    async def _interact(db, _user_id, _workspace_id):
        assert db is request_db
        return workspace

    async def _reject_shared(_workspace):
        return None

    async def _latest_runs(db, *, user_id, cloud_workspace_ids):
        assert db is lookup_db
        assert cloud_workspace_ids == [workspace.id]
        return {}

    async def _workspace_connection(db, _workspace):
        assert db is request_db
        return SimpleNamespace(
            runtime_url="https://example-runtime.invalid",
            access_token="runtime-token",
            anyharness_workspace_id="workspace-123",
            runtime_generation=1,
            ready_agent_kinds=["codex"],
            runtime_auth=SimpleNamespace(
                status="current",
                config_current=True,
                target_current=True,
                requires_restart=False,
                desired_revision=None,
                applied_revision=None,
                last_error=None,
                last_error_at=None,
                last_attempted_at=None,
                last_applied_at=None,
            ),
        )

    async def _reload_workspace(db, workspace_id):
        assert db is lookup_db
        assert workspace_id == workspace.id
        return workspace

    monkeypatch.setattr(workspace_service, INTERACT_WITH_DB, _interact)
    monkeypatch.setattr(
        workspace_service, "_reject_shared_workspace_static_connection", _reject_shared
    )
    monkeypatch.setattr(
        workspace_service,
        "list_latest_runs_by_cloud_workspace_ids_for_user",
        _latest_runs,
    )
    monkeypatch.setattr(workspace_service, "get_workspace_connection", _workspace_connection)
    monkeypatch.setattr(workspace_service, "load_cloud_workspace_by_id", _reload_workspace)

    connection = await workspace_service.get_cloud_connection(
        request_db,
        user_id,
        workspace.id,
    )

    assert connection.runtime_url == "https://example-runtime.invalid"
    assert connection.access_token == "runtime-token"
