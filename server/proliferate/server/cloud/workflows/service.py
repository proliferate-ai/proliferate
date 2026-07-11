"""Cloud workflows API-facing service layer.

Owns workflow/version CRUD, owner-scoped visibility (:func:`visible_workflow`
and :func:`_visible_run`), run listing/detail, and the Slack channel picker.

StartRun compilation — the single resolution point (spec 3.2): load the pinned
immutable version, coerce args, eagerly interpolate ``{{args.*}}`` into a
self-contained resolved plan, and record a ``pending_delivery`` run — lives in
``compiler.py``. Worker-facing delivery/observed-status handling lives in
``worker/service.py``. Trigger CRUD, poll-config validation, and the poll probe
live in ``triggers.py``. This split is ownership-only (WS0B-S): behavior is
unchanged, and this module intentionally does not import any of the three so
that they can depend on the visibility helpers below without a cycle.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import WORKFLOW_SHORT_TEXT_MAX_LENGTH
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflows import (
    StepActionRecord,
    WorkflowRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
)
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.integrations.slack import client as slack_client
from proliferate.integrations.slack.client import SlackChannelSummary
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.composition import validate_includes
from proliferate.server.cloud.workflows.domain.composition import WorkflowCompositionError
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    parse_definition,
)
from proliferate.server.cloud.workflows.domain.policy import (
    free_plan_workflow_limit,
    workflow_create_allowed,
)
from proliferate.server.cloud.workflows.gateway_grants import (
    _organization_id_for_owner,
    granted_namespaces,
    resolve_run_scope,
    visible_provider_namespaces,
)
from proliferate.server.cloud.workflows.models import WorkflowCreateRequest, WorkflowUpdateRequest
from proliferate.utils.crypto import decrypt_json


def _clean_name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise CloudApiError("invalid_workflow", "name is required.", status_code=400)
    if len(cleaned) > WORKFLOW_SHORT_TEXT_MAX_LENGTH:
        raise CloudApiError(
            "invalid_workflow",
            f"name must be at most {WORKFLOW_SHORT_TEXT_MAX_LENGTH} characters.",
            status_code=400,
        )
    return cleaned


def _validated_definition(raw: dict[str, object]) -> dict[str, object]:
    # Saving a workflow permits a zero-step draft (the user builds it in the
    # editor after create); StartRun re-parses with require_steps=True so an
    # empty draft can be saved but not run.
    try:
        canonical, _specs = parse_definition(raw, require_steps=False)
    except WorkflowDefinitionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc
    return canonical


async def _validate_workflow_includes(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    workflow_id: UUID | None,
    definition: dict[str, object],
) -> None:
    """Save-time composition checks (spec 3.5): target ownership, arg coverage, cycles.

    These need the DB (fetching each include target's current version), so they run
    here rather than in the pure ``parse_definition``.
    """

    try:
        await validate_includes(
            db,
            owner_user_id=owner_user_id,
            workflow_id=workflow_id,
            agents=list(definition.get("agents", [])),
        )
    except WorkflowCompositionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc


async def _validate_workflow_functions(
    db: AsyncSession, *, owner_user_id: UUID, definition: dict[str, object]
) -> None:
    """Save-time L22 check: every declared ``functions`` provider must be a
    definition visible to the owner (seed + the owner's org customs).

    Structural validation (non-empty strings, no dup providers) already happened in
    ``parse_definition``; this needs owner context + the DB, so it runs here. It
    does NOT require a *ready account* — that is a StartRun-time (fail-the-run)
    concern, since accounts connect/disconnect independently of the definition.
    """

    namespaces = granted_namespaces(resolve_run_scope(definition))
    if not namespaces:
        return
    visible = await visible_provider_namespaces(db, owner_user_id=owner_user_id)
    unknown = sorted(set(namespaces) - visible)
    if unknown:
        raise CloudApiError(
            "workflow_function_provider_unknown",
            f"integrations reference provider(s) you cannot use: {unknown}.",
            status_code=400,
        )


async def visible_workflow(
    db: AsyncSession, *, user: ActorIdentity, workflow_id: UUID, mutable: bool = False
) -> WorkflowRecord:
    """Fetch a workflow the actor may see, or raise 404 (owner-scoped visibility).

    Seeds (track 1f: ``is_seed=True``, ``owner_user_id IS NULL``) are org-agnostic
    read-only starter workflows visible to every user — readable and directly
    runnable (the run resolves its effective owner to the runner), but never
    mutable. ``mutable=True`` call sites (update/archive/trigger writes) reject a
    seed with 403 rather than letting a shared row be edited.
    """

    workflow = await store.get_workflow(db, workflow_id)
    if workflow is None or (workflow.owner_user_id != user.id and not workflow.is_seed):
        raise CloudApiError("workflow_not_found", "Workflow not found.", status_code=404)
    if mutable and workflow.is_seed:
        raise CloudApiError(
            "workflow_seed_read_only",
            "Starter templates can't be edited. Duplicate it to customize.",
            status_code=403,
        )
    return workflow


# Back-compat alias for the private call sites in this module.
_visible_workflow = visible_workflow


async def _visible_run(
    db: AsyncSession, *, user: ActorIdentity, run_id: UUID
) -> WorkflowRunRecord:
    run = await store.get_run(db, run_id)
    if run is None or run.executor_user_id != user.id:
        raise CloudApiError("workflow_run_not_found", "Workflow run not found.", status_code=404)
    return run


# --- workflow CRUD -------------------------------------------------------------


async def create_workflow(
    db: AsyncSession, user: ActorIdentity, body: WorkflowCreateRequest
) -> tuple[WorkflowRecord, list[WorkflowVersionRecord]]:
    name = _clean_name(body.name)
    definition = _validated_definition(body.definition)
    # workflow_id is None at create: the workflow has no id yet, so no include
    # cycle can involve it — self-include only becomes possible on update.
    await _validate_workflow_includes(
        db, owner_user_id=user.id, workflow_id=None, definition=definition
    )
    await _validate_workflow_functions(db, owner_user_id=user.id, definition=definition)
    active_count = await store.count_active_workflows(db, owner_user_id=user.id)
    if not workflow_create_allowed(active_count, max_allowed=free_plan_workflow_limit()):
        raise CloudApiError(
            "workflow_limit_reached",
            "Your plan allows one active workflow. Archive an existing workflow first.",
            status_code=403,
        )
    workflow, version = await store.create_workflow_with_version(
        db,
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name=name,
        description=body.description,
        definition_json=definition,
    )
    return workflow, [version]


async def update_workflow(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    body: WorkflowUpdateRequest,
) -> tuple[WorkflowRecord, list[WorkflowVersionRecord]]:
    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id, mutable=True)
    if workflow.archived_at is not None:
        raise CloudApiError(
            "workflow_archived", "Cannot update an archived workflow.", status_code=409
        )
    definition = _validated_definition(body.definition)
    await _validate_workflow_includes(
        db, owner_user_id=user.id, workflow_id=workflow_id, definition=definition
    )
    await _validate_workflow_functions(db, owner_user_id=user.id, definition=definition)
    name = _clean_name(body.name) if body.name is not None else None
    update_description = "description" in body.model_fields_set
    result = await store.append_version(
        db,
        workflow_id=workflow_id,
        definition_json=definition,
        created_by_user_id=user.id,
        name=name,
        description=body.description,
        update_description=update_description,
    )
    if result is None:
        raise CloudApiError("workflow_not_found", "Workflow not found.", status_code=404)
    updated, _version = result
    versions = list(await store.list_versions(db, workflow_id=workflow_id))
    return updated, versions


async def list_workflows(
    db: AsyncSession, user: ActorIdentity, *, include_archived: bool = False
) -> list[WorkflowRecord]:
    return list(
        await store.list_workflows(db, owner_user_id=user.id, include_archived=include_archived)
    )


async def get_workflow_detail(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID
) -> tuple[WorkflowRecord, list[WorkflowVersionRecord]]:
    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id)
    versions = list(await store.list_versions(db, workflow_id=workflow_id))
    return workflow, versions


async def archive_workflow(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID
) -> WorkflowRecord:
    await _visible_workflow(db, user=user, workflow_id=workflow_id, mutable=True)
    archived = await store.archive_workflow(db, workflow_id)
    if archived is None:
        raise CloudApiError("workflow_not_found", "Workflow not found.", status_code=404)
    return archived


# --- run listing/detail + Slack channel picker ---------------------------------


async def list_runs(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    workflow_id: UUID | None = None,
) -> list[WorkflowRunRecord]:
    if workflow_id is not None:
        await _visible_workflow(db, user=user, workflow_id=workflow_id)
    return list(await store.list_runs(db, executor_user_id=user.id, workflow_id=workflow_id))


async def get_run(db: AsyncSession, user: ActorIdentity, run_id: UUID) -> WorkflowRunRecord:
    return await _visible_run(db, user=user, run_id=run_id)


async def list_run_step_actions(db: AsyncSession, run_id: UUID) -> list[StepActionRecord]:
    """A run's step actions (notify/emit side effects), keyed step-order.

    Callers resolve ownership via ``get_run``/``_visible_run`` first; this does
    not re-check visibility since a run id that survived that lookup is already
    owner-scoped.
    """

    return list(await store.list_actions_for_run(db, run_id=run_id))


# --- Slack channel picker (workflow notify step target) ------------------------


@dataclass(frozen=True)
class SlackChannelsResult:
    channels: list[SlackChannelSummary]
    connected: bool


async def list_slack_channels(db: AsyncSession, user: ActorIdentity) -> SlackChannelsResult:
    """Channels for the owner's connected Slack workspace, for the notify-step
    channel picker. ``connected=False`` covers both "never connected" and a
    credential that no longer decrypts; either way there is nothing to list.

    Org-aware: an org-disabled Slack integration reads as not-connected here so
    the editor never offers channels the runtime send (``actions.py``) would
    then refuse."""

    organization_id = await _organization_id_for_owner(db, owner_user_id=user.id)
    row = await accounts_store.get_ready_account_for_provider(
        db, user.id, "slack", organization_id=organization_id
    )
    if row is None or not accounts_store.org_policy_allows(row, organization_id=organization_id):
        return SlackChannelsResult(channels=[], connected=False)
    account = row.account
    try:
        bundle = decrypt_json(account.credential_ciphertext)
    except Exception:
        return SlackChannelsResult(channels=[], connected=False)
    # oauth-bundle-v1 stores the token under camelCase "accessToken"; keep the
    # snake_case keys as fallbacks (see actions.py _perform_slack_notify).
    bot_token = bundle.get("bot_token") or bundle.get("accessToken") or bundle.get("access_token")
    if not bot_token:
        return SlackChannelsResult(channels=[], connected=False)
    try:
        channels = await slack_client.list_channels(bot_token=bot_token)
    except Exception:
        return SlackChannelsResult(channels=[], connected=True)
    return SlackChannelsResult(channels=channels, connected=True)
