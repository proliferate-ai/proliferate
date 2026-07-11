"""StartRun compilation + delivery/status lifecycle + bindings + functions grant.

Split out of ``test_workflow_service.py`` (which kept workflow CRUD/visibility);
shared row/definition factories live in ``workflow_run_helpers``.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_workflows as store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import compiler, service
from proliferate.server.cloud.workflows.models import RunStatusRequest, WorkflowCreateRequest
from proliferate.server.cloud.workflows.worker import service as worker_service
from tests.unit.workflow_run_helpers import (
    create_workflow,
    definition_with_notify_fields,
    functions_definition,
    make_ready_cloud_workspace,
    make_user,
    parallel_definition,
    seed_ready_account,
    seed_run,
)

pytestmark = pytest.mark.asyncio


async def test_start_run_resolves_plan_and_records_pending_delivery(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)

    run = await compiler.start_run(
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
    assert plan["isolation"] == "workspace"


async def test_notify_agent_fields_expands_to_injected_emit(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    await seed_ready_account(db_session, user_id=user.id, namespace="slack")
    workflow, _ = await service.create_workflow(
        db_session,
        user,
        WorkflowCreateRequest(name="notify-fields", definition=definition_with_notify_fields()),
    )

    run = await compiler.start_run(
        db_session,
        user,
        workflow.id,
        inputs={"issue": "PROJ-1", "env": "prod"},
        target_mode="local",
    )
    steps = run.resolved_plan_json["steps"]
    assert [s["kind"] for s in steps] == [
        "agent.prompt",
        "agent.emit",
        "agent.emit",  # injected notify-fields emit
        "notify",
    ]
    injected = steps[2]
    assert injected["slot"] == "main"
    assert injected["key"] == "0.-.2.notify_fields"
    assert set(injected["output_schema"]["required"]) == {"summary", "risk"}
    assert injected["output_schema"]["additionalProperties"] is False
    assert injected["output_schema"]["properties"]["risk"] == {"type": "number"}
    assert injected["max_attempts"] == 3
    assert "name" not in injected
    assert "agent_fields" not in injected
    notify = steps[3]
    assert notify["key"] == "0.-.2"
    assert "agent_fields" not in notify
    assert notify["message"] == (
        "done {{steps[1].output.result}} — "
        "{{steps[2].output.summary}} (risk {{steps[2].output.risk}})"
    )


async def test_template_only_notify_resolves_unchanged(db_session: AsyncSession) -> None:
    # DENY-PATH (e) regression: a notify with no agent_fields resolves exactly as
    # before — no injected step, byte-identical late-bound message.
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    run = await compiler.start_run(
        db_session, user, workflow.id, inputs={"issue": "X", "env": "prod"}, target_mode="local"
    )
    steps = run.resolved_plan_json["steps"]
    assert [s["kind"] for s in steps] == ["agent.prompt", "agent.emit", "notify"]
    assert steps[2]["message"] == "done {{steps[1].output.result}}"
    assert "agent_fields" not in steps[2]


async def test_start_run_resolves_parallel_group_keys_and_order(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="parallel", definition=parallel_definition())
    )
    # Parallel is cloud-only in v1 (M1) — run against a cloud workspace.
    workspace = await make_ready_cloud_workspace(db_session, user)
    run = await compiler.start_run(
        db_session,
        user,
        workflow.id,
        inputs={"issue": "PROJ-1"},
        target_mode="personal_cloud",
        target_workspace_id=workspace.id,
    )
    plan = run.resolved_plan_json

    assert [s["key"] for s in plan["steps"]] == [
        "0.-.0",  # plan.spec
        "1.fix_a.0",  # lane fix_a step 0
        "1.fix_a.1",  # lane fix_a step 1 (result_a emit)
        "1.fix_b.0",  # lane fix_b step 0
        "2.-.0",  # merge.notify
    ]
    assert [s["slot"] for s in plan["steps"]] == ["plan", "fix_a", "fix_a", "fix_b", "merge"]

    assert set(plan["sessions"]) == {"plan", "fix_a", "fix_b", "merge"}
    assert plan["sessions"]["fix_b"]["harness"] == "codex"

    assert plan["steps"][1]["prompt"] == "impl {{steps[0].output.summary}}"
    assert plan["steps"][4]["message"] == "done {{steps[2].output.ok}}"
    assert plan["inputs"] == {"issue": "PROJ-1"}


async def test_start_run_flat_definition_keys_unchanged(db_session: AsyncSession) -> None:
    # Regression / deny-path: a flat (no-parallel) definition resolves to the same
    # "<node>.-.<step>" keys it always has — byte-identical to before lanes landed.
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    run = await compiler.start_run(
        db_session, user, workflow.id, inputs={"issue": "x", "env": "prod"}, target_mode="local"
    )
    keys = [s["key"] for s in run.resolved_plan_json["steps"]]
    assert keys == ["0.-.0", "0.-.1", "0.-.2"]


# --- M1 (L30): v1 parallel isolation bounds ------------------------------------


async def test_resolve_run_isolation_parallel_forces_worktree() -> None:
    assert (
        compiler._resolve_run_isolation(
            target_mode="personal_cloud",
            session_bindings={"main": "sess-x"},
            definition_has_parallel=True,
        )
        == "worktree"
    )
    assert (
        compiler._resolve_run_isolation(
            target_mode="personal_cloud",
            session_bindings=None,
            definition_has_parallel=False,
        )
        == "worktree"
    )
    assert (
        compiler._resolve_run_isolation(
            target_mode="personal_cloud",
            session_bindings={"main": "sess-x"},
            definition_has_parallel=False,
        )
        == "workspace"
    )


async def test_start_run_rejects_parallel_on_local_target(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="parallel", definition=parallel_definition())
    )
    with pytest.raises(CloudApiError) as exc:
        await compiler.start_run(
            db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
        )
    assert exc.value.code == "parallel_local_unsupported"


async def test_start_run_rejects_parallel_with_session_bindings(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="parallel", definition=parallel_definition())
    )
    workspace = await make_ready_cloud_workspace(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await compiler.start_run(
            db_session,
            user,
            workflow.id,
            inputs={"issue": "x"},
            target_mode="personal_cloud",
            target_workspace_id=workspace.id,
            session_bindings={"fix_a": "sess-x"},
        )
    assert exc.value.code == "parallel_bindings_unsupported"


async def test_start_run_parallel_cloud_resolves_worktree(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="parallel", definition=parallel_definition())
    )
    workspace = await make_ready_cloud_workspace(db_session, user)
    run = await compiler.start_run(
        db_session,
        user,
        workflow.id,
        inputs={"issue": "x"},
        target_mode="personal_cloud",
        target_workspace_id=workspace.id,
    )
    assert run.resolved_plan_json["isolation"] == "worktree"


async def test_start_run_rejects_missing_required_arg(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await compiler.start_run(db_session, user, workflow.id, inputs={}, target_mode="local")
    assert exc.value.code == "missing_argument"


async def test_start_run_rejects_bad_target_mode(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await compiler.start_run(
            db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="shared_cloud"
        )
    assert exc.value.code == "invalid_target_mode"


async def test_delivery_then_status_lifecycle(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    run = await compiler.start_run(
        db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
    )

    delivered = await worker_service.mark_run_delivered(db_session, user, run.id)
    assert delivered.status == "delivered"
    assert delivered.delivered_at is not None

    # Delivery is idempotent.
    again = await worker_service.mark_run_delivered(db_session, user, run.id)
    assert again.status == "delivered"
    assert again.delivered_at == delivered.delivered_at

    running = await worker_service.report_run_status(
        db_session, user, run.id, RunStatusRequest(status="running", stepCursor=0)
    )
    assert running.status == "running"
    assert running.started_at is not None

    completed = await worker_service.report_run_status(
        db_session, user, run.id, RunStatusRequest(status="completed", stepCursor=2)
    )
    assert completed.status == "completed"
    assert completed.finished_at is not None
    assert completed.step_cursor == 2


async def test_status_guard_rejects_illegal_transition(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    run = await compiler.start_run(
        db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
    )
    # pending_delivery -> running is not a legal observed transition.
    with pytest.raises(CloudApiError) as exc:
        await worker_service.report_run_status(
            db_session, user, run.id, RunStatusRequest(status="running")
        )
    assert exc.value.code == "illegal_run_transition"
    assert exc.value.status_code == 409


async def test_status_rejects_reports_after_terminal(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    run = await compiler.start_run(
        db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
    )
    await worker_service.mark_run_delivered(db_session, user, run.id)
    await worker_service.report_run_status(
        db_session, user, run.id, RunStatusRequest(status="running")
    )
    await worker_service.report_run_status(
        db_session, user, run.id, RunStatusRequest(status="failed")
    )
    with pytest.raises(CloudApiError) as exc:
        await worker_service.report_run_status(
            db_session, user, run.id, RunStatusRequest(status="running")
        )
    assert exc.value.code == "run_already_terminal"


async def test_cannot_run_archived_workflow(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    await service.archive_workflow(db_session, user, workflow.id)
    with pytest.raises(CloudApiError) as exc:
        await compiler.start_run(
            db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
        )
    assert exc.value.code == "workflow_archived"


async def test_start_run_rejects_binding_held_by_live_run(db_session: AsyncSession) -> None:
    # B8/E8: a session already held by a non-terminal ("live") run cannot be bound
    # to a new run — silently re-owning it would transfer ownership and leak the
    # lockout. The run row is the durable lock, so this is caught server-side.
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    await seed_run(
        db_session,
        user,
        workflow,
        resolved_plan_json={"sessions": {"main": {"bind_session_id": "sess-held"}}},
    )
    with pytest.raises(CloudApiError) as exc:
        await compiler.start_run(
            db_session,
            user,
            workflow.id,
            inputs={"issue": "x"},
            target_mode="local",
            session_bindings={"main": "sess-held"},
        )
    assert exc.value.code == "session_binding_held"


async def test_start_run_rejects_binding_slot_not_in_workflow(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await compiler.start_run(
            db_session,
            user,
            workflow.id,
            inputs={"issue": "x"},
            target_mode="local",
            session_bindings={"ghost": "sess-x"},
        )
    assert exc.value.code == "unknown_session_binding_slot"


async def test_live_run_holding_session_detects_created_and_bound(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    # A session a live run created (reported in anyharness_session_ids) is held.
    await seed_run(
        db_session,
        user,
        workflow,
        resolved_plan_json={"sessions": {"main": {}}},
        anyharness_session_ids=["sess-created"],
    )
    assert await store.live_run_holding_session(db_session, session_id="sess-created") is not None
    assert await store.live_run_holding_session(db_session, session_id="sess-none") is None


async def test_session_foreign_workspace_flags_cross_workspace(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    workflow, _ = await create_workflow(db_session, user)
    await seed_run(
        db_session,
        user,
        workflow,
        resolved_plan_json={"sessions": {"main": {}}},
        anyharness_workspace_id="ws-A",
        anyharness_session_ids=["sess-1"],
    )
    # Belongs to ws-A: targeting ws-B is a conflict; targeting ws-A is fine.
    assert (
        await store.session_foreign_workspace(
            db_session, session_id="sess-1", target_workspace_id="ws-B"
        )
        == "ws-A"
    )
    assert (
        await store.session_foreign_workspace(
            db_session, session_id="sess-1", target_workspace_id="ws-A"
        )
        is None
    )
    # A session with no run history is unknown server-side (runtime backstop).
    assert (
        await store.session_foreign_workspace(
            db_session, session_id="sess-unknown", target_workspace_id="ws-B"
        )
        is None
    )


# --- the reserved `functions` namespace grant (track 1b end-to-end wiring) ------


async def test_functions_namespace_grantable_with_live_invocation(
    db_session: AsyncSession,
) -> None:
    """A workflow may grant the reserved `functions` virtual provider when the
    owner has ≥1 live invocation — save-time visibility AND the L22 StartRun
    readiness gate both accept it (no integration account exists for it)."""
    from proliferate.db.store import function_invocations as invocations_store

    user = await make_user(db_session)
    await invocations_store.create(
        db_session,
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        name="lookup_ticket",
        endpoint_url="https://functions.test/lookup",
        method="post",
        args_schema_json={"type": "object", "properties": {"id": {"type": "string"}}},
    )
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="fn-flow", definition=functions_definition())
    )
    run = await compiler.start_run(
        db_session,
        user,
        workflow.id,
        inputs={"issue": "X"},
        target_mode="local",
    )
    # WS2b: the gateway block lives in the private envelope, not the logical plan.
    gateway = (run.private_envelope_json or {}).get("gateway") or {}
    assert gateway.get("integrations") == ["functions"]


async def test_functions_namespace_rejected_without_invocations(
    db_session: AsyncSession,
) -> None:
    """Deny-path floor: with zero live invocations the grant is refused at
    save time (unknown provider), so a stale definition can't mint a
    functions-scoped token that reaches nothing."""
    user = await make_user(db_session)
    with pytest.raises(CloudApiError) as exc:
        await service.create_workflow(
            db_session,
            user,
            WorkflowCreateRequest(name="fn-flow", definition=functions_definition()),
        )
    assert exc.value.code == "workflow_function_provider_unknown"


async def test_functions_readiness_gate_at_start_run(db_session: AsyncSession) -> None:
    """L22 at StartRun: the owner archives their last invocation after saving
    the workflow — the run is refused with the enumerated not-ready code, never
    silently narrowed."""
    from proliferate.db.store import function_invocations as invocations_store

    user = await make_user(db_session)
    await invocations_store.create(
        db_session,
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        name="lookup_ticket",
        endpoint_url="https://functions.test/lookup",
        method="post",
        args_schema_json={"type": "object"},
    )
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="fn-flow", definition=functions_definition())
    )
    assert await invocations_store.archive(db_session, owner_user_id=user.id, name="lookup_ticket")
    with pytest.raises(CloudApiError) as exc:
        await compiler.start_run(
            db_session,
            user,
            workflow.id,
            inputs={"issue": "X"},
            target_mode="local",
        )
    assert exc.value.code == "workflow_function_provider_not_ready"
    assert exc.value.status_code == 409
