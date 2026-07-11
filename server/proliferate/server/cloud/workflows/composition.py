"""Workflow composition resolution + validation (spec 3.5 / L20), format v2.

This is the async, DB-touching half of workflow composition: it loads
``workflow.include`` targets, recursively resolves + splices their steps using
the pure transforms in ``domain/composition.py`` (prefixing, arg binding,
emit-ref rewriting), and validates the include graph at save time (target
ownership, arg coverage, cycle detection). See ``domain/composition.py`` for the
pure inlining rules this module orchestrates.

:func:`resolve_included_agents` is called from ``StartRun`` — it inlines every
``workflow.include`` into the owning agent node's step list, server-side, before
the flatten pass, so the runtime never sees a ``workflow.include`` step (the L20
property). :func:`validate_includes` runs at workflow create/update to catch a
bad include (unknown/foreign/archived/multi-agent/self/cyclic target, or a
mapping that doesn't cover the child's required inputs) before a version is
stored.
"""

from __future__ import annotations

from copy import deepcopy
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import WORKFLOW_MAX_INCLUDE_DEPTH
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflows import WorkflowRecord
from proliferate.server.cloud.workflows.domain.composition import (
    WorkflowCompositionError,
    _build_arg_context,
    _child_arg_specs,
    _include_steps_of_definition,
    _is_include,
    _single_agent_steps,
    _splice_child,
)

__all__ = ["WorkflowCompositionError", "resolve_included_agents", "validate_includes"]


# --- resolution-time inlining --------------------------------------------------


async def _load_included_target(
    db: AsyncSession, *, owner_user_id: UUID, workflow_id_str: object
) -> tuple[WorkflowRecord, dict[str, object]]:
    """Load an include target's current version, or raise the run-failing error.

    The target must still exist, be owned by the run's owner, be un-archived, and
    have a current version — a target changed/removed since save fails the run
    cleanly, before any delivery.
    """

    try:
        target_id = UUID(str(workflow_id_str))
    except ValueError as exc:
        raise WorkflowCompositionError(
            "include_target_not_found", "workflow.include target id is invalid."
        ) from exc
    target = await store.get_workflow(db, target_id)
    if target is None or target.owner_user_id != owner_user_id or target.archived_at is not None:
        raise WorkflowCompositionError(
            "include_target_not_found",
            f"Included workflow {target_id} is not available.",
        )
    if target.current_version_id is None:
        raise WorkflowCompositionError(
            "include_target_not_found",
            f"Included workflow {target_id} has no current version.",
        )
    version = await store.get_version(db, target.current_version_id)
    if version is None:
        raise WorkflowCompositionError(
            "include_target_not_found",
            f"Included workflow {target_id} has no current version.",
        )
    return target, version.definition_json


async def resolve_included_steps(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    steps: list[dict[str, object]],
    depth: int = 0,
) -> list[dict[str, object]]:
    """Flatten every ``workflow.include`` in one agent node's step list.

    Recursive (B may include C) and depth-capped: a breach raises
    ``include_depth_exceeded`` BEFORE any splicing, so the run fails before
    delivery. The returned list contains no ``workflow.include`` steps (L20) and
    only the v2 named-ref grammar (index rewriting is the flatten pass's job).
    """

    if depth > WORKFLOW_MAX_INCLUDE_DEPTH:
        raise WorkflowCompositionError(
            "include_depth_exceeded",
            f"workflow.include nesting exceeds the limit of {WORKFLOW_MAX_INCLUDE_DEPTH}.",
        )

    output: list[dict[str, object]] = []
    for orig_index, step in enumerate(steps):
        if not _is_include(step):
            output.append(deepcopy(step))
            continue
        target, child_definition = await _load_included_target(
            db, owner_user_id=owner_user_id, workflow_id_str=step.get("workflow_id")
        )
        child_steps = _single_agent_steps(child_definition, target_id=target.id)
        child_flat = await resolve_included_steps(
            db,
            owner_user_id=owner_user_id,
            steps=child_steps,
            depth=depth + 1,
        )
        arg_context = _build_arg_context(
            dict(step.get("args") or {}),
            _child_arg_specs(child_definition),
            error_code="include_args_mismatch",
        )
        include_name = step.get("name")
        prefix = include_name if isinstance(include_name, str) else f"w{orig_index}"
        output.extend(_splice_child(child_flat, arg_context=arg_context, name_prefix=prefix))
    return output


