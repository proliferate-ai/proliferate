"""Part B: a lost record mid-create destroys the freshly created VM and raises."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from proliferate.server.cloud.materialization.sandbox_io import connect
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
)


class _FakeDb:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


class _FakeProvider:
    template_version = "e2b"

    def __init__(self) -> None:
        self.destroyed: list[str] = []

    async def create_sandbox(self, *, metadata: dict[str, str] | None = None) -> Any:
        return SimpleNamespace(sandbox_id="sbx-new")

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        self.destroyed.append(sandbox_id)


@pytest.mark.asyncio
async def test_lost_record_destroys_vm_and_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _FakeProvider()
    sandbox = SimpleNamespace(
        id=uuid.uuid4(),
        destroyed_at=None,
        status="creating",
        e2b_sandbox_id=None,
        e2b_template_ref="e2b",
        owner_user_id=uuid.uuid4(),
    )

    async def _resume_allowed(*_a: Any, **_k: Any) -> None:
        return None

    async def _record_none(*_a: Any, **_k: Any) -> None:
        return None  # row destroyed mid-create

    monkeypatch.setattr(connect, "assert_cloud_sandbox_resume_allowed", _resume_allowed)
    monkeypatch.setattr(connect, "get_sandbox_provider", lambda _ref: provider)
    monkeypatch.setattr(
        connect.cloud_sandboxes_store,
        "record_cloud_sandbox_provider_sandbox",
        _record_none,
    )

    db = _FakeDb()
    with pytest.raises(CloudMaterializationCommandError):
        await connect.connect_ready_sandbox(db, sandbox=sandbox)

    assert provider.destroyed == ["sbx-new"]
    # Never committed the lost record and never proceeded to resume/launch.
    assert db.commits == 0
