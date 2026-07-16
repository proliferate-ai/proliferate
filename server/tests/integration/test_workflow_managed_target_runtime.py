"""Locked cold-target custody and agent-auth readiness proof."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.server.cloud.materialization import operation
from proliferate.server.cloud.materialization.materialize import agent_auth
from proliferate.server.cloud.materialization.materialize import workflow_runtime
from proliferate.server.workflows.worker import coordination
from tests.integration.cloud_api_helpers import register_and_login


async def _seed_sandbox(
    client: AsyncClient,
    test_engine: AsyncEngine,
) -> tuple[UUID, UUID]:
    owner = await register_and_login(client, f"managed-target-{uuid4()}@example.com")
    owner_id = UUID(owner["user_id"])
    sandbox_id = uuid4()
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as db, db.begin():
        db.add(
            CloudSandbox(
                id=sandbox_id,
                owner_user_id=owner_id,
                sandbox_type="e2b",
                status="ready",
            )
        )
    return owner_id, sandbox_id


@pytest.mark.asyncio
async def test_duplicate_cold_runtime_access_serializes_connect_and_store_probe(
    client: AsyncClient,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _owner_id, sandbox_id = await _seed_sandbox(client, test_engine)
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    lock = asyncio.Lock()
    inside_lock = 0
    active_connects = 0
    max_active_connects = 0
    provider_creations = 0
    initial_loads = 0
    both_initial_snapshots_loaded = asyncio.Event()
    real_load = cloud_sandboxes_store.load_cloud_sandbox_by_id

    async def synchronized_load(db, requested_id, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal initial_loads
        snapshot = await real_load(db, requested_id, **kwargs)
        if not kwargs.get("refresh", False):
            initial_loads += 1
            if initial_loads == 2:
                both_initial_snapshots_loaded.set()
            await both_initial_snapshots_loaded.wait()
            assert snapshot is not None and snapshot.e2b_sandbox_id is None
        return snapshot

    @asynccontextmanager
    async def locked(key: str, **_kwargs: object):  # type: ignore[no-untyped-def]
        nonlocal inside_lock
        assert key == f"cloud-sandbox:{sandbox_id}"
        async with lock:
            inside_lock += 1
            try:
                yield
            finally:
                inside_lock -= 1

    async def connect(db, *, sandbox):  # type: ignore[no-untyped-def]
        nonlocal active_connects, max_active_connects, provider_creations
        assert inside_lock == 1
        assert sandbox.id == sandbox_id
        active_connects += 1
        max_active_connects = max(max_active_connects, active_connects)
        if sandbox.e2b_sandbox_id is None:
            provider_creations += 1
            persisted = await cloud_sandboxes_store.record_cloud_sandbox_provider_sandbox(
                db,
                sandbox_id,
                e2b_sandbox_id="provider-a",
                e2b_template_ref="e2b",
            )
            assert persisted is not None
            await db.commit()
        else:
            assert sandbox.e2b_sandbox_id == "provider-a"
        await asyncio.sleep(0.02)
        active_connects -= 1
        return SimpleNamespace()

    async def load_access(_sandbox):  # type: ignore[no-untyped-def]
        assert inside_lock == 1
        return "https://runtime.invalid", "token", "data-key"

    async def identity(_url: str, _token: str) -> SimpleNamespace:
        assert inside_lock == 1
        return SimpleNamespace(execution_store_id="store-a")

    monkeypatch.setattr(operation.locks, "redis_materialization_lock", locked)
    monkeypatch.setattr(operation.sandbox_io, "connect_ready_sandbox", connect)
    monkeypatch.setattr(
        workflow_runtime.cloud_sandboxes_store,
        "load_cloud_sandbox_by_id",
        synchronized_load,
    )
    monkeypatch.setattr(
        workflow_runtime.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        load_access,
    )
    monkeypatch.setattr(coordination, "get_execution_store_identity", identity)

    first, second = await asyncio.gather(
        coordination.runtime_access(
            factory,
            sandbox_id=sandbox_id,
            expected_store_id=None,
        ),
        coordination.runtime_access(
            factory,
            sandbox_id=sandbox_id,
            expected_store_id=None,
        ),
    )

    assert first.execution_store_id == second.execution_store_id == "store-a"
    assert max_active_connects == 1
    assert provider_creations == 1


@pytest.mark.asyncio
async def test_cold_target_materializes_agent_auth_before_store_custody(
    client: AsyncClient,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner_id, sandbox_id = await _seed_sandbox(client, test_engine)
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    calls: list[str] = []

    @asynccontextmanager
    async def locked(_key: str, **_kwargs: object):  # type: ignore[no-untyped-def]
        calls.append("lock")
        yield

    async def connect(_db, *, sandbox):  # type: ignore[no-untyped-def]
        assert sandbox.id == sandbox_id
        calls.append("connect")
        return SimpleNamespace()

    async def materialize(db, *, ctx, user_id):  # type: ignore[no-untyped-def]
        assert not db.in_transaction()
        assert user_id == owner_id
        calls.append("agent-auth")

    async def load_access(_sandbox):  # type: ignore[no-untyped-def]
        calls.append("access")
        return "https://runtime.invalid", "token", "data-key"

    async def identity(_url: str, _token: str) -> SimpleNamespace:
        assert calls[-1] == "access"
        assert "agent-auth" in calls
        calls.append("identity")
        return SimpleNamespace(execution_store_id="store-a")

    monkeypatch.setattr(operation.locks, "redis_materialization_lock", locked)
    monkeypatch.setattr(operation.sandbox_io, "connect_ready_sandbox", connect)
    monkeypatch.setattr(agent_auth, "materialize_agent_auth", materialize)
    monkeypatch.setattr(
        workflow_runtime.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        load_access,
    )
    monkeypatch.setattr(coordination, "get_execution_store_identity", identity)

    access = await coordination.runtime_access(
        factory,
        sandbox_id=sandbox_id,
        expected_store_id=None,
        prepare_agent_auth_for_user_id=owner_id,
    )

    assert access.execution_store_id == "store-a"
    assert calls == ["lock", "connect", "agent-auth", "access", "identity"]
