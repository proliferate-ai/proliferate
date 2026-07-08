"""Workflow composition by resolution-time inlining (spec 3.5 / L20), format v2.

``workflow.include`` is a definition-only step living inside an agent node's step
list: the server's plan resolver splices the target workflow's CURRENT version's
(single agent node's) steps into that node before the flatten pass, at StartRun,
before delivery. The runtime never sees an include step (the L20 property,
asserted below). Composition operates purely on the v2 named-ref grammar
(``{{inputs.*}}`` / ``{{<emit>.<field>}}``); the flatten pass then assigns
structured keys and rewrites emit names to the runtime's indexed
``{{steps[n].output.<field>}}`` form. These are tier-1 tests: a real DB (the
"current version" guarantee lives there) via the ``db_session`` fixture.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store import cloud_workflows as store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import service
from proliferate.server.cloud.workflows.domain.composition import (
    WorkflowCompositionError,
    validate_includes,
)
from proliferate.server.cloud.workflows.domain.definition import parse_definition

pytestmark = pytest.mark.asyncio


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"inc-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


def _prompt(prompt: str) -> dict:
    return {"kind": "agent.prompt", "prompt": prompt}


def _emit(name: str, prompt: str) -> dict:
    return {"kind": "agent.emit", "name": name, "prompt": prompt}


def _include(workflow_id, *, args: dict | None = None, name: str | None = None) -> dict:
    step: dict = {"kind": "workflow.include", "workflow_id": str(workflow_id), "args": args or {}}
    if name is not None:
        step["name"] = name
    return step


def _agent(steps: list[dict], *, slot: str = "main") -> dict:
    return {"slot": slot, "harness": "claude", "model": "sonnet", "steps": steps}


def _definition(steps: list[dict], *, inputs: list[dict] | None = None) -> dict:
    return {
        "version": 1,
        "inputs": inputs or [],
        "integrations": [],
        "agents": [_agent(steps)],
    }


def _multi_agent_definition() -> dict:
    return {
        "version": 1,
        "inputs": [],
        "integrations": [],
        "agents": [
            _agent([_prompt("a")], slot="lane_a"),
            _agent([_prompt("b")], slot="lane_b"),
        ],
    }


async def _store_workflow(
    db: AsyncSession, owner: User, definition: dict, *, name: str
) -> store.WorkflowRecord:
    """Create a workflow with a canonical (validated) definition, bypassing the cap.

    The service enforces a 1-workflow free-plan cap; composition needs several, so
    tests seed them directly through the store with parse-normalized definitions.
    """

    canonical, _specs = parse_definition(definition, require_steps=False)
    workflow, _version = await store.create_workflow_with_version(
        db,
        owner_user_id=owner.id,
        created_by_user_id=owner.id,
        name=name,
        description=None,
        definition_json=canonical,
    )
    return workflow


async def _run_steps(db: AsyncSession, user: User, workflow_id, inputs: dict) -> list[dict]:
    run = await service.start_run(
        db, user, workflow_id, inputs=inputs, target_mode="local"
    )
    return run.resolved_plan_json["steps"]


# --- simple inline -------------------------------------------------------------


async def test_simple_inline_places_child_steps_at_offset(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    child = await _store_workflow(
        db_session, user, _definition([_prompt("child one"), _prompt("child two")]), name="child"
    )
    parent = await _store_workflow(
        db_session,
        user,
        _definition([_prompt("parent head"), _include(child.id), _prompt("parent tail")]),
        name="parent",
    )

    steps = await _run_steps(db_session, user, parent.id, {})
    assert [s["kind"] for s in steps] == ["agent.prompt"] * 4
    assert [s["prompt"] for s in steps] == [
        "parent head",
        "child one",
        "child two",
        "parent tail",
    ]
    # All spliced steps run in the parent node's slot.
    assert all(s["slot"] == "main" for s in steps)


async def test_resolved_plan_has_no_include_steps(db_session: AsyncSession) -> None:
    """L20 property: the runtime never receives a workflow.include step."""

    user = await _make_user(db_session)
    child = await _store_workflow(db_session, user, _definition([_prompt("c")]), name="child")
    parent = await _store_workflow(
        db_session, user, _definition([_include(child.id), _prompt("p")]), name="parent"
    )
    steps = await _run_steps(db_session, user, parent.id, {})
    assert all(s["kind"] != "workflow.include" for s in steps)


# --- arg binding ---------------------------------------------------------------


async def test_arg_binding_from_mapping_parent_input_and_emit_ref(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    child = await _store_workflow(
        db_session,
        user,
        _definition(
            [_prompt("do {{inputs.task}} with {{inputs.ctx}}")],
            inputs=[
                {"name": "task", "type": "text", "required": True},
                {"name": "ctx", "type": "text", "required": True},
            ],
        ),
        name="child",
    )
    parent = await _store_workflow(
        db_session,
        user,
        _definition(
            [
                _emit("head", "summarize"),
                # mapping value 1 = a parent-input ref (eager-resolved);
                # mapping value 2 = a parent emit ref (rewritten to indexed form).
                _include(
                    child.id,
                    args={"task": "{{inputs.goal}}", "ctx": "{{head.summary}}"},
                ),
            ],
            inputs=[{"name": "goal", "type": "text", "required": True}],
        ),
        name="parent",
    )

    steps = await _run_steps(db_session, user, parent.id, {"goal": "ship it"})
    # {{inputs.goal}} resolved by the eager pass; the parent emit ref survives as
    # the runtime's indexed form pointing at head (flat index 0).
    assert steps[1]["prompt"] == "do ship it with {{steps[0].output.summary}}"


async def test_uncovered_optional_child_input_uses_default(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    child = await _store_workflow(
        db_session,
        user,
        _definition(
            [_prompt("run in {{inputs.mode}}")],
            inputs=[{"name": "mode", "type": "text", "default": "fast"}],
        ),
        name="child",
    )
    parent = await _store_workflow(
        db_session, user, _definition([_include(child.id)]), name="parent"
    )
    steps = await _run_steps(db_session, user, parent.id, {})
    assert steps[0]["prompt"] == "run in fast"


# --- emit-ref namespacing ------------------------------------------------------


async def test_child_internal_emit_refs_survive_splice(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    child = await _store_workflow(
        db_session,
        user,
        _definition([_emit("build", "build it"), _prompt("ref {{build.result}}")]),
        name="child",
    )
    parent = await _store_workflow(
        db_session,
        user,
        _definition([_prompt("p0"), _prompt("p1"), _include(child.id)]),
        name="parent",
    )
    steps = await _run_steps(db_session, user, parent.id, {})
    # child block starts at flat index 2; the emit lands there and the ref points
    # at it once the flatten pass rewrites the (prefixed) name to an index.
    assert steps[2]["name"] == "w2_build"
    assert steps[3]["prompt"] == "ref {{steps[2].output.result}}"


async def test_parent_emit_ref_after_include_still_resolves(db_session: AsyncSession) -> None:
    """A parent emit ref placed after an include resolves to the emit's flat index."""

    user = await _make_user(db_session)
    child = await _store_workflow(
        db_session, user, _definition([_prompt("c0"), _prompt("c1")]), name="child"
    )
    parent = await _store_workflow(
        db_session,
        user,
        _definition(
            [_emit("out", "produce"), _include(child.id), _prompt("tail {{out.val}}")]
        ),
        name="parent",
    )
    steps = await _run_steps(db_session, user, parent.id, {})
    # flat plan: [emit out(0), c0(1), c1(2), tail(3)]; the ref still points at out(0).
    assert [s["prompt"] for s in steps] == [
        "produce",
        "c0",
        "c1",
        "tail {{steps[0].output.val}}",
    ]


