from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud.mobility import (
    CloudWorkspaceHandoffOp,
    CloudWorkspaceMobility,
)
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_mobility import (
    complete_cloud_workspace_handoff_cleanup,
    create_cloud_workspace_handoff_op,
    create_cloud_workspace_handoff_op_for_user,
    fail_cloud_workspace_handoff_op,
    fail_cloud_workspace_handoff_op_checkpoint_for_user,
    finalize_cloud_workspace_handoff_op,
    get_active_handoff_for_mobility,
    get_active_user_handoff_op,
    heartbeat_cloud_workspace_handoff_op,
    load_cloud_workspace_mobility_for_user,
)
from proliferate.server.cloud.mobility.domain.lifecycle import (
    FINAL_HANDOFF_PHASES,
    LIFECYCLE_CLEANUP_FAILED,
    HANDOFF_PHASE_HANDOFF_FAILED,
    LIFECYCLE_HANDOFF_FAILED,
    OWNER_CLOUD,
    moving_lifecycle_state,
    stale_handoff_outcome,
    visible_failure_last_error,
    visible_failure_status_detail,
)

pytestmark = pytest.mark.usefixtures("mobility_session_factory")


@pytest_asyncio.fixture
async def mobility_session_factory(monkeypatch: pytest.MonkeyPatch, test_engine):
    original_session_factory = db_engine.async_session_factory
    db_engine.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    yield
    db_engine.async_session_factory = original_session_factory


def _mobility_record(
    *,
    user_id: UUID,
    owner: str = "local",
    lifecycle_state: str | None = None,
) -> CloudWorkspaceMobility:
    return CloudWorkspaceMobility(
        user_id=user_id,
        display_name="Rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name=f"rocket-{uuid4()}",
        git_branch="feature/cloud",
        owner=owner,
        lifecycle_state=lifecycle_state or f"{owner}_active",
        status_detail=None,
        last_error=None,
        cloud_workspace_id=None,
        active_handoff_op_id=None,
        last_handoff_op_id=None,
        cloud_lost_at=None,
        cloud_lost_reason=None,
    )


def _handoff_record(
    *,
    mobility_workspace: CloudWorkspaceMobility,
    phase: str = "start_requested",
    finalized_at: datetime | None = None,
    heartbeat_at: datetime | None = None,
) -> CloudWorkspaceHandoffOp:
    now = datetime.now(UTC)
    return CloudWorkspaceHandoffOp(
        mobility_workspace_id=mobility_workspace.id,
        user_id=mobility_workspace.user_id,
        direction="local_to_cloud",
        source_owner="local",
        target_owner="cloud",
        phase=phase,
        requested_branch=mobility_workspace.git_branch,
        requested_base_sha="abc123",
        exclude_paths_json="[]",
        failure_code=None,
        failure_detail=None,
        started_at=now,
        heartbeat_at=heartbeat_at or now,
        finalized_at=finalized_at,
        cleanup_completed_at=None,
        created_at=now,
        updated_at=now,
    )


async def _create_mobility(
    db_session: AsyncSession,
    *,
    user_id: UUID,
    owner: str = "local",
) -> CloudWorkspaceMobility:
    mobility = _mobility_record(user_id=user_id, owner=owner)
    db_session.add(mobility)
    await db_session.commit()
    await db_session.refresh(mobility)
    return mobility


@pytest.mark.asyncio
async def test_create_handoff_sets_active_pointer_and_moving_state(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)

    handoff = await create_cloud_workspace_handoff_op(
        db_session,
        mobility_workspace=mobility,
        direction="local_to_cloud",
        source_owner="local",
        target_owner="cloud",
        moving_lifecycle_state=moving_lifecycle_state(OWNER_CLOUD),
        requested_branch="feature/cloud",
        requested_base_sha="abc123",
        exclude_paths=["node_modules"],
    )

    refreshed = await load_cloud_workspace_mobility_for_user(
        db_session,
        user_id=user_id,
        mobility_workspace_id=mobility.id,
    )
    assert refreshed is not None
    assert refreshed.active_handoff_op_id == handoff.id
    assert refreshed.last_handoff_op_id == handoff.id
    assert refreshed.owner == "local"
    assert refreshed.lifecycle_state == "moving"
    assert refreshed.status_detail == "Handoff started"
    assert refreshed.active_handoff is not None
    assert refreshed.active_handoff.exclude_paths == ("node_modules",)