async def resolve_included_agents(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    agents: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Return the agents spine with every node's ``workflow.include`` inlined.

    Each node keeps its slot/harness/model; only its step list is expanded (the
    included steps run in the parent node's session). The result feeds the flatten
    pass, which assigns keys and rewrites emit refs to indices.
    """

    resolved: list[dict[str, object]] = []
    for node in agents:
        # L30 parallel group: workflow.include is rejected inside a lane at parse
        # time (v1 bound), so a group entry carries nothing to inline — pass it
        # through unchanged (composition never reshapes the spine's structure).
        if "parallel" in node:
            resolved.append(node)
            continue
        steps = await resolve_included_steps(
            db, owner_user_id=owner_user_id, steps=list(node.get("steps", []))
        )
        resolved.append({**node, "steps": steps})
    return resolved


# --- save-time validation ------------------------------------------------------


async def _include_targets_of(db: AsyncSession, workflow_id: UUID) -> list[UUID]:
    """The include targets declared by a workflow's CURRENT version (for cycle walk)."""

    workflow = await store.get_workflow(db, workflow_id)
    if workflow is None or workflow.current_version_id is None:
        return []
    version = await store.get_version(db, workflow.current_version_id)
    if version is None:
        return []
    targets: list[UUID] = []
    for step in _include_steps_of_definition(version.definition_json):
        try:
            targets.append(UUID(str(step.get("workflow_id"))))
        except ValueError:
            continue
    return targets


async def _name_of(db: AsyncSession, workflow_id: UUID) -> str:
    workflow = await store.get_workflow(db, workflow_id)
    return workflow.name if workflow is not None else str(workflow_id)


async def _check_cycle(
    db: AsyncSession, *, root_id: UUID | None, root_targets: list[UUID]
) -> None:
    """Walk the include graph from the workflow being saved; raise on a cycle.

    ``root_id`` is ``None`` at create (the workflow has no id yet, so it cannot be
    reached — no cycle can involve it). A target that reaches ``root_id`` or that
    reappears on the current DFS path is a cycle; the error names the path.
    """

    path: list[UUID] = []

    async def visit(targets: list[UUID], depth: int) -> None:
        if depth > WORKFLOW_MAX_INCLUDE_DEPTH:
            raise WorkflowCompositionError(
                "include_depth_exceeded",
                f"workflow.include nesting exceeds the limit of {WORKFLOW_MAX_INCLUDE_DEPTH}.",
            )
        for target in targets:
            if root_id is not None and target == root_id:
                names = [await _name_of(db, node) for node in [root_id, *path, target]]
                raise WorkflowCompositionError(
                    "include_cycle",
                    "workflow.include forms a cycle: " + " -> ".join(names) + ".",
                )
            if target in path:
                start = path.index(target)
                names = [await _name_of(db, node) for node in [*path[start:], target]]
                raise WorkflowCompositionError(
                    "include_cycle",
                    "workflow.include forms a cycle: " + " -> ".join(names) + ".",
                )
            path.append(target)
            await visit(await _include_targets_of(db, target), depth + 1)
            path.pop()

    await visit(root_targets, 1)


async def validate_includes(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    workflow_id: UUID | None,
    agents: list[dict[str, object]],
) -> None:
    """Save-time validation of every ``workflow.include`` in ``agents`` (spec 3.5).

    ``workflow_id`` is the id of the workflow being saved (``None`` at create, when
    it has no id yet). Raises :class:`WorkflowCompositionError` on any problem.
    """

    root_targets: list[UUID] = []
    for node in agents:
        for step in node.get("steps", []):
            if not _is_include(step):
                continue
            try:
                target_id = UUID(str(step.get("workflow_id")))
            except ValueError as exc:
                raise WorkflowCompositionError(
                    "include_target_not_found", "workflow.include target id is invalid."
                ) from exc
            if workflow_id is not None and target_id == workflow_id:
                raise WorkflowCompositionError("self_include", "A workflow cannot include itself.")
            target = await store.get_workflow(db, target_id)
            if (
                target is None
                or target.owner_user_id != owner_user_id
                or target.archived_at is not None
            ):
                raise WorkflowCompositionError(
                    "include_target_not_found",
                    f"Included workflow {target_id} is not available.",
                )
            if target.current_version_id is None:
                raise WorkflowCompositionError(
                    "include_target_not_found",
                    f"Included workflow {target_id} has no current version.",
                )
            version = await store.get_version(db, target.current_version_id)
            if version is None:
                raise WorkflowCompositionError(
                    "include_target_not_found",
                    f"Included workflow {target_id} has no current version.",
                )
            # A multi-agent child is not a legal include target (v1); catch it at
            # save so the editor surfaces it before the run ever fails.
            _single_agent_steps(version.definition_json, target_id=target_id)
            # Coverage against the child's CURRENT input schema.
            _build_arg_context(
                dict(step.get("args") or {}),
                _child_arg_specs(version.definition_json),
                error_code="include_args_mismatch",
            )
            root_targets.append(target_id)

    if root_targets:
        await _check_cycle(db, root_id=workflow_id, root_targets=root_targets)
