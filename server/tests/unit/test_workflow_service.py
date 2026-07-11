"""DB-backed workflow service tests: workflow CRUD, free-plan cap, seed
visibility, version immutability, and owner-scoped visibility.

StartRun compilation, the delivery/observed-status lifecycle, session-binding
validation, and the reserved ``functions`` grant live in
``test_workflow_start_run.py`` (split out of this file). Shared row/definition
factories live in ``workflow_run_helpers``.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_TRIGGER_MANUAL
from proliferate.db.store import cloud_workflows as store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import compiler, service
from proliferate.server.cloud.workflows.models import WorkflowUpdateRequest
from tests.unit.workflow_run_helpers import create_workflow, definition, make_user

pytestmark = pytest.mark.asyncio


async def test_create_workflow_pins_version_one(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, versions = await create_workflow(db_session, user)
    assert workflow.current_version_id == versions[0].id
    assert versions[0].version_n == 1
    assert workflow.owner_user_id == user.id


async def test_free_plan_cap_enforced_and_archive_frees_slot(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user, name="one")

    with pytest.raises(CloudApiError) as exc:
        await create_workflow(db_session, user, name="two")
    assert exc.value.code == "workflow_limit_reached"
    assert exc.value.status_code == 403

    await service.archive_workflow(db_session, user, workflow.id)
    # Slot is now free.
    _, versions = await create_workflow(db_session, user, name="two")
    assert versions[0].version_n == 1


async def test_seed_workflow_is_visible_runnable_but_not_editable(
    db_session: AsyncSession,
) -> None:
    """Track 1f seeds (owner_user_id NULL) are shared read-only starters: any
    user can open + run one, but never edit it, and it never counts against a
    user's free-plan slot."""

    from proliferate.server.cloud.workflows.seeds import sync_seed_workflow_definitions

    user = await make_user(db_session)
    await sync_seed_workflow_definitions(db_session)
    seed = await store.get_seed_workflow_by_slug(db_session, seed_slug="notify-on-finish")
    assert seed is not None and seed.owner_user_id is None and seed.is_seed

    # Visible: a user who does not own the seed can still fetch its detail.
    workflow, versions = await service.get_workflow_detail(db_session, user, seed.id)
    assert workflow.id == seed.id
    assert versions

    # Read-only: update / archive / trigger create are rejected with 403.
    with pytest.raises(CloudApiError) as upd:
        await service.update_workflow(
            db_session, user, seed.id, WorkflowUpdateRequest(definition=definition())
        )
    assert upd.value.code == "workflow_seed_read_only"
    assert upd.value.status_code == 403

    with pytest.raises(CloudApiError) as arch:
        await service.archive_workflow(db_session, user, seed.id)
    assert arch.value.code == "workflow_seed_read_only"

    # Does not consume the free-plan slot: the user can still create their own.
    _, created = await create_workflow(db_session, user, name="mine")
    assert created[0].version_n == 1

    # Runnable: the run is owned by the runner (seed has no owner), so its
    # executor_user_id resolves to the launching user.
    run = await compiler.start_run(
        db_session,
        user,
        seed.id,
        inputs={"command": "pytest", "slack_channel_id": "C1"},
        target_mode="local",
        trigger_kind=WORKFLOW_TRIGGER_MANUAL,
    )
    assert run.executor_user_id == user.id


async def test_update_creates_new_version_and_preserves_old(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, versions_v1 = await create_workflow(db_session, user)
    v1 = versions_v1[0]

    new_definition = definition()
    new_definition["agents"][0]["steps"][0]["prompt"] = "Rewritten {{inputs.issue}}"
    updated, versions = await service.update_workflow(
        db_session, user, workflow.id, WorkflowUpdateRequest(definition=new_definition)
    )

    assert updated.current_version_id != v1.id
    version_ns = sorted(v.version_n for v in versions)
    assert version_ns == [1, 2]
    # v1 is immutable: its stored definition is unchanged.
    original = next(v for v in versions if v.version_n == 1)
    assert original.id == v1.id
    assert (
        original.definition_json["agents"][0]["steps"][0]["prompt"]
        == "Fix {{inputs.issue}} on {{inputs.env}}"
    )


async def test_visibility_isolates_owners(db_session: AsyncSession) -> None:
    owner = await make_user(db_session)
    other = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, owner)
    with pytest.raises(CloudApiError) as exc:
        await service.get_workflow_detail(db_session, other, workflow.id)
    assert exc.value.code == "workflow_not_found"
