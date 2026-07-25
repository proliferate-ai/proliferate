"""Application service for personal workflow definitions and invocations."""

from __future__ import annotations

from typing import cast
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repository_store
from proliferate.db.store import runtime_workers as runtime_worker_store
from proliferate.db.store import workflow_definitions as workflow_store
from proliferate.db.store import workflow_deliveries as delivery_store
from proliferate.db.store import workflow_invocations as invocation_store
from proliferate.db.store.background_outbox import enqueue_outbox_task
from proliferate.db.store.repositories import RepoEnvironmentValue
from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot
from proliferate.db.store.workflow_delivery_custody import (
    WorkflowDeliverySnapshot,
    WorkflowInvocationSnapshot,
    has_terminal_observation,
)
from proliferate.server.catalogs.models import AgentCatalogResponse
from proliferate.server.catalogs.service import read_agent_catalog
from proliferate.server.workflows.domain import invocation as invocation_domain
from proliferate.server.workflows.domain.invocation import InvocationIssue
from proliferate.server.workflows.domain.validation import (
    DefinitionIssue,
    ValidatedDefinitionDocument,
    validate_definition_document,
)
from proliferate.server.workflows.errors import (
    InvalidWorkflowDefinition,
    InvalidWorkflowInvocation,
    UnavailableWorkflowCatalogSelection,
    WorkflowAbandonNotAvailable,
    WorkflowDefinitionNotFound,
    WorkflowDefinitionRevisionConflict,
    WorkflowInvocationIdempotencyConflict,
    WorkflowInvocationNotFound,
)
from proliferate.server.workflows.models import (
    WorkflowDefinitionCreateRequest,
    WorkflowDefinitionUpdateRequest,
    WorkflowInvocationCreateRequest,
)
from proliferate.server.workflows.tasks import (
    WORKFLOWS_ABANDON_MANAGED_RUN_TASK,
    WORKFLOWS_CANCEL_MANAGED_RUN_TASK,
    WORKFLOWS_DELIVER_MANAGED_RUN_TASK,
    WORKFLOWS_OUTBOX_QUEUE,
)
from proliferate.utils import canonical_json as canonical


