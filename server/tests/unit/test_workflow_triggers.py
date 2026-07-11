"""Workflow trigger CRUD tests (spec 3.5).

CRUD runs on the rollback-scoped ``db_session``. Scheduler-tick / missed-run /
local-scheduling coverage lives in
``test_workflow_schedule_policies.py`` and ``test_workflow_local_scheduling.py``
respectively; shared builders/patch helpers live in ``workflow_trigger_helpers.py``.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.workflows import WORKFLOW_TRIGGER_KIND_SCHEDULE
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import triggers
from proliferate.server.cloud.workflows.models import (
    TriggerScheduleRequest,
    WorkflowTriggerUpdateRequest,
)
from proliferate.utils.time import utcnow
from tests.unit.workflow_trigger_helpers import (
    _DAILY_9,
    _HOURLY,
    _REPO,
    _create_body,
    _make_cloud_repo_environment,
    _make_ready_cloud_workspace,
    _make_user,
    _make_workflow,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
def session_factory(test_engine):  # type: ignore[no-untyped-def]
    return async_sessionmaker(test_engine, expire_on_commit=False)


# --- CRUD ----------------------------------------------------------------------


async def test_create_schedule_trigger_cloud(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(db_session, user)

    trigger = await triggers.create_trigger(
        db_session, user, workflow.id, _create_body(concurrency="queue")
    )

    assert trigger.kind == WORKFLOW_TRIGGER_KIND_SCHEDULE
    assert trigger.concurrency_policy == "queue"
    assert trigger.target_mode == "personal_cloud"
    # D16: repo is authored; the workspace is derived (reuses the repo's workspace).
    assert trigger.repo_full_name == _REPO
    assert trigger.target_workspace_id == workspace.id
    assert trigger.schedule_rrule == _HOURLY
    assert trigger.schedule_summary  # a human summary was computed
    # Cursor math: the first fire is strictly in the future.
    assert trigger.next_run_at is not None
    assert trigger.next_run_at > utcnow()


async def test_create_local_schedule_requires_repo_pin(db_session: AsyncSession) -> None:
    """L15 is lifted for local schedule (see the 2a tests below), but the D16 repo
    pin is still required — a local schedule trigger with no repo is rejected at the
    CHECK-mirroring validation, not silently accepted."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await triggers.create_trigger(
            db_session, user, workflow.id, _create_body(None, target_mode="local")
        )
    assert exc.value.code == "invalid_repo"
    assert exc.value.status_code == 400