# --- nested include ------------------------------------------------------------


async def test_nested_include_double_prefix(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    grand = await _store_workflow(
        db_session,
        user,
        _definition([_emit("g", "gc"), _prompt("gref {{g.v}}")]),
        name="grand",
    )
    mid = await _store_workflow(
        db_session,
        user,
        _definition([_prompt("mid head"), _include(grand.id)]),
        name="mid",
    )
    top = await _store_workflow(
        db_session,
        user,
        _definition([_prompt("top head"), _prompt("top head2"), _include(mid.id)]),
        name="top",
    )
    steps = await _run_steps(db_session, user, top.id, {})
    # flat: [top0, top1, mid_head(2), grand_emit(3), grand_ref(4)]
    assert len(steps) == 5
    # grand's emit is prefixed twice (w1 inside mid, then w2 inside top) and lands
    # at flat index 3; its internal ref rewrites to that index.
    assert steps[3]["name"] == "w2_w1_g"
    assert steps[4]["prompt"] == "gref {{steps[3].output.v}}"
    assert all(s["kind"] != "workflow.include" for s in steps)


# --- multi-agent include target rejected (v2, A3/PROPOSED) ---------------------


async def test_multi_agent_child_rejected_at_save(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    child = await _store_workflow(
        db_session, user, _multi_agent_definition(), name="child"
    )
    agents = [_agent([_include(child.id)])]
    with pytest.raises(WorkflowCompositionError) as exc:
        await validate_includes(
            db_session, owner_user_id=user.id, workflow_id=None, agents=agents
        )
    assert exc.value.code == "include_multi_agent"


async def test_multi_agent_child_rejected_at_resolution(db_session: AsyncSession) -> None:
    """A child that grew a second agent node since save fails the run cleanly."""

    user = await _make_user(db_session)
    child = await _store_workflow(db_session, user, _definition([_prompt("ok")]), name="child")
    parent = await _store_workflow(
        db_session, user, _definition([_include(child.id)]), name="parent"
    )
    new_child, _specs = parse_definition(_multi_agent_definition())
    await store.append_version(
        db_session,
        workflow_id=child.id,
        definition_json=new_child,
        created_by_user_id=user.id,
        name=None,
        description=None,
        update_description=False,
    )
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(db_session, user, parent.id, inputs={}, target_mode="local")
    assert exc.value.code == "include_multi_agent"


# --- resolution depth cap ------------------------------------------------------


async def test_resolution_depth_cap(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    # Build a chain deeper than the cap: w0 <- w1 <- ... <- w6 (w6 includes w5 …).
    previous: uuid.UUID | None = None
    for i in range(7):
        steps: list[dict] = [_prompt(f"leaf {i}")]
        if previous is not None:
            steps = [_include(previous)]
        wf = await _store_workflow(db_session, user, _definition(steps), name=f"w{i}")
        previous = wf.id
    assert previous is not None
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(db_session, user, previous, inputs={}, target_mode="local")
    assert exc.value.code == "include_depth_exceeded"


# --- save-time cycle rejection -------------------------------------------------


async def test_self_include_rejected_at_save(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    wf = await _store_workflow(db_session, user, _definition([_prompt("x")]), name="wf")
    agents = [_agent([_include(wf.id)])]
    with pytest.raises(WorkflowCompositionError) as exc:
        await validate_includes(
            db_session, owner_user_id=user.id, workflow_id=wf.id, agents=agents
        )
    assert exc.value.code == "self_include"


async def test_direct_cycle_rejected_naming_path(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    b = await _store_workflow(db_session, user, _definition([_prompt("b")]), name="Bee")
    # A includes B.
    a = await _store_workflow(
        db_session, user, _definition([_include(b.id)]), name="Ay"
    )
    # Now saving B to include A closes the cycle A -> B -> A.
    b_agents = [_agent([_include(a.id)])]
    with pytest.raises(WorkflowCompositionError) as exc:
        await validate_includes(
            db_session, owner_user_id=user.id, workflow_id=b.id, agents=b_agents
        )
    assert exc.value.code == "include_cycle"
    assert "Ay" in exc.value.message and "Bee" in exc.value.message


async def test_indirect_cycle_rejected(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    c = await _store_workflow(db_session, user, _definition([_prompt("c")]), name="Cee")
    b = await _store_workflow(db_session, user, _definition([_include(c.id)]), name="Bee")
    a = await _store_workflow(db_session, user, _definition([_include(b.id)]), name="Ay")
    # Saving C to include A closes A -> B -> C -> A.
    c_agents = [_agent([_include(a.id)])]
    with pytest.raises(WorkflowCompositionError) as exc:
        await validate_includes(
            db_session, owner_user_id=user.id, workflow_id=c.id, agents=c_agents
        )
    assert exc.value.code == "include_cycle"


# --- arg coverage --------------------------------------------------------------


async def test_missing_required_input_rejected_at_save(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    child = await _store_workflow(
        db_session,
        user,
        _definition(
            [_prompt("{{inputs.need}}")],
            inputs=[{"name": "need", "type": "text", "required": True}],
        ),
        name="child",
    )
    agents = [_agent([_include(child.id)])]
    with pytest.raises(WorkflowCompositionError) as exc:
        await validate_includes(
            db_session, owner_user_id=user.id, workflow_id=None, agents=agents
        )
    assert exc.value.code == "include_args_mismatch"


async def test_undeclared_input_key_rejected_at_save(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    child = await _store_workflow(db_session, user, _definition([_prompt("hi")]), name="child")
    agents = [_agent([_include(child.id, args={"nope": "x"})])]
    with pytest.raises(WorkflowCompositionError) as exc:
        await validate_includes(
            db_session, owner_user_id=user.id, workflow_id=None, agents=agents
        )
    assert exc.value.code == "include_args_mismatch"


async def test_arg_mismatch_at_resolution_when_child_changed(
    db_session: AsyncSession,
) -> None:
    """A child version that grew a required input since save fails the run cleanly."""

    user = await _make_user(db_session)
    child = await _store_workflow(
        db_session,
        user,
        _definition(
            [_prompt("{{inputs.a}}")],
            inputs=[{"name": "a", "type": "text", "required": True}],
        ),
        name="child",
    )
    parent = await _store_workflow(
        db_session, user, _definition([_include(child.id, args={"a": "x"})]), name="parent"
    )
    # Child gains a new required input its callers don't bind.
    new_child, _specs = parse_definition(
        _definition(
            [_prompt("{{inputs.a}} {{inputs.b}}")],
            inputs=[
                {"name": "a", "type": "text", "required": True},
                {"name": "b", "type": "text", "required": True},
            ],
        )
    )
    await store.append_version(
        db_session,
        workflow_id=child.id,
        definition_json=new_child,
        created_by_user_id=user.id,
        name=None,
        description=None,
        update_description=False,
    )
    with pytest.raises(CloudApiError) as exc:
        await service.start_run(db_session, user, parent.id, inputs={}, target_mode="local")
    assert exc.value.code == "include_args_mismatch"


# --- refs into an include step -------------------------------------------------


async def test_ref_pointing_at_include_step_rejected(db_session: AsyncSession) -> None:
    """The validator rejects a parent ref that names an include handle (no output)."""

    definition = {
        "version": 1,
        "inputs": [],
        "integrations": [],
        "agents": [
            _agent(
                [
                    _include(uuid.uuid4(), name="inc"),
                    _prompt("bad {{inc.result}}"),
                ]
            )
        ],
    }
    with pytest.raises(Exception) as exc:
        parse_definition(definition)
    assert getattr(exc.value, "code", "") == "include_step_reference"