async def list_workflow_definitions(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[WorkflowDefinitionSnapshot, ...]:
    return await workflow_store.list_workflow_definitions(db, user_id=user_id)


async def get_workflow_definition(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID,
) -> WorkflowDefinitionSnapshot:
    value = await workflow_store.get_workflow_definition(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
    )
    if value is None:
        raise WorkflowDefinitionNotFound()
    return value


async def create_workflow_definition(
    db: AsyncSession,
    *,
    user_id: UUID,
    body: WorkflowDefinitionCreateRequest,
) -> WorkflowDefinitionSnapshot:
    await _validate_default_repository(
        db,
        user_id=user_id,
        repo_config_id=body.default_repo_config_id,
    )
    catalog = read_agent_catalog().catalog
    document = _validate_document(catalog, body)
    return await workflow_store.create_workflow_definition(
        db,
        user_id=user_id,
        title=body.title,
        description=_normalized_description(body.description),
        validated_catalog_version=catalog.catalogVersion,
        default_repo_config_id=body.default_repo_config_id,
        inputs_json=document.inputs,
        stages_json=document.stages,
    )


async def update_workflow_definition(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID,
    body: WorkflowDefinitionUpdateRequest,
) -> WorkflowDefinitionSnapshot:
    current = await get_workflow_definition(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
    )
    if body.expected_revision != current.revision:
        raise WorkflowDefinitionRevisionConflict(
            expected_revision=body.expected_revision,
            current_revision=current.revision,
        )
    await _validate_default_repository(
        db,
        user_id=user_id,
        repo_config_id=body.default_repo_config_id,
    )
    catalog = read_agent_catalog().catalog
    document = _validate_document(catalog, body)
    updated = await workflow_store.update_workflow_definition_if_revision(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
        expected_revision=body.expected_revision,
        title=body.title,
        description=_normalized_description(body.description),
        validated_catalog_version=catalog.catalogVersion,
        default_repo_config_id=body.default_repo_config_id,
        inputs_json=document.inputs,
        stages_json=document.stages,
    )
    if updated is not None:
        return updated
    latest = await workflow_store.get_workflow_definition(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
    )
    raise WorkflowDefinitionRevisionConflict(
        expected_revision=body.expected_revision,
        current_revision=None if latest is None else latest.revision,
    )


async def delete_workflow_definition(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID,
    expected_revision: int,
) -> None:
    await get_workflow_definition(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
    )
    deleted = await workflow_store.soft_delete_workflow_definition_if_revision(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
        expected_revision=expected_revision,
    )
    if deleted is not None:
        return
    current = await workflow_store.get_workflow_definition(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
    )
    raise WorkflowDefinitionRevisionConflict(
        expected_revision=expected_revision,
        current_revision=None if current is None else current.revision,
    )


async def _validate_default_repository(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_config_id: UUID | None,
) -> None:
    if repo_config_id is None:
        return
    repo = await repository_store.get_repo_config_by_id_for_user(
        db,
        user_id=user_id,
        repo_config_id=repo_config_id,
    )
    if repo is None:
        raise InvalidWorkflowDefinition(
            "Default repository was not found.",
            path="defaultRepoConfigId",
        )


def _validate_document(
    catalog: AgentCatalogResponse,
    body: WorkflowDefinitionCreateRequest,
) -> ValidatedDefinitionDocument:
    result = validate_definition_document(
        catalog,
        inputs=cast(
            list[dict[str, object]],
            body.model_dump(by_alias=True, exclude_none=True)["inputs"],
        ),
        stages=cast(
            list[dict[str, object]],
            body.model_dump(by_alias=True, exclude_none=True)["stages"],
        ),
    )
    if isinstance(result, DefinitionIssue):
        error_type = (
            UnavailableWorkflowCatalogSelection
            if result.kind == "catalog_selection_unavailable"
            else InvalidWorkflowDefinition
        )
        raise error_type(result.message, path=result.path)
    return result


def _normalized_description(value: str) -> str:
    return value if value.strip() else ""


InvocationValue = tuple[WorkflowInvocationSnapshot, WorkflowDeliverySnapshot]


async def create_workflow_invocation(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID,
    idempotency_key: str,
    body: WorkflowInvocationCreateRequest,
) -> tuple[WorkflowInvocationSnapshot, WorkflowDeliverySnapshot, bool]:
    """Create or idempotently replay one invocation (PR2 design §6/§7.1).

    The normalized request is hashed and matched against the caller's
    idempotency key **before** any mutable definition/repository state is
    consulted, so an exact replay returns the frozen row even after the
    definition or its defaults changed.
    """

    request = body.model_dump(mode="json", by_alias=True, exclude_none=True)
    request["definitionId"] = str(workflow_definition_id)
    _raise_for_issue(invocation_domain.validate_request_canonicalizable(request))
    request_hash = invocation_domain.request_hash(
        definition_id=workflow_definition_id,
        expected_revision=body.expected_revision,
        arguments=cast(dict[str, object], request["inputs"]),
        target=cast(dict[str, object], request["target"]),
        logical_placement=cast(dict[str, object], request["placement"]),
    )

    # Serialize concurrent first requests for the same (user, key) before the
    # initial lookup (see the store helper for the lock semantics).
    await invocation_store.acquire_invocation_idempotency_lock(
        db, user_id=user_id, idempotency_key=idempotency_key
    )
    existing = await invocation_store.get_workflow_invocation_by_idempotency_key(
        db, user_id=user_id, idempotency_key=idempotency_key
    )
    if existing is not None:
        return (*await _replay_or_conflict(db, existing, request_hash), False)

    definition = await get_workflow_definition(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
    )
    if body.expected_revision != definition.revision:
        raise WorkflowDefinitionRevisionConflict(
            expected_revision=body.expected_revision,
            current_revision=definition.revision,
        )

    inputs_declaration = [dict(entry) for entry in definition.inputs_json]
    stages = [dict(stage) for stage in definition.stages_json]
    arguments = invocation_domain.validate_arguments(
        inputs_declaration=inputs_declaration,
        arguments=cast(dict[str, object], request["inputs"]),
    )
    if isinstance(arguments, InvocationIssue):
        _raise_for_issue(arguments)
        raise AssertionError("unreachable")
    resolved_stages = invocation_domain.resolve_stages(
        stages=stages,
        inputs_declaration=inputs_declaration,
        arguments=arguments.arguments,
    )
    if isinstance(resolved_stages, InvocationIssue):
        _raise_for_issue(resolved_stages)
        raise AssertionError("unreachable")

    target = cast(dict[str, object], request["target"])
    desktop_install_id = await _validate_target(db, user_id=user_id, target=target)
    logical_placement = cast(dict[str, object], request["placement"])
    resolved_placement = await _resolve_placement(
        db,
        user_id=user_id,
        definition=definition,
        target_kind=str(target["kind"]),
        desktop_install_id=desktop_install_id,
        logical_placement=logical_placement,
    )

    invocation_id = uuid4()
    bundle = invocation_domain.build_resolved_bundle(
        run_id=invocation_id,
        definition_id=definition.id,
        definition_revision=definition.revision,
        definition_schema_version=definition.schema_version,
        definition_title=definition.title,
        definition_default_repo_config_id=definition.default_repo_config_id,
        validated_catalog_version=definition.validated_catalog_version,
        inputs_declaration=inputs_declaration,
        stages=stages,
        arguments=arguments.arguments,
        resolved_placement=resolved_placement,
        resolved_stages=resolved_stages,
    )
    try:
        bundle_digest = canonical.bundle_digest(bundle)
    except ValueError as error:
        # A stored definition that predates ingress scanning can still carry
        # text the cross-language canonical form rejects.
        raise InvalidWorkflowDefinition(
            f"Workflow definition cannot be canonicalized: {error}"
        ) from error

    inserted = await invocation_store.insert_workflow_invocation(
        db,
        invocation_id=invocation_id,
        user_id=user_id,
        workflow_definition_id=definition.id,
        definition_revision=definition.revision,
        definition_schema_version=definition.schema_version,
        validated_catalog_version=definition.validated_catalog_version,
        title_snapshot=definition.title,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        arguments_json=cast(dict[str, object], dict(arguments.arguments)),
        resolved_bundle_json=bundle,
        bundle_digest=bundle_digest,
        target_kind=str(target["kind"]),
        desktop_install_id=desktop_install_id,
        logical_placement_json=logical_placement,
        resolved_placement_json=resolved_placement,
    )
    if inserted is None:
        winner = await invocation_store.get_workflow_invocation_by_idempotency_key(
            db, user_id=user_id, idempotency_key=idempotency_key
        )
        if winner is None:
            raise WorkflowInvocationIdempotencyConflict()
        return (*await _replay_or_conflict(db, winner, request_hash), False)

    delivery = await delivery_store.insert_workflow_delivery(db, invocation_id=inserted.id)
    if inserted.target_kind == "managedCloud":
        await enqueue_outbox_task(
            db,
            task_name=WORKFLOWS_DELIVER_MANAGED_RUN_TASK,
            queue=WORKFLOWS_OUTBOX_QUEUE,
            kwargs_json={"invocation_id": str(inserted.id)},
            idempotency_key=f"{WORKFLOWS_DELIVER_MANAGED_RUN_TASK}:{inserted.id}",
        )
    return inserted, delivery, True


async def get_workflow_invocation(
    db: AsyncSession,
    *,
    user_id: UUID,
    invocation_id: UUID,
) -> InvocationValue:
    invocation = await invocation_store.get_workflow_invocation(
        db, user_id=user_id, invocation_id=invocation_id
    )
    if invocation is None:
        raise WorkflowInvocationNotFound()
    delivery = await delivery_store.get_workflow_delivery(db, invocation_id=invocation.id)
    if delivery is None:
        raise WorkflowInvocationNotFound()
    return invocation, delivery


async def list_workflow_invocations(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID | None = None,
) -> tuple[InvocationValue, ...]:
    return await invocation_store.list_workflow_invocations(
        db,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
    )


async def cancel_workflow_invocation(
    db: AsyncSession,
    *,
    user_id: UUID,
    invocation_id: UUID,
) -> InvocationValue:
    """Durable, idempotent cancellation intent (PR2 design §16).

    A queued row that was never offered to a target cancels terminally in
    place; anything already delivering/accepted on a managed target gets an
    outbox-backed convergence task in the same caller-owned transaction.
    """

    invocation, _ = await get_workflow_invocation(db, user_id=user_id, invocation_id=invocation_id)
    delivery = await delivery_store.request_delivery_cancel(db, invocation_id=invocation.id)
    if delivery is None:
        raise WorkflowInvocationNotFound()
    # A runtime-lost delivery has no target left to converge at: the marker
    # is recorded, but no convergence task may ever re-address that run. A
    # terminal projection is the run's result — the store writes no cancel
    # marker for it, and without an active marker there is nothing to
    # converge, so neither case enqueues.
    if (
        invocation.target_kind == "managedCloud"
        and delivery.control_plane_runtime_outcome is None
        and delivery.cancel_requested_at is not None
        and not has_terminal_observation(delivery)
        and delivery.status
        in (
            delivery_store.DELIVERY_STATUS_DELIVERING,
            delivery_store.DELIVERY_STATUS_ACCEPTED,
        )
    ):
        await enqueue_outbox_task(
            db,
            task_name=WORKFLOWS_CANCEL_MANAGED_RUN_TASK,
            queue=WORKFLOWS_OUTBOX_QUEUE,
            kwargs_json={"invocation_id": str(invocation.id)},
            idempotency_key=f"{WORKFLOWS_CANCEL_MANAGED_RUN_TASK}:{invocation.id}",
        )
    return invocation, delivery


async def abandon_workflow_invocation(
    db: AsyncSession,
    *,
    user_id: UUID,
    invocation_id: UUID,
) -> InvocationValue:
    """Relay owner-confirmed close-and-abandon to a managed target (§16).

    Cloud only gates the obvious preconditions; AnyHarness authoritatively
    accepts the abandon only from typed cleanup-blocked finalization.
    """

    invocation, _ = await get_workflow_invocation(db, user_id=user_id, invocation_id=invocation_id)
    if invocation.target_kind != "managedCloud":
        raise WorkflowAbandonNotAvailable(
            "Close and abandon is relayed by Cloud only for managed targets."
        )
    # Lock and re-read before the gate-then-enqueue decision: a concurrent
    # loss/projection CAS blocks on this row lock until we commit, so the
    # eligibility evidence below cannot go stale between the check and the
    # outbox insert.
    delivery = await delivery_store.get_workflow_delivery_for_update(
        db, invocation_id=invocation.id
    )
    if delivery is None:
        raise WorkflowInvocationNotFound()
    if delivery.status != delivery_store.DELIVERY_STATUS_ACCEPTED:
        raise WorkflowAbandonNotAvailable("Close and abandon requires an accepted delivery.")
    if delivery.control_plane_runtime_outcome is not None:
        raise WorkflowAbandonNotAvailable("The managed runtime for this run was lost.")
    if not _observation_shows_cleanup_blocked(delivery.runtime_observation_json):
        # §16: abandon is accepted only from typed cleanup-blocked
        # finalization. Gating on the projection keeps an arbitrary accepted
        # run from being poisoned with a premature abandon task; AnyHarness
        # stays authoritative and rejects anything Cloud got wrong.
        raise WorkflowAbandonNotAvailable(
            "Close and abandon is available only from typed cleanup-blocked finalization."
        )
    if (
        delivery.anyharness_run_id is None
        or delivery.cloud_sandbox_id is None
        or delivery.runtime_payload_digest is None
        or delivery.anyharness_data_epoch is None
        or delivery.runtime_revision is None
    ):
        raise WorkflowAbandonNotAvailable(
            "Close and abandon requires full delivery custody evidence."
        )
    # Revision-scoped idempotency: one abandon relay per observed cleanup
    # block. If a later, higher-revision observation shows the run blocked
    # again, its confirmation can enqueue a fresh task instead of being
    # swallowed by a spent fixed key. The kwargs carry the exact custody
    # proof so the handler re-checks it against the row before acting.
    await enqueue_outbox_task(
        db,
        task_name=WORKFLOWS_ABANDON_MANAGED_RUN_TASK,
        queue=WORKFLOWS_OUTBOX_QUEUE,
        kwargs_json={
            "invocation_id": str(invocation.id),
            "anyharness_run_id": delivery.anyharness_run_id,
            "cloud_sandbox_id": delivery.cloud_sandbox_id,
            "expected_runtime_payload_digest": delivery.runtime_payload_digest,
            "expected_data_epoch": delivery.anyharness_data_epoch,
            "expected_runtime_revision": delivery.runtime_revision,
        },
        idempotency_key=(
            f"{WORKFLOWS_ABANDON_MANAGED_RUN_TASK}:{invocation.id}:{delivery.runtime_revision}"
        ),
    )
    return invocation, delivery


def _observation_shows_cleanup_blocked(observation: dict[str, object] | None) -> bool:
    if not isinstance(observation, dict) or observation.get("status") != "finalizing":
        return False
    error = observation.get("error")
    return (
        isinstance(error, dict)
        and error.get("code") == "workflow_session_cleanup_requires_abandon"
    )


async def _replay_or_conflict(
    db: AsyncSession,
    existing: WorkflowInvocationSnapshot,
    request_hash: str,
) -> InvocationValue:
    if existing.request_hash != request_hash:
        raise WorkflowInvocationIdempotencyConflict()
    delivery = await delivery_store.get_workflow_delivery(db, invocation_id=existing.id)
    if delivery is None:
        raise WorkflowInvocationNotFound()
    return existing, delivery


def _raise_for_issue(issue: InvocationIssue | None) -> None:
    if issue is None:
        return
    if issue.code == "invalid_workflow_definition":
        raise InvalidWorkflowDefinition(issue.message, path=issue.path)
    raise InvalidWorkflowInvocation(issue.message, code=issue.code, path=issue.path)


async def _validate_target(
    db: AsyncSession,
    *,
    user_id: UUID,
    target: dict[str, object],
) -> str | None:
    if target["kind"] != "desktop":
        return None
    desktop_install_id = str(target["desktopInstallId"])
    worker = await runtime_worker_store.get_active_desktop_worker(
        db,
        owner_user_id=user_id,
        desktop_install_id=desktop_install_id,
    )
    if worker is None:
        raise InvalidWorkflowInvocation(
            "No enrolled desktop worker exists for this install.",
            code="workflow_target_unavailable",
            path="target.desktopInstallId",
        )
    return desktop_install_id


async def _resolve_placement(
    db: AsyncSession,
    *,
    user_id: UUID,
    definition: WorkflowDefinitionSnapshot,
    target_kind: str,
    desktop_install_id: str | None,
    logical_placement: dict[str, object],
) -> dict[str, object]:
    """Freeze the logical placement snapshot in the invocation transaction.

    ``definitionDefault`` is request syntax (design §6.1): it resolves here,
    against the selected target, into an immutable repository-environment
    selection that later definition edits can never redirect.
    """

    if logical_placement["kind"] == "existingWorkspace":
        bindings = cast(list[dict[str, object]], logical_placement.get("sessionBindings", []))
        stage_count = len(definition.stages_json)
        seen: set[int] = set()
        seen_sessions: set[str] = set()
        for binding in bindings:
            stage_index = cast(int, binding["stageIndex"])
            session_id = str(binding["sessionId"])
            if stage_index >= stage_count:
                raise InvalidWorkflowInvocation(
                    f"Session binding stage index {stage_index} is out of range.",
                    code="invalid_workflow_invocation",
                    path="placement.sessionBindings",
                )
            if stage_index in seen:
                raise InvalidWorkflowInvocation(
                    f"Session binding stage index {stage_index} is bound twice.",
                    code="invalid_workflow_invocation",
                    path="placement.sessionBindings",
                )
            if session_id in seen_sessions:
                raise InvalidWorkflowInvocation(
                    "A session may be bound to at most one stage.",
                    code="invalid_workflow_invocation",
                    path="placement.sessionBindings",
                )
            seen.add(stage_index)
            seen_sessions.add(session_id)
        # Workspace/session IDs are target-local; AnyHarness validates
        # authoritatively. But when Cloud has a projection of a managed
        # workspace it must not accept a foreign or archived one (§6.1).
        if target_kind == "managedCloud":
            workspace = await cloud_workspace_store.get_cloud_workspace_by_anyharness_id(
                db, str(logical_placement["workspaceId"])
            )
            if workspace is not None and (
                workspace.owner_user_id != user_id or workspace.archived_at is not None
            ):
                raise InvalidWorkflowInvocation(
                    "The selected workspace is not available for this run.",
                    code="workflow_workspace_conflict",
                    path="placement.workspaceId",
                )
        return {
            "kind": "existingWorkspace",
            "workspaceId": logical_placement["workspaceId"],
            "sessionBindings": bindings,
        }

    repository = cast(dict[str, object], logical_placement["repository"])
    environment: RepoEnvironmentValue | None
    if repository["kind"] == "none":
        environment = None
    elif repository["kind"] == "definitionDefault":
        if definition.default_repo_config_id is None:
            environment = None
        else:
            environment = await _resolve_default_environment(
                db,
                user_id=user_id,
                repo_config_id=definition.default_repo_config_id,
                target_kind=target_kind,
                desktop_install_id=desktop_install_id,
            )
    else:
        environment = await _resolve_explicit_environment(
            db,
            user_id=user_id,
            repo_environment_id=UUID(str(repository["repoEnvironmentId"])),
            target_kind=target_kind,
            desktop_install_id=desktop_install_id,
        )

    if environment is None:
        return {"kind": "newWorkspace", "repository": {"kind": "none"}}

    resolved: dict[str, object] = {
        "kind": "newWorkspace",
        "repository": {
            "kind": "repositoryEnvironment",
            "repoConfigId": str(environment.repo_config_id),
            "repoEnvironmentId": str(environment.id),
            "repositoryIdentity": invocation_domain.repository_identity(
                environment.git_provider,
                environment.git_owner,
                environment.git_repo_name,
            ),
            # Non-secret setup config is frozen under bundleDigest so a later
            # environment edit or delete can never change what this run
            # executes. Target-local values (local paths) and credentials are
            # deliberately excluded; delivery maps the frozen selection to a
            # target-local root.
            "setupScript": environment.setup_script,
            "runCommand": environment.run_command,
        },
    }
    base_ref = logical_placement.get("baseRef") or environment.default_branch
    if base_ref:
        resolved["baseRef"] = base_ref
    return resolved


async def _resolve_default_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_config_id: UUID,
    target_kind: str,
    desktop_install_id: str | None,
) -> RepoEnvironmentValue:
    if target_kind == "managedCloud":
        environment = await repository_store.get_cloud_repo_environment_by_repo_config_id(
            db, user_id=user_id, repo_config_id=repo_config_id
        )
        if environment is None:
            raise InvalidWorkflowInvocation(
                "The default repository has no Cloud environment.",
                code="workflow_repository_environment_unavailable",
                path="placement.repository",
            )
        return environment
    assert desktop_install_id is not None
    environments = await repository_store.list_local_repo_environments_for_desktop_install(
        db,
        user_id=user_id,
        repo_config_id=repo_config_id,
        desktop_install_id=desktop_install_id,
    )
    if not environments:
        raise InvalidWorkflowInvocation(
            "The default repository has no environment on this desktop install.",
            code="workflow_repository_environment_unavailable",
            path="placement.repository",
        )
    if len(environments) > 1:
        raise InvalidWorkflowInvocation(
            "The default repository has multiple local paths on this desktop "
            "install; select one environment explicitly.",
            code="workflow_repository_environment_ambiguous",
            path="placement.repository",
        )
    return environments[0]


async def _resolve_explicit_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_environment_id: UUID,
    target_kind: str,
    desktop_install_id: str | None,
) -> RepoEnvironmentValue:
    environment = await repository_store.get_repo_environment_by_id(db, repo_environment_id)
    unavailable = InvalidWorkflowInvocation(
        "The selected repository environment is not available for this target.",
        code="workflow_repository_environment_unavailable",
        path="placement.repository.repoEnvironmentId",
    )
    if environment is None or environment.user_id != user_id:
        raise unavailable
    if target_kind == "managedCloud":
        if environment.environment_kind != "cloud":
            raise unavailable
        return environment
    if (
        environment.environment_kind != "local"
        or environment.desktop_install_id != desktop_install_id
    ):
        raise unavailable
    return environment