async def test_create_rejects_bad_rrule(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    await _make_ready_cloud_workspace(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await triggers.create_trigger(
            db_session,
            user,
            workflow.id,
            _create_body(rrule="RRULE:FREQ=SECONDLY;INTERVAL=1"),
        )
    assert exc.value.code == "invalid_schedule"


async def test_create_enabled_rejects_missing_required_preset(db_session: AsyncSession) -> None:
    """D16 enable-gate: an enabled schedule can't ship a required input unpresetted."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user, required_arg=True)
    await _make_ready_cloud_workspace(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await triggers.create_trigger(
            db_session, user, workflow.id, _create_body(args={}, enabled=True)
        )
    assert exc.value.code == "schedule_presets_incomplete"


async def test_create_disabled_allows_missing_required_preset(db_session: AsyncSession) -> None:
    """A disabled draft may leave required presets blank; only enabling is gated."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user, required_arg=True)
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await triggers.create_trigger(
        db_session, user, workflow.id, _create_body(args={}, enabled=False)
    )
    assert trigger.enabled is False
    assert trigger.input_presets_json == {}


async def test_create_covers_required_arg(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user, required_arg=True)
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await triggers.create_trigger(
        db_session, user, workflow.id, _create_body(args={"issue": "PROJ-1"})
    )
    assert trigger.args_json == {"issue": "PROJ-1"}
    # The presets back the enable-gate and mirror the fire-time args for schedule.
    assert trigger.input_presets_json == {"issue": "PROJ-1"}


async def test_create_requires_repo(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await triggers.create_trigger(db_session, user, workflow.id, _create_body(None))
    assert exc.value.code == "invalid_repo"


async def test_create_rejects_unconfigured_repo(db_session: AsyncSession) -> None:
    """A repo the user hasn't configured as a cloud environment can't be pinned."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await triggers.create_trigger(
            db_session, user, workflow.id, _create_body("someone/unconfigured")
        )
    assert exc.value.code == "cloud_repo_environment_not_found"


async def test_create_derives_workspace_from_repo(db_session: AsyncSession) -> None:
    """D16: with a cloud repo env but no existing workspace, the server provisions a
    dedicated workspace row and stamps it as the derived target."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    repo_env = await _make_cloud_repo_environment(db_session, user)
    trigger = await triggers.create_trigger(db_session, user, workflow.id, _create_body())
    assert trigger.target_workspace_id is not None
    from proliferate.db.store import cloud_workspaces as ws_store

    derived = await ws_store.get_cloud_workspace_for_user(
        db_session, user.id, trigger.target_workspace_id
    )
    assert derived is not None
    assert derived.repo_environment_id == repo_env.id


async def test_update_args_only_keeps_cursor(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await triggers.create_trigger(
        db_session, user, workflow.id, _create_body(concurrency="skip")
    )
    original_next = trigger.next_run_at

    updated = await triggers.update_trigger(
        db_session,
        user,
        workflow.id,
        trigger.id,
        WorkflowTriggerUpdateRequest(concurrencyPolicy="queue"),  # type: ignore[call-arg]
    )
    assert updated.concurrency_policy == "queue"
    # An edit that leaves the schedule alone must not shift the cursor.
    assert updated.next_run_at == original_next


async def test_update_schedule_recomputes_cursor(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await triggers.create_trigger(
        db_session, user, workflow.id, _create_body(rrule=_HOURLY)
    )
    updated = await triggers.update_trigger(
        db_session,
        user,
        workflow.id,
        trigger.id,
        WorkflowTriggerUpdateRequest(
            schedule=TriggerScheduleRequest(rrule=_DAILY_9, timezone="UTC")
        ),
    )
    assert updated.schedule_rrule == _DAILY_9
    assert updated.next_run_at is not None
    assert updated.next_run_at > utcnow()


async def test_update_switches_cloud_target_to_local_nulls_workspace(
    db_session: AsyncSession,
) -> None:
    """Regression: PATCHing an existing cloud trigger to a local target must clear
    target_workspace_id, or the store's write violates
    ck_workflow_trigger_target_workspace (local requires a NULL workspace)."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await triggers.create_trigger(db_session, user, workflow.id, _create_body())
    assert trigger.target_workspace_id is not None

    updated = await triggers.update_trigger(
        db_session,
        user,
        workflow.id,
        trigger.id,
        WorkflowTriggerUpdateRequest(targetMode="local"),  # type: ignore[call-arg]
    )
    assert updated.target_mode == "local"
    assert updated.target_workspace_id is None


async def test_update_switches_local_target_to_cloud_derives_workspace(
    db_session: AsyncSession,
) -> None:
    """Regression: PATCHing an existing local trigger to a personal_cloud target
    must derive a workspace, or the store's write violates
    ck_workflow_trigger_target_workspace (personal_cloud requires a non-NULL
    workspace) — the existing row still carries target_workspace_id=None from
    its local days."""
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    repo_env = await _make_cloud_repo_environment(db_session, user)
    trigger = await triggers.create_trigger(
        db_session, user, workflow.id, _create_body(target_mode="local")
    )
    assert trigger.target_workspace_id is None

    updated = await triggers.update_trigger(
        db_session,
        user,
        workflow.id,
        trigger.id,
        WorkflowTriggerUpdateRequest(targetMode="personal_cloud"),  # type: ignore[call-arg]
    )
    assert updated.target_mode == "personal_cloud"
    assert updated.target_workspace_id is not None

    from proliferate.db.store import cloud_workspaces as ws_store

    derived = await ws_store.get_cloud_workspace_for_user(
        db_session, user.id, updated.target_workspace_id
    )
    assert derived is not None
    assert derived.repo_environment_id == repo_env.id


async def test_delete_trigger(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    await _make_ready_cloud_workspace(db_session, user)
    trigger = await triggers.create_trigger(db_session, user, workflow.id, _create_body())
    await triggers.delete_trigger(db_session, user, workflow.id, trigger.id)
    assert await trigger_store.get_trigger(db_session, trigger.id) is None


async def test_trigger_visibility_isolation(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    other = await _make_user(db_session)
    workflow = await _make_workflow(db_session, owner)
    await _make_ready_cloud_workspace(db_session, owner)
    trigger = await triggers.create_trigger(db_session, owner, workflow.id, _create_body())
    with pytest.raises(CloudApiError) as exc:
        await triggers.get_trigger(db_session, other, workflow.id, trigger.id)
    assert exc.value.code == "workflow_not_found"
