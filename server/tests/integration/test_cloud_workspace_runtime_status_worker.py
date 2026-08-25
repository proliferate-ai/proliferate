"""Worker liveness surfaced in workspace runtime-status (sandbox-lifecycle gap).

The Worker sidecar heartbeats every 30s; `RuntimeWorkerValue.online` derives
liveness at read time (last_seen_at within
CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS), but nothing ever read it
before this change — a dead Worker (stale binaries, expiring git credentials)
was invisible. `get_cloud_workspace_runtime_status` now surfaces it as an
additive `worker_degraded` field, computed only when the sandbox is
`running` (ready): a paused/creating/error/destroyed sandbox's Worker is
legitimately not heartbeating and must never be reported as degraded.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS
from proliferate.db.models.auth import User
from proliferate.db.models.runtime_workers import CloudRuntimeWorker
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.server.cloud.workspaces import service as workspaces_service
from proliferate.server.cloud.workspaces.domain.naming import scratch_workspace_display_name


async def _seed_user(db: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"worker-status-{uuid.uuid4()}@example.com",
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user.id


async def _seed_sandbox(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    status: str,
) -> CloudSandbox:
    sandbox = CloudSandbox(
        id=uuid.uuid4(),
        owner_user_id=user_id,
        sandbox_type="e2b",
        status=status,
    )
    db.add(sandbox)
    await db.flush()
    return sandbox


async def _seed_worker(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    cloud_sandbox_id: uuid.UUID,
    last_seen_at: datetime | None,
    status: str = "online",
) -> CloudRuntimeWorker:
    now = datetime.now(UTC)
    worker = CloudRuntimeWorker(
        id=uuid.uuid4(),
        owner_user_id=user_id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=cloud_sandbox_id,
        token_hash=uuid.uuid4().hex,
        status=status,
        enrolled_at=now,
        last_seen_at=last_seen_at,
    )
    db.add(worker)
    await db.flush()
    return worker


async def _seed_workspace_id(db: AsyncSession, *, user_id: uuid.UUID) -> uuid.UUID:
    workspace = await cloud_workspace_store.create_scratch_cloud_workspace(
        db,
        user_id=user_id,
        display_name=scratch_workspace_display_name(uuid.uuid4()),
    )
    assert workspace is not None
    return workspace.id


@pytest.mark.asyncio
async def test_ready_sandbox_fresh_heartbeat_is_not_degraded(
    db_session: AsyncSession,
) -> None:
    user_id = await _seed_user(db_session)
    sandbox = await _seed_sandbox(db_session, user_id=user_id, status="ready")
    await _seed_worker(
        db_session,
        user_id=user_id,
        cloud_sandbox_id=sandbox.id,
        last_seen_at=datetime.now(UTC),
    )
    workspace_id = await _seed_workspace_id(db_session, user_id=user_id)

    response = await workspaces_service.get_cloud_workspace_runtime_status(
        db_session, user_id, workspace_id
    )

    assert response.runtime_status == "running"
    assert response.worker_degraded is False


@pytest.mark.asyncio
async def test_ready_sandbox_stale_heartbeat_is_degraded(
    db_session: AsyncSession,
) -> None:
    user_id = await _seed_user(db_session)
    sandbox = await _seed_sandbox(db_session, user_id=user_id, status="ready")
    stale_at = datetime.now(UTC) - timedelta(
        seconds=CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS + 300
    )
    await _seed_worker(
        db_session,
        user_id=user_id,
        cloud_sandbox_id=sandbox.id,
        last_seen_at=stale_at,
    )
    workspace_id = await _seed_workspace_id(db_session, user_id=user_id)

    response = await workspaces_service.get_cloud_workspace_runtime_status(
        db_session, user_id, workspace_id
    )

    assert response.runtime_status == "running"
    assert response.worker_degraded is True


@pytest.mark.asyncio
async def test_paused_sandbox_stale_worker_is_not_degraded(
    db_session: AsyncSession,
) -> None:
    user_id = await _seed_user(db_session)
    sandbox = await _seed_sandbox(db_session, user_id=user_id, status="paused")
    stale_at = datetime.now(UTC) - timedelta(
        seconds=CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS + 300
    )
    await _seed_worker(
        db_session,
        user_id=user_id,
        cloud_sandbox_id=sandbox.id,
        last_seen_at=stale_at,
    )
    workspace_id = await _seed_workspace_id(db_session, user_id=user_id)

    response = await workspaces_service.get_cloud_workspace_runtime_status(
        db_session, user_id, workspace_id
    )

    # A paused VM's Worker is legitimately not heartbeating; a stale
    # heartbeat here must never be reported as degraded.
    assert response.runtime_status == "paused"
    assert response.worker_degraded is False


@pytest.mark.asyncio
async def test_ready_sandbox_with_no_worker_row_is_degraded(
    db_session: AsyncSession,
) -> None:
    user_id = await _seed_user(db_session)
    await _seed_sandbox(db_session, user_id=user_id, status="ready")
    workspace_id = await _seed_workspace_id(db_session, user_id=user_id)

    response = await workspaces_service.get_cloud_workspace_runtime_status(
        db_session, user_id, workspace_id
    )

    # A ready sandbox is provisioned with a worker sidecar launch as part of
    # materialization; a ready sandbox with no worker row at all means the
    # sidecar boot silently failed (best-effort launch) — surface it exactly
    # like a stale heartbeat rather than treating "no row" as "nothing to
    # check".
    assert response.runtime_status == "running"
    assert response.worker_degraded is True


@pytest.mark.asyncio
async def test_ready_sandbox_worker_never_seen_is_degraded(
    db_session: AsyncSession,
) -> None:
    user_id = await _seed_user(db_session)
    sandbox = await _seed_sandbox(db_session, user_id=user_id, status="ready")
    await _seed_worker(
        db_session,
        user_id=user_id,
        cloud_sandbox_id=sandbox.id,
        last_seen_at=None,
    )
    workspace_id = await _seed_workspace_id(db_session, user_id=user_id)

    response = await workspaces_service.get_cloud_workspace_runtime_status(
        db_session, user_id, workspace_id
    )

    # `RuntimeWorkerValue.online` explicitly guards `last_seen_at is None`
    # before computing an age; a worker row that has enrolled but never sent
    # a heartbeat must be treated the same as a stale one.
    assert response.runtime_status == "running"
    assert response.worker_degraded is True


@pytest.mark.asyncio
async def test_ready_sandbox_offline_status_fresh_heartbeat_is_degraded(
    db_session: AsyncSession,
) -> None:
    user_id = await _seed_user(db_session)
    sandbox = await _seed_sandbox(db_session, user_id=user_id, status="ready")
    await _seed_worker(
        db_session,
        user_id=user_id,
        cloud_sandbox_id=sandbox.id,
        last_seen_at=datetime.now(UTC),
        status="offline",
    )
    workspace_id = await _seed_workspace_id(db_session, user_id=user_id)

    response = await workspaces_service.get_cloud_workspace_runtime_status(
        db_session, user_id, workspace_id
    )

    # `RuntimeWorkerValue.online` also guards `status != "online"`
    # independent of heartbeat freshness. No production code writes
    # status="offline" today, but this locks in the dormant branch.
    assert response.runtime_status == "running"
    assert response.worker_degraded is True


@pytest.mark.asyncio
async def test_no_sandbox_is_not_degraded(db_session: AsyncSession) -> None:
    user_id = await _seed_user(db_session)
    workspace_id = await _seed_workspace_id(db_session, user_id=user_id)

    response = await workspaces_service.get_cloud_workspace_runtime_status(
        db_session, user_id, workspace_id
    )

    assert response.runtime_status == "disabled"
    assert response.worker_degraded is False
