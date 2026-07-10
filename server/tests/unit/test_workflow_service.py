"""DB-backed workflow service tests: StartRun, cap, delivery/status, immutability."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_TRIGGER_MANUAL
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workflows as store
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
    # Wave 2b: the resolved plan carries run isolation; default is "workspace"
    # (run in the pinned checkout as-is). This is the cross-language contract the
    # runtime parses into `plan.rs::Isolation` — an absent field there means the
    # same "workspace", so producer + consumer agree.
    assert plan["isolation"] == "workspace"


def _definition_with_notify_fields() -> dict:
    """A single-slot workflow whose notify uses agent-filled {{fields.*}}."""
    definition = _definition()
    notify = definition["agents"][0]["steps"][2]
    notify["message"] = "done {{check.result}} — {{fields.summary}} (risk {{fields.risk}})"
    notify["agent_fields"] = {
        "slot": "main",
        "schema": {
            "summary": {"type": "string", "description": "one-liner"},
            "risk": {"type": "number"},
        },
    }
    return definition


async def test_notify_agent_fields_expands_to_injected_emit(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    await _seed_ready_account(db_session, user_id=user.id, namespace="slack")
    workflow, _ = await service.create_workflow(
        db_session,
        user,
        WorkflowCreateRequest(name="notify-fields", definition=_definition_with_notify_fields()),
    )

    run = await service.start_run(
        db_session,
        user,
        workflow.id,
        inputs={"issue": "PROJ-1", "env": "prod"},
        target_mode="local",
    )
    steps = run.resolved_plan_json["steps"]
    # 3 authored steps → 4 resolved (an injected agent.emit precedes the notify).
    assert [s["kind"] for s in steps] == [
        "agent.prompt",
        "agent.emit",
        "agent.emit",  # injected notify-fields emit
        "notify",
    ]
    injected = steps[2]
    assert injected["slot"] == "main"
    assert injected["key"] == "0.-.2.notify_fields"
    # It reuses the emit machinery: schema + re-ask budget, no `name` on the wire.
    # (JSONB does not preserve object key order, so compare as sets.)
    assert set(injected["output_schema"]["required"]) == {"summary", "risk"}
    assert injected["output_schema"]["additionalProperties"] is False
    assert injected["output_schema"]["properties"]["risk"] == {"type": "number"}
    assert injected["max_attempts"] == 3
    assert "name" not in injected
    assert "agent_fields" not in injected
    # The notify keeps its structured key and its agent_fields is stripped.
    notify = steps[3]
    assert notify["key"] == "0.-.2"
    assert "agent_fields" not in notify
    # {{fields.*}} late-bind to the injected emit (index 2); the prior named emit
    # ref ({{check.result}}) still points at its own index (1).
    assert notify["message"] == (
        "done {{steps[1].output.result}} — "
        "{{steps[2].output.summary}} (risk {{steps[2].output.risk}})"
    )


async def test_template_only_notify_resolves_unchanged(db_session: AsyncSession) -> None:
    # DENY-PATH (e) regression: a notify with no agent_fields resolves exactly as
    # before — no injected step, byte-identical late-bound message.
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    run = await service.start_run(
        db_session, user, workflow.id, inputs={"issue": "X", "env": "prod"}, target_mode="local"
    )
    steps = run.resolved_plan_json["steps"]
    assert [s["kind"] for s in steps] == ["agent.prompt", "agent.emit", "notify"]
    assert steps[2]["message"] == "done {{steps[1].output.result}}"
    assert "agent_fields" not in steps[2]


def _parallel_definition() -> dict:
    """A standalone node, a 2-lane parallel group, then a joining node. No
    integrations, so no ready-account seeding is needed to start a run."""
    return {
        "version": 1,
        "inputs": [{"name": "issue", "type": "text", "required": True}],
        "integrations": [],
        "agents": [
            {
                "slot": "plan",
                "harness": "claude",
                "model": "sonnet",
                "steps": [
                    {"kind": "agent.emit", "name": "spec", "prompt": "plan {{inputs.issue}}"}
                ],
            },
            {
                "parallel": [
                    {
                        "slot": "fix_a",
                        "harness": "claude",
                        "model": "sonnet",
                        "steps": [
                            {"kind": "agent.prompt", "prompt": "impl {{spec.summary}}"},
                            {"kind": "agent.emit", "name": "result_a", "prompt": "report"},
                        ],
                    },
                    {
                        "slot": "fix_b",
                        "harness": "codex",
                        "model": "gpt-5",
                        "steps": [{"kind": "shell.run", "command": "make test"}],
                    },
                ]
            },
            {
                "slot": "merge",
                "harness": "claude",
                "model": "sonnet",
                "steps": [
                    {
                        "kind": "notify",
                        "slack_channel_id": "C1",
                        "message": "done {{result_a.ok}}",
                    }
                ],
            },
        ],
    }


async def test_start_run_resolves_parallel_group_keys_and_order(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="parallel", definition=_parallel_definition())
    )
    # Parallel is cloud-only in v1 (M1) — run against a cloud workspace.
    workspace = await _make_ready_cloud_workspace(db_session, user)
    run = await service.start_run(
        db_session,
        user,
        workflow.id,
        inputs={"issue": "PROJ-1"},
        target_mode="personal_cloud",
        target_workspace_id=workspace.id,
    )
    plan = run.resolved_plan_json

    # Lane-qualified keys: standalone entries keep lane "-"; group lanes carry the
    # slot as the lane segment. Group lanes emit lane-grouped in lane order.
    assert [s["key"] for s in plan["steps"]] == [
        "0.-.0",  # plan.spec
        "1.fix_a.0",  # lane fix_a step 0
        "1.fix_a.1",  # lane fix_a step 1 (result_a emit)
        "1.fix_b.0",  # lane fix_b step 0
        "2.-.0",  # merge.notify
    ]
    assert [s["slot"] for s in plan["steps"]] == ["plan", "fix_a", "fix_a", "fix_b", "merge"]

    # sessions map gains every lane slot exactly like a flat slot.
    assert set(plan["sessions"]) == {"plan", "fix_a", "fix_b", "merge"}
    assert plan["sessions"]["fix_b"]["harness"] == "codex"

    # Emit refs rewrite to the flat runtime-indexed form. `spec` is flat index 0;
    # `result_a` is flat index 2 (its emit is the 3rd step in flatten order).
    assert plan["steps"][1]["prompt"] == "impl {{steps[0].output.summary}}"
    assert plan["steps"][4]["message"] == "done {{steps[2].output.ok}}"
    assert plan["inputs"] == {"issue": "PROJ-1"}


async def test_start_run_flat_definition_keys_unchanged(db_session: AsyncSession) -> None:
    # Regression / deny-path: a flat (no-parallel) definition resolves to the same
    # "<node>.-.<step>" keys it always has — byte-identical to before lanes landed.
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    run = await service.start_run(
        db_session, user, workflow.id, inputs={"issue": "x", "env": "prod"}, target_mode="local"
    )
    keys = [s["key"] for s in run.resolved_plan_json["steps"]]
    assert keys == ["0.-.0", "0.-.1", "0.-.2"]


# --- M1 (L30): v1 parallel isolation bounds ------------------------------------


async def test_resolve_run_isolation_parallel_forces_worktree() -> None:
    # A parallel definition ALWAYS resolves to worktree isolation — even with a
    # lone session_binding that would otherwise force workspace (moot in practice
    # since parallel+bindings is rejected upstream, but the invariant is asserted).
    assert (
        service._resolve_run_isolation(
            target_mode="personal_cloud",
            session_bindings={"main": "sess-x"},
            definition_has_parallel=True,
        )
        == "worktree"
    )
    # Flat cloud run: worktree by the 2b default.
    assert (
        service._resolve_run_isolation(
            target_mode="personal_cloud",
            session_bindings=None,
            definition_has_parallel=False,
        )
        == "worktree"
    )
    # Flat bound run: workspace (2b exception, unchanged).
    assert (
        service._resolve_run_isolation(
            target_mode="personal_cloud",
            session_bindings={"main": "sess-x"},
            definition_has_parallel=False,
        )
        == "workspace"
    )


async def test_start_run_rejects_parallel_on_local_target(db_session: AsyncSession) -> None:
    # (b) Parallel groups are cloud-only in v1: a local (desktop) target run is
    # rejected up front (the desktop executor doesn't understand lanes).
    user = await _make_user(db_session)
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="parallel", definition=_parallel_definition())
    )
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(
            db_session, user, workflow.id, inputs={"issue": "x"}, target_mode="local"
        )
    assert exc.value.code == "parallel_local_unsupported"


async def _make_ready_cloud_workspace(db: AsyncSession, user: User) -> "CloudWorkspace":
    repo_config = RepoConfig(
        user_id=user.id,
        git_provider="github",
        git_owner="acme",
        git_repo_name="widgets",
    )
    db.add(repo_config)
    await db.flush()
    repo_environment = RepoEnvironment(
        repo_config_id=repo_config.id, environment_kind="cloud", local_path=None
    )
    db.add(repo_environment)
    await db.flush()
    workspace = CloudWorkspace(
        owner_user_id=user.id,
        repo_environment_id=repo_environment.id,
        display_name="widgets",
        git_branch="feature/x",
        anyharness_workspace_id="ws-cloud",
    )
    db.add(workspace)
    await db.flush()
    return workspace


async def test_start_run_rejects_parallel_with_session_bindings(db_session: AsyncSession) -> None:
    # (a) A bound session lives in the pinned checkout and can't be isolated into a
    # lane worktree — so a laned run rejects session_bindings. Cloud target (local
    # is rejected first by the parallel_local rule).
    user = await _make_user(db_session)
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="parallel", definition=_parallel_definition())
    )
    workspace = await _make_ready_cloud_workspace(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(
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
    # A parallel cloud run (no bindings) resolves isolation=worktree — mandatory
    # for per-lane worktrees.
    user = await _make_user(db_session)
    workflow, _ = await service.create_workflow(
        db_session, user, WorkflowCreateRequest(name="parallel", definition=_parallel_definition())
    )
    workspace = await _make_ready_cloud_workspace(db_session, user)
    run = await service.start_run(
        db_session,
        user,
        workflow.id,
        inputs={"issue": "x"},
        target_mode="personal_cloud",
        target_workspace_id=workspace.id,
    )
    assert run.resolved_plan_json["isolation"] == "worktree"


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


async def _seed_run(
    db: AsyncSession,
    user: User,
    workflow,
    *,
    resolved_plan_json: dict,
    anyharness_workspace_id: str | None = None,
    anyharness_session_ids: list[str] | None = None,
    status: str | None = None,
):
    run = await store.create_run(
        db,
        workflow_id=workflow.id,
        workflow_version_id=workflow.current_version_id,
        trigger_kind=WORKFLOW_TRIGGER_MANUAL,
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json=resolved_plan_json,
        anyharness_workspace_id=anyharness_workspace_id,
    )
    if anyharness_session_ids is not None or status is not None:
        await store.update_run(
            db,
            run_id=run.id,
            anyharness_session_ids=anyharness_session_ids,
            status=status,
        )
    return run


async def test_start_run_rejects_binding_held_by_live_run(db_session: AsyncSession) -> None:
    # B8/E8: a session already held by a non-terminal ("live") run cannot be bound
    # to a new run — silently re-owning it would transfer ownership and leak the
    # lockout. The run row is the durable lock, so this is caught server-side.
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    await _seed_run(
        db_session,
        user,
        workflow,
        resolved_plan_json={"sessions": {"main": {"bind_session_id": "sess-held"}}},
    )
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(
            db_session,
            user,
            workflow.id,
            inputs={"issue": "x"},
            target_mode="local",
            session_bindings={"main": "sess-held"},
        )
    assert exc.value.code == "session_binding_held"


async def test_start_run_rejects_binding_slot_not_in_workflow(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(
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
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    # A session a live run created (reported in anyharness_session_ids) is held.
    await _seed_run(
        db_session,
        user,
        workflow,
        resolved_plan_json={"sessions": {"main": {}}},
        anyharness_session_ids=["sess-created"],
    )
    assert await store.live_run_holding_session(db_session, session_id="sess-created") is not None
    assert await store.live_run_holding_session(db_session, session_id="sess-none") is None


async def test_session_foreign_workspace_flags_cross_workspace(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, user)
    await _seed_run(
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


async def test_visibility_isolates_owners(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    other = await _make_user(db_session)
    workflow, _ = await _create_workflow(db_session, owner)
    with pytest.raises(CloudApiError) as exc:
        await service.get_workflow_detail(db_session, other, workflow.id)
    assert exc.value.code == "workflow_not_found"
