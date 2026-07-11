"""Poll-trigger local workspace identity tests."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.server.cloud.workflows import poller as poller_module
from proliferate.server.cloud.workflows.models import (
    WorkflowTriggerResponse,
    WorkflowTriggerUpdateRequest,
    trigger_payload,
)
from proliferate.server.cloud.workflows.triggers import update_trigger
from tests.unit.test_workflow_poll import (
    _Actor,
    _LOCAL_WORKSPACE_ID,
    _factory,
    _item,
    _make_ready_cloud_workspace,
    _make_user,
    _make_workflow,
    _page,
    _poll_body,
    _service_create,
)
from proliferate.utils.time import utcnow

pytestmark = pytest.mark.asyncio


async def test_poll_trigger_accepts_local_target(test_engine) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        workflow = await _make_workflow(db, user)
        await db.commit()
        actor = _Actor(user.id)
        page = _page([_item("probe_local", n=1, title="ok")])
        with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=page)):
            record = await _service_create(db, actor, workflow.id, _poll_body(targetMode="local"))
        due = await trigger_store.claim_due_poll_trigger(db, trigger_id=record.id, now=utcnow())
        assert due is not None and due.local_workspace_id == _LOCAL_WORKSPACE_ID

    assert record.target_mode == "local"
    assert record.target_workspace_id is None
    assert record.local_workspace_id == _LOCAL_WORKSPACE_ID
    wire = trigger_payload(record).model_dump(by_alias=True)
    assert wire["localWorkspaceId"] == str(_LOCAL_WORKSPACE_ID)
    assert WorkflowTriggerResponse.model_validate(wire).local_workspace_id == str(
        _LOCAL_WORKSPACE_ID
    )


async def test_local_poll_edit_preserves_workspace_and_transitions_both_ways(
    test_engine,
) -> None:  # type: ignore[no-untyped-def]
    factory = _factory(test_engine)
    async with factory() as db:
        user = await _make_user(db)
        workflow = await _make_workflow(db, user)
        await db.commit()
        actor = _Actor(user.id)
        page = _page([_item("probe_transition", n=1, title="ok")])
        with patch.object(poller_module, "fetch_poll_page", new=AsyncMock(return_value=page)):
            local = await _service_create(db, actor, workflow.id, _poll_body(targetMode="local"))

        untouched = await update_trigger(
            db,
            actor,
            workflow.id,
            local.id,
            WorkflowTriggerUpdateRequest.model_validate({"concurrencyPolicy": "skip"}),
        )
        assert untouched.local_workspace_id == _LOCAL_WORKSPACE_ID
        assert untouched.target_workspace_id is None

        workspace = await _make_ready_cloud_workspace(db, user)
        cloud = await update_trigger(
            db,
            actor,
            workflow.id,
            local.id,
            WorkflowTriggerUpdateRequest.model_validate({"targetMode": "personal_cloud"}),
        )
        assert cloud.target_workspace_id == workspace.id
        assert cloud.local_workspace_id is None

        repinned = uuid.uuid4()
        local_again = await update_trigger(
            db,
            actor,
            workflow.id,
            local.id,
            WorkflowTriggerUpdateRequest.model_validate(
                {"targetMode": "local", "localWorkspaceId": str(repinned)}
            ),
        )
        assert local_again.target_workspace_id is None
        assert local_again.local_workspace_id == repinned
