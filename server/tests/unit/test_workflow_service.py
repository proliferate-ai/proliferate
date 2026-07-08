"""DB-backed workflow service tests: StartRun, cap, delivery/status, immutability."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.server.cloud.workflows import service
from proliferate.utils.crypto import encrypt_json
from proliferate.server.cloud.workflows.models import (
    RunStatusRequest,
    WorkflowCreateRequest,
    WorkflowUpdateRequest,
)

pytestmark = pytest.mark.asyncio


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"wf-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


def _definition() -> dict:
    return {
        "version": 1,
        "inputs": [
            {"name": "issue", "type": "text", "required": True},
            {"name": "env", "type": "choice", "choices": ["prod", "staging"], "default": "staging"},
        ],
        "integrations": ["slack"],
        "agents": [
            {
                "slot": "main",
                "harness": "claude",
                "model": "sonnet",
                "steps": [
                    {"kind": "agent.prompt", "prompt": "Fix {{inputs.issue}} on {{inputs.env}}"},
                    {"kind": "agent.emit", "name": "check", "prompt": "run tests"},
                    {"kind": "notify", "slack_channel_id": "C1", "message": "done {{check.result}}"},
                ],
            }
        ],
    }


async def _seed_ready_account(db: AsyncSession, *, user_id: uuid.UUID, namespace: str) -> None:
    await sync_seed_definitions(db)
    await db.flush()
    definition = await definitions_store.get_seed_by_namespace(db, namespace)
    assert definition is not None
    account = await accounts_store.upsert_account(
        db, user_id=user_id, definition_id=definition.id, auth_kind="api_key", status="ready"
    )
    await accounts_store.set_account_credentials(
        db,
        account_id=account.id,
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "s"}}),
        credential_format="secret-fields-v1",
        auth_status="ready",
        token_expires_at=None,
    )


async def _create_workflow(db: AsyncSession, user: User, *, name: str = "Fix-it"):
    # The definition declares integrations (["slack"]); save-time L22
    # (visible_provider_namespaces) needs the seed definitions synced, and
    # StartRun-time L22 fail-fast (assert_declared_providers_ready) needs a
    # ready account for each declared namespace — mirror test_workflow_run_gateway.py.
    await _seed_ready_account(db, user_id=user.id, namespace="slack")
    return await service.create_workflow(
        db, user, WorkflowCreateRequest(name=name, definition=_definition())
    )


async def test_create_workflow_pins_version_one(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, versions = await _create_workflow(db_session, user)
    assert workflow.current_version_id == versions[0].id
    assert versions[0].version_n == 1
    assert workflow.owner_user_id == user.id


async def test_free_plan_cap_enforced_and_archive_frees_slot(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user, name="one")

    with pytest.raises(CloudApiError) as exc:
        await _create_workflow(db_session, user, name="two")
    assert exc.value.code == "workflow_limit_reached"
    assert exc.value.status_code == 403

    await service.archive_workflow(db_session, user, workflow.id)
    # Slot is now free.
    _, versions = await _create_workflow(db_session, user, name="two")
    assert versions[0].version_n == 1


async def test_update_creates_new_version_and_preserves_old(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, versions_v1 = await _create_workflow(db_session, user)
    v1 = versions_v1[0]

    new_definition = _definition()
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
    assert original.definition_json["agents"][0]["steps"][0]["prompt"] == "Fix {{inputs.issue}} on {{inputs.env}}"


async def test_start_run_resolves_plan_and_records_pending_delivery(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)

    run = await service.start_run(
        db_session,
        user,
        workflow.id,
        inputs={"issue": "PROJ-9", "env": "prod"},
        target_mode="local",
    )

    assert run.status == "pending_delivery"
    assert run.trigger_kind == "manual"
    assert run.executor_user_id == user.id
    assert run.args_json == {"issue": "PROJ-9", "env": "prod"}
    plan = run.resolved_plan_json
    assert plan["run_id"] == str(run.id)
    assert plan["steps"][0]["prompt"] == "Fix PROJ-9 on prod"
    # Step-output references stay late-bound for the runtime.
    assert plan["steps"][2]["message"] == "done {{steps[1].output.result}}"
    assert plan["sessions"]["main"]["harness"] == "claude"


async def test_start_run_rejects_missing_required_arg(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(db_session, user, workflow.id, inputs={}, target_mode="local")
    assert exc.value.code == "missing_argument"


async def test_start_run_rejects_bad_target_mode(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(
            db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="shared_cloud"
        )
    assert exc.value.code == "invalid_target_mode"


async def test_delivery_then_status_lifecycle(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    run = await service.start_run(
        db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
    )

    delivered = await service.mark_run_delivered(db_session, user, run.id)
    assert delivered.status == "delivered"
    assert delivered.delivered_at is not None

    # Delivery is idempotent.
    again = await service.mark_run_delivered(db_session, user, run.id)
    assert again.status == "delivered"
    assert again.delivered_at == delivered.delivered_at

    running = await service.report_run_status(
        db_session, user, run.id, RunStatusRequest(status="running", stepCursor=0)
    )
    assert running.status == "running"
    assert running.started_at is not None

    completed = await service.report_run_status(
        db_session, user, run.id, RunStatusRequest(status="completed", stepCursor=2)
    )
    assert completed.status == "completed"
    assert completed.finished_at is not None
    assert completed.step_cursor == 2


async def test_status_guard_rejects_illegal_transition(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    run = await service.start_run(
        db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
    )
    # pending_delivery -> running is not a legal observed transition.
    with pytest.raises(CloudApiError) as exc:
        await service.report_run_status(
            db_session, user, run.id, RunStatusRequest(status="running")
        )
    assert exc.value.code == "illegal_run_transition"
    assert exc.value.status_code == 409


async def test_status_rejects_reports_after_terminal(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    run = await service.start_run(
        db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
    )
    await service.mark_run_delivered(db_session, user, run.id)
    await service.report_run_status(db_session, user, run.id, RunStatusRequest(status="running"))
    await service.report_run_status(db_session, user, run.id, RunStatusRequest(status="failed"))
    with pytest.raises(CloudApiError) as exc:
        await service.report_run_status(
            db_session, user, run.id, RunStatusRequest(status="running")
        )
    assert exc.value.code == "run_already_terminal"


async def test_cannot_run_archived_workflow(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    await service.archive_workflow(db_session, user, workflow.id)
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(
            db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
        )
    assert exc.value.code == "workflow_archived"


async def test_visibility_isolates_owners(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    other = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, owner)
    with pytest.raises(CloudApiError) as exc:
        await service.get_workflow_detail(db_session, other, workflow.id)
    assert exc.value.code == "workflow_not_found"