@pytest.mark.asyncio
async def test_create_handoff_for_user_rejects_existing_active_workspace_handoff(
    db_session: AsyncSession,
    mobility_session_factory,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    handoff = _handoff_record(mobility_workspace=mobility)
    db_session.add(handoff)
    await db_session.flush()
    mobility.active_handoff_op_id = handoff.id
    mobility.last_handoff_op_id = handoff.id
    await db_session.commit()

    with pytest.raises(ValueError, match="handoff already in progress for workspace"):
        await create_cloud_workspace_handoff_op_for_user(
            db_session,
            user_id=user_id,
            mobility_workspace_id=mobility.id,
            direction="local_to_cloud",
            source_owner="local",
            target_owner="cloud",
            moving_lifecycle_state=moving_lifecycle_state(OWNER_CLOUD),
            final_handoff_phases=FINAL_HANDOFF_PHASES,
            requested_branch="feature/cloud",
            requested_base_sha="abc123",
            exclude_paths=[],
        )


@pytest.mark.asyncio
async def test_cleanup_failed_handoff_counts_as_active(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    handoff = _handoff_record(mobility_workspace=mobility, phase="cleanup_failed")
    db_session.add(handoff)
    await db_session.flush()
    mobility.active_handoff_op_id = handoff.id
    mobility.last_handoff_op_id = handoff.id
    await db_session.commit()

    active_for_workspace = await get_active_handoff_for_mobility(
        db_session,
        mobility_workspace_id=mobility.id,
        final_handoff_phases=FINAL_HANDOFF_PHASES,
    )
    active_for_user = await get_active_user_handoff_op(
        db_session,
        user_id=user_id,
        final_handoff_phases=FINAL_HANDOFF_PHASES,
    )

    assert active_for_workspace is not None
    assert active_for_workspace.id == handoff.id
    assert active_for_user is not None
    assert active_for_user.id == handoff.id


@pytest.mark.asyncio
async def test_heartbeat_refreshes_timestamp_without_changing_phase(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    old_heartbeat = datetime.now(UTC) - timedelta(minutes=10)
    handoff = _handoff_record(
        mobility_workspace=mobility,
        phase="source_frozen",
        heartbeat_at=old_heartbeat,
    )
    db_session.add(handoff)
    await db_session.commit()

    value = await heartbeat_cloud_workspace_handoff_op(db_session, handoff_op=handoff)

    assert value.phase == "source_frozen"
    assert value.heartbeat_at > old_heartbeat


@pytest.mark.asyncio
async def test_finalize_flips_owner_before_cleanup_clears_active_handoff(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    handoff = await create_cloud_workspace_handoff_op(
        db_session,
        mobility_workspace=mobility,
        direction="local_to_cloud",
        source_owner="local",
        target_owner="cloud",
        moving_lifecycle_state=moving_lifecycle_state(OWNER_CLOUD),
        requested_branch="feature/cloud",
        requested_base_sha="abc123",
        exclude_paths=[],
    )

    handoff_record = await db_session.get(CloudWorkspaceHandoffOp, handoff.id)
    mobility_record = await db_session.get(CloudWorkspaceMobility, mobility.id)
    assert handoff_record is not None
    assert mobility_record is not None
    destination_workspace = CloudWorkspace(
        user_id=user_id,
        billing_subject_id=uuid4(),
        display_name="Rocket",
        git_provider=mobility.git_provider,
        git_owner=mobility.git_owner,
        git_repo_name=mobility.git_repo_name,
        git_branch=mobility.git_branch,
        status="ready",
        template_version="test",
    )
    db_session.add(destination_workspace)
    await db_session.flush()
    handoff_record.phase = "install_succeeded"
    finalized = await finalize_cloud_workspace_handoff_op(
        db_session,
        handoff_op=handoff_record,
        mobility_workspace=mobility_record,
        cloud_workspace_id=destination_workspace.id,
    )
    await db_session.commit()

    visible = await load_cloud_workspace_mobility_for_user(
        db_session,
        user_id=user_id,
        mobility_workspace_id=mobility.id,
    )
    assert finalized.phase == "cutover_committed"
    assert finalized.canonical_side == "destination"
    assert finalized.finalized_at is not None
    assert visible is not None
    assert visible.owner == "personal_cloud"
    assert visible.lifecycle_state == "cloud_active"
    assert visible.active_handoff_op_id == handoff.id
    assert visible.status_detail == "Cutover committed"


@pytest.mark.asyncio
async def test_cleanup_completion_clears_active_handoff_and_marks_completed(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    handoff = await create_cloud_workspace_handoff_op(
        db_session,
        mobility_workspace=mobility,
        direction="local_to_cloud",
        source_owner="local",
        target_owner="cloud",
        moving_lifecycle_state=moving_lifecycle_state(OWNER_CLOUD),
        requested_branch="feature/cloud",
        requested_base_sha="abc123",
        exclude_paths=[],
    )
    handoff_record = await db_session.get(CloudWorkspaceHandoffOp, handoff.id)
    mobility_record = await db_session.get(CloudWorkspaceMobility, mobility.id)
    assert handoff_record is not None
    assert mobility_record is not None
    handoff_record.phase = "cleanup_pending"
    handoff_record.canonical_side = "destination"
    handoff_record.finalized_at = datetime.now(UTC)

    completed = await complete_cloud_workspace_handoff_cleanup(
        db_session,
        handoff_op=handoff_record,
        mobility_workspace=mobility_record,
    )
    await db_session.commit()

    visible = await load_cloud_workspace_mobility_for_user(
        db_session,
        user_id=user_id,
        mobility_workspace_id=mobility.id,
    )
    assert completed.phase == "completed"
    assert completed.cleanup_completed_at is not None
    assert visible is not None
    assert visible.active_handoff_op_id is None
    assert visible.status_detail == "Ready"


@pytest.mark.asyncio
async def test_cleanup_completion_rejects_handoff_before_cutover(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    handoff = await create_cloud_workspace_handoff_op(
        db_session,
        mobility_workspace=mobility,
        direction="local_to_cloud",
        source_owner="local",
        target_owner="cloud",
        moving_lifecycle_state=moving_lifecycle_state(OWNER_CLOUD),
        requested_branch="feature/cloud",
        requested_base_sha="abc123",
        exclude_paths=[],
    )
    handoff_record = await db_session.get(CloudWorkspaceHandoffOp, handoff.id)
    mobility_record = await db_session.get(CloudWorkspaceMobility, mobility.id)
    assert handoff_record is not None
    assert mobility_record is not None
    handoff_record.phase = "install_succeeded"

    with pytest.raises(ValueError, match="cannot complete before cutover"):
        await complete_cloud_workspace_handoff_cleanup(
            db_session,
            handoff_op=handoff_record,
            mobility_workspace=mobility_record,
        )

    assert handoff_record.phase == "install_succeeded"
    assert handoff_record.cleanup_completed_at is None
    assert mobility_record.active_handoff_op_id == handoff.id


@pytest.mark.asyncio
async def test_cleanup_completion_restores_active_lifecycle_after_cleanup_failure(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    handoff = await create_cloud_workspace_handoff_op(
        db_session,
        mobility_workspace=mobility,
        direction="cloud_to_local",
        source_owner="personal_cloud",
        target_owner="local",
        moving_lifecycle_state=moving_lifecycle_state(OWNER_CLOUD),
        requested_branch="feature/cloud",
        requested_base_sha="abc123",
        exclude_paths=[],
    )
    handoff_record = await db_session.get(CloudWorkspaceHandoffOp, handoff.id)
    mobility_record = await db_session.get(CloudWorkspaceMobility, mobility.id)
    assert handoff_record is not None
    assert mobility_record is not None
    handoff_record.phase = "cleanup_failed"
    handoff_record.canonical_side = "destination"
    handoff_record.finalized_at = datetime.now(UTC)
    handoff_record.failure_code = "cleanup_failed"
    handoff_record.failure_detail = "Cleanup failed"
    mobility_record.owner = "local"
    mobility_record.lifecycle_state = LIFECYCLE_CLEANUP_FAILED
    mobility_record.active_handoff_op_id = handoff.id
    mobility_record.status_detail = "Cleanup failed"
    mobility_record.last_error = "Cleanup failed"

    await complete_cloud_workspace_handoff_cleanup(
        db_session,
        handoff_op=handoff_record,
        mobility_workspace=mobility_record,
    )
    await db_session.commit()

    visible = await load_cloud_workspace_mobility_for_user(
        db_session,
        user_id=user_id,
        mobility_workspace_id=mobility.id,
    )
    assert visible is not None
    assert visible.lifecycle_state == "local_active"
    assert visible.active_handoff_op_id is None
    assert visible.cloud_workspace_id is None
    assert visible.last_error is None
    completed_record = await db_session.get(CloudWorkspaceHandoffOp, handoff.id)
    assert completed_record is not None
    assert completed_record.failure_code is None
    assert completed_record.failure_detail is None


@pytest.mark.asyncio
async def test_failure_clears_active_handoff_and_truncates_visible_error(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    handoff = await create_cloud_workspace_handoff_op(
        db_session,
        mobility_workspace=mobility,
        direction="local_to_cloud",
        source_owner="local",
        target_owner="cloud",
        moving_lifecycle_state=moving_lifecycle_state(OWNER_CLOUD),
        requested_branch="feature/cloud",
        requested_base_sha="abc123",
        exclude_paths=[],
    )
    handoff_record = await db_session.get(CloudWorkspaceHandoffOp, handoff.id)
    mobility_record = await db_session.get(CloudWorkspaceMobility, mobility.id)
    assert handoff_record is not None
    assert mobility_record is not None
    failure_detail = "x" * 2100

    failed = await fail_cloud_workspace_handoff_op(
        db_session,
        handoff_op=handoff_record,
        mobility_workspace=mobility_record,
        phase=HANDOFF_PHASE_HANDOFF_FAILED,
        lifecycle_state=LIFECYCLE_HANDOFF_FAILED,
        failure_code="provisioning_failed",
        failure_detail=failure_detail,
        status_detail=visible_failure_status_detail(failure_detail),
        last_error=visible_failure_last_error(failure_detail),
    )
    await db_session.commit()

    visible = await load_cloud_workspace_mobility_for_user(
        db_session,
        user_id=user_id,
        mobility_workspace_id=mobility.id,
    )
    assert failed.phase == "handoff_failed"
    assert failed.failure_detail == failure_detail
    assert visible is not None
    assert visible.active_handoff_op_id is None
    assert visible.lifecycle_state == "handoff_failed"
    assert visible.status_detail == "x" * 255
    assert visible.last_error == "x" * 2000


@pytest.mark.asyncio
async def test_stale_expiry_before_finalize_marks_failed_and_clears_active_handoff(
    db_session: AsyncSession,
    mobility_session_factory,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    handoff = _handoff_record(
        mobility_workspace=mobility,
        phase="source_frozen",
        heartbeat_at=datetime.now(UTC) - timedelta(minutes=10),
    )
    db_session.add(handoff)
    await db_session.flush()
    mobility.active_handoff_op_id = handoff.id
    mobility.last_handoff_op_id = handoff.id
    await db_session.commit()
    stale_outcome = stale_handoff_outcome(
        finalized_at=handoff.finalized_at,
        cleanup_completed_at=handoff.cleanup_completed_at,
    )

    expired = await fail_cloud_workspace_handoff_op_checkpoint_for_user(
        db_session,
        user_id=user_id,
        mobility_workspace_id=mobility.id,
        handoff_op_id=handoff.id,
        phase=stale_outcome.phase,
        lifecycle_state=stale_outcome.lifecycle_state,
        failure_code=stale_outcome.failure_code,
        failure_detail=stale_outcome.failure_detail,
        status_detail=visible_failure_status_detail(stale_outcome.failure_detail),
        last_error=visible_failure_last_error(stale_outcome.failure_detail),
        keep_active_handoff=stale_outcome.keep_active_handoff,
        event_type="handoff_stale",
    )

    visible = await load_cloud_workspace_mobility_for_user(
        db_session,
        user_id=user_id,
        mobility_workspace_id=mobility.id,
    )
    assert expired.phase == "handoff_failed"
    assert visible is not None
    assert visible.active_handoff_op_id is None
    assert visible.lifecycle_state == "handoff_failed"


@pytest.mark.asyncio
async def test_stale_expiry_after_finalize_marks_cleanup_failed_and_keeps_active(
    db_session: AsyncSession,
    mobility_session_factory,
) -> None:
    user_id = uuid4()
    mobility = await _create_mobility(db_session, user_id=user_id)
    handoff = _handoff_record(
        mobility_workspace=mobility,
        phase="cleanup_pending",
        finalized_at=datetime.now(UTC) - timedelta(minutes=10),
        heartbeat_at=datetime.now(UTC) - timedelta(minutes=10),
    )
    db_session.add(handoff)
    await db_session.flush()
    mobility.owner = "cloud"
    mobility.lifecycle_state = "cloud_active"
    mobility.active_handoff_op_id = handoff.id
    mobility.last_handoff_op_id = handoff.id
    await db_session.commit()
    stale_outcome = stale_handoff_outcome(
        finalized_at=handoff.finalized_at,
        cleanup_completed_at=handoff.cleanup_completed_at,
    )

    expired = await fail_cloud_workspace_handoff_op_checkpoint_for_user(
        db_session,
        user_id=user_id,
        mobility_workspace_id=mobility.id,
        handoff_op_id=handoff.id,
        phase=stale_outcome.phase,
        lifecycle_state=stale_outcome.lifecycle_state,
        failure_code=stale_outcome.failure_code,
        failure_detail=stale_outcome.failure_detail,
        status_detail=visible_failure_status_detail(stale_outcome.failure_detail),
        last_error=visible_failure_last_error(stale_outcome.failure_detail),
        keep_active_handoff=stale_outcome.keep_active_handoff,
        event_type="handoff_stale",
    )

    visible = await load_cloud_workspace_mobility_for_user(
        db_session,
        user_id=user_id,
        mobility_workspace_id=mobility.id,
    )
    assert expired.phase == "cleanup_failed"
    assert visible is not None
    assert visible.active_handoff_op_id == handoff.id
    assert visible.lifecycle_state == "cleanup_failed"
