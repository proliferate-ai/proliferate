"""Workflow triggers (spec 3.5): CRUD, schedule/poll validation, and the poll probe.

A trigger pins target + schedule + concurrency and funnels to the *same*
``compiler.start_run`` — it owns no execution. Validation reuses the house
pieces: schedule RRULE/timezone via ``automations.domain.schedule.normalize_schedule``
(identical hourly/daily cursor rules), arg coverage via ``coerce_arguments``
(so required args must be covered), workspace ownership via
``_ensure_trigger_target_workspace`` below.

Local SCHEDULE triggers (track 2a): supported. This lifts the v1 L15 reject by
building the server→desktop claim protocol — a due local schedule trigger fires a
``claimable`` run a desktop executor claims (see the claim plane in the store +
local_executor). A local schedule trigger keeps its repo pin (D16 CHECK; it tells
the desktop which local worktree) but does NOT derive a cloud workspace
(target_workspace_id stays NULL — the local CHECK invariant).

Local POLL triggers stay rejected: poll runs are created per-item by the poller,
not by the missed-run-aware scheduler, so the claim/missed-run machinery this
track adds does not cover them yet (follow-up).

Split out of ``service.py`` (ownership-only, WS0B-S): API-facing workflow
CRUD/visibility stays in ``service.py``; StartRun compilation lives in
``compiler.py``; worker-facing delivery/observed-status handling lives in
``worker/service.py``. This module owns only trigger CRUD, poll-config
validation, and the poll probe.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import (
    SUPPORTED_WORKFLOW_CONCURRENCY_POLICIES,
    SUPPORTED_WORKFLOW_MISSED_RUN_POLICIES,
    SUPPORTED_WORKFLOW_TRIGGER_TYPES,
    WORKFLOW_POLL_MIN_INTERVAL_SECONDS,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    WORKFLOW_TRIGGER_KIND_POLL,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
)
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repositories_store
from proliferate.db.store.cloud_workflow_triggers import WorkflowTriggerRecord
from proliferate.db.store.cloud_workflows import WorkflowRecord, WorkflowVersionRecord
from proliferate.server.automations.domain.schedule import (
    AutomationScheduleError,
    ParsedAutomationSchedule,
    normalize_schedule,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    has_parallel_groups,
    parse_definition,
)
from proliferate.server.cloud.workflows.domain.interpolation import (
    ArgSpec,
    ArgumentError,
    coerce_arguments,
)
from proliferate.server.cloud.workflows.domain.poll_contract import (
    derive_inputs_from_sample,
    derive_item_schema,
    diff_item_against_schema,
    init_probe_url,
    skipped_sample_fields,
)
from proliferate.server.cloud.workflows.models import (
    TriggerPollRequest,
    TriggerScheduleRequest,
    WorkflowTriggerCreateRequest,
    WorkflowTriggerUpdateRequest,
)
from proliferate.server.cloud.workflows.service import visible_workflow
from proliferate.server.cloud.workflows.worker.poll_http import guard_poll_endpoint
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow

# Cross-module call into service.py, the API-facing owner of workflow
# visibility (one-directional: service.py does not import this module).
_visible_workflow = visible_workflow

_TRIGGER_LOCAL_UNSUPPORTED_MESSAGE = (
    "Scheduled local runs are coming; run this workflow manually, or schedule it "
    "on a cloud workspace."
)
_POLL_LOCAL_UNSUPPORTED_MESSAGE = (
    "Poll triggers run in the cloud; point this trigger at a cloud workspace."
)


def _split_repo_full_name(repo_full_name: str | None) -> tuple[str, str]:
    """Parse an "owner/name" repo pin. Raises 400 on a malformed value."""

    cleaned = (repo_full_name or "").strip()
    owner, _, name = cleaned.partition("/")
    if not owner or not name or "/" in name:
        raise CloudApiError(
            "invalid_repo",
            "Pin a repository as 'owner/name'.",
            status_code=400,
        )
    return owner, name


async def _ensure_trigger_target_workspace(
    db: AsyncSession, *, user: ActorIdentity, repo_full_name: str | None
) -> UUID:
    """D16: derive the trigger's target workspace from its repo pin.

    The trigger authors a repo; the server owns the workspace. This resolves the
    caller's cloud repo environment for the pin and provisions a dedicated,
    server-owned cloud workspace row for it (one warm workspace per trigger). The
    anyharness worktree is NOT materialized here — that stays a retry-at-fire
    concern (``start_run`` raises ``target_workspace_not_ready`` until the runtime
    workspace is ready), exactly as before the repo pin existed.
    """

    owner, name = _split_repo_full_name(repo_full_name)
    repo_environment = await repositories_store.get_cloud_repo_environment(
        db, user_id=user.id, git_owner=owner, git_repo_name=name
    )
    if repo_environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_found",
            "Configure this repository as a cloud environment before pinning it to a trigger.",
            status_code=404,
        )
    # Reuse the warm workspace this repo already has, if any; otherwise create the
    # dedicated row. Either way the trigger-fire path is unchanged — it stamps this
    # id into start_run, which re-checks materialization (target_workspace_not_ready
    # stays a retry-at-fire concern for a row whose worktree isn't ready yet).
    existing = await cloud_workspace_store.get_active_cloud_workspace_for_repo_environment(
        db, user_id=user.id, repo_environment_id=repo_environment.id
    )
    if existing is not None:
        return existing.id
    branch = f"workflow-trigger/{uuid4().hex[:12]}"
    workspace = await cloud_workspace_store.create_cloud_workspace(
        db,
        user_id=user.id,
        repo_environment_id=repo_environment.id,
        display_name=f"{owner}/{name}",
        git_branch=branch,
        git_base_branch=repo_environment.default_branch or "main",
    )
    if workspace is None:  # pragma: no cover - the generated branch is unique
        raise CloudApiError(
            "cloud_workspace_create_failed",
            "Could not provision a workspace for the pinned repository.",
            status_code=409,
        )
    return workspace.id


def workflow_arg_specs(version: WorkflowVersionRecord) -> list[ArgSpec]:
    """Parsed arg schema of a stored (already-validated) version."""

    try:
        _canonical, arg_specs = parse_definition(version.definition_json, require_steps=False)
    except WorkflowDefinitionError as exc:  # pragma: no cover - stored defs are valid
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc
    return arg_specs


def _validate_trigger_kind(kind: str) -> None:
    if kind not in SUPPORTED_WORKFLOW_TRIGGER_TYPES:
        raise CloudApiError(
            "invalid_trigger_kind", f"Unsupported trigger kind '{kind}'.", status_code=400
        )


def _validate_concurrency(policy: str) -> None:
    if policy not in SUPPORTED_WORKFLOW_CONCURRENCY_POLICIES:
        allowed = sorted(SUPPORTED_WORKFLOW_CONCURRENCY_POLICIES)
        raise CloudApiError(
            "invalid_concurrency_policy",
            f"concurrency_policy must be one of {allowed}.",
            status_code=400,
        )


def _validate_missed_run_policy(policy: str) -> None:
    if policy not in SUPPORTED_WORKFLOW_MISSED_RUN_POLICIES:
        allowed = sorted(SUPPORTED_WORKFLOW_MISSED_RUN_POLICIES)
        raise CloudApiError(
            "invalid_missed_run_policy",
            f"missed_run_policy must be one of {allowed}.",
            status_code=400,
        )


def _validate_trigger_target_mode(
    mode: str, *, kind: str = WORKFLOW_TRIGGER_KIND_SCHEDULE
) -> None:
    is_poll = kind == WORKFLOW_TRIGGER_KIND_POLL
    if mode == WORKFLOW_TARGET_MODE_LOCAL:
        # 2a: local SCHEDULE triggers are now a real path (desktop claim plane).
        # Local POLL triggers remain cloud-only until the poller lane learns the
        # claim/missed-run protocol.
        if is_poll:
            raise CloudApiError(
                "poll_local_unsupported",
                _POLL_LOCAL_UNSUPPORTED_MESSAGE,
                status_code=400,
            )
        return
    if mode != WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        raise CloudApiError(
            "invalid_target_mode",
            "target_mode must be 'personal_cloud' or 'local' for "
            + ("poll" if is_poll else "scheduled")
            + " triggers.",
            status_code=400,
        )


async def _assert_parallel_target_supported(
    db: AsyncSession, *, workflow: WorkflowRecord, target_mode: str
) -> None:
    """M1 (L30): a workflow whose current definition has parallel groups is
    cloud-only in v1 — reject a LOCAL-target trigger up front, mirroring the
    same StartRun bound (``parallel_local_unsupported``). No-op for cloud targets
    or a version-less draft (nothing runnable to laned-reject yet)."""

    if target_mode != WORKFLOW_TARGET_MODE_LOCAL:
        return
    if workflow.current_version_id is None:
        return
    version = await store.get_version(db, workflow.current_version_id)
    if version is None:
        return
    if has_parallel_groups(version.definition_json.get("agents")):
        raise CloudApiError(
            "parallel_local_unsupported",
            "Workflows with parallel groups are cloud-only in v1; a local (desktop) "
            "target is not supported for their triggers.",
            status_code=400,
        )


def _normalize_trigger_schedule(schedule: TriggerScheduleRequest) -> ParsedAutomationSchedule:
    try:
        return normalize_schedule(
            rrule_text=schedule.rrule, timezone=schedule.timezone, now=utcnow()
        )
    except AutomationScheduleError as exc:
        raise CloudApiError("invalid_schedule", str(exc), status_code=400) from exc


def _coerce_schedule_presets(
    arg_specs: list[ArgSpec], *, presets: dict[str, object]
) -> dict[str, object]:
    """Coerce a schedule trigger's preset input values (D16).

    Partial (only the presets provided are coerced; unknown keys and bad types
    still fail): a schedule with incomplete presets can be SAVED as a draft; the
    enable-gate — not coercion — is what blocks enabling it.
    """

    try:
        return coerce_arguments([spec for spec in arg_specs if spec.name in presets], presets)
    except ArgumentError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc


def _assert_schedule_enable_gate(
    arg_specs: list[ArgSpec], *, presets: dict[str, object], enabled: bool
) -> None:
    """D16 enable-gate: an ENABLED schedule trigger must preset every required
    input (a disabled draft may leave them blank)."""

    if not enabled:
        return
    missing = sorted(spec.name for spec in arg_specs if spec.required and spec.name not in presets)
    if missing:
        raise CloudApiError(
            "schedule_presets_incomplete",
            f"Preset every required input before enabling this schedule: {missing}.",
            status_code=400,
        )


async def _workflow_arg_specs_or_raise(
    db: AsyncSession, *, workflow_current_version_id: UUID | None
) -> list[ArgSpec]:
    if workflow_current_version_id is None:
        raise CloudApiError(
            "workflow_no_version",
            "Add at least one step before adding a trigger to this workflow.",
            status_code=409,
        )
    version = await store.get_version(db, workflow_current_version_id)
    if version is None:
        raise CloudApiError(
            "workflow_version_not_found", "Workflow version not found.", status_code=404
        )
    return workflow_arg_specs(version)


@dataclass(frozen=True)
class _ValidatedPollConfig:
    url: str
    auth_header: str | None
    interval_secs: int
    # None + update_auth False => keep existing; otherwise write this ciphertext.
    auth_ciphertext: str | None
    update_auth: bool
    # The plaintext auth value, kept only in-process for the init-time endpoint
    # probe (never returned to a caller, never stored plaintext). None on an
    # update that keeps the existing secret — the probe decrypts it instead.
    auth_value_plaintext: str | None


def _validate_poll_config(poll: TriggerPollRequest, *, is_update: bool) -> _ValidatedPollConfig:
    """Validate + normalize the poll endpoint config. Encrypts the auth value at
    write (never stored plaintext). ``is_update`` allows omitting the auth value to
    keep the existing stored secret."""

    url = poll.url.strip()
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        raise CloudApiError(
            "invalid_poll_config", "poll url must be an http(s) URL.", status_code=400
        )
    # The stored feed URL must be WIRE-FAITHFUL: what we store is exactly what the
    # poller (and the /init probe) send. A fragment (``#...``) is never sent on the
    # wire, so ``init_probe_url`` would otherwise append ``/init`` inside the
    # fragment and the "probe" would silently GET the real feed — reject it here so
    # the stored URL can never carry one. Userinfo (``user:pass@host``) is likewise
    # rejected: credentials belong in the auth header, not baked into the URL (and
    # the SSRF guard refuses them too).
    parsed = urlsplit(url)
    if parsed.fragment:
        raise CloudApiError(
            "invalid_poll_config",
            "poll url must not contain a URL fragment ('#...').",
            status_code=400,
        )
    if parsed.username or parsed.password:
        raise CloudApiError(
            "invalid_poll_config",
            "poll url must not embed credentials ('user:pass@host'); use an auth header.",
            status_code=400,
        )
    if poll.interval_secs < WORKFLOW_POLL_MIN_INTERVAL_SECONDS:
        raise CloudApiError(
            "invalid_poll_interval",
            f"poll interval must be at least {WORKFLOW_POLL_MIN_INTERVAL_SECONDS} seconds.",
            status_code=400,
        )

    auth_header = poll.auth_header.strip() if poll.auth_header else None
    if auth_header is None:
        # No auth header: any supplied value is meaningless; clear the secret.
        if poll.auth_value:
            raise CloudApiError(
                "invalid_poll_config",
                "an auth value requires an auth header name.",
                status_code=400,
            )
        return _ValidatedPollConfig(
            url=url,
            auth_header=None,
            interval_secs=poll.interval_secs,
            auth_ciphertext=None,
            update_auth=True,  # explicit "no auth"
            auth_value_plaintext=None,
        )
    if poll.auth_value:
        return _ValidatedPollConfig(
            url=url,
            auth_header=auth_header,
            interval_secs=poll.interval_secs,
            auth_ciphertext=encrypt_text(poll.auth_value),
            update_auth=True,
            auth_value_plaintext=poll.auth_value,
        )
    # Header named but no value supplied. On create this means "no secret"; on
    # update it means "keep the stored secret".
    if not is_update:
        raise CloudApiError(
            "invalid_poll_config",
            "an auth header requires an auth value on create.",
            status_code=400,
        )
    return _ValidatedPollConfig(
        url=url,
        auth_header=auth_header,
        interval_secs=poll.interval_secs,
        auth_ciphertext=None,
        update_auth=False,
        auth_value_plaintext=None,
    )


def _validate_poll_static_inputs(
    arg_specs: list[ArgSpec], *, static_inputs: dict[str, object]
) -> dict[str, object]:
    """Coerce a poll trigger's static input presets against the workflow inputs.

    Only the presets provided are coerced (strict: unknown keys and bad types
    fail at write, not at poll time). Required inputs NOT covered by a preset or a
    default are expected to arrive per-item in ``item.data`` — the derived item
    schema (D17) marks them required so the poller records a missing/mistyped item
    ``invalid``. The merged per-item inputs are re-coerced inside ``start_run``.
    """

    try:
        return coerce_arguments(
            [spec for spec in arg_specs if spec.name in static_inputs], static_inputs
        )
    except ArgumentError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=400) from exc


async def _probe_poll_signature(
    config: _ValidatedPollConfig,
    *,
    item_schema: dict[str, object],
    existing_ciphertext: str | None = None,
) -> None:
    """Init-time inputs-signature check (contract §2.2, amending L33a; mental-model
    §5 /init reserved path, RULED 2026-07-09).

    GET the reserved ``<endpoint>/init`` path once (NOT the feed URL — that is hit
    only by poll cycles) and validate that the returned sample items' ``data``
    carries fields named and typed exactly like the workflow's declared inputs (the
    derived ``item_schema``). A shape mismatch fails the trigger create/update so a
    misconfigured endpoint is caught before the poller ever fires — surfaced
    field-by-field so the setup UI can render the whole diff, not just the first
    miss. An ``/init`` that serves no sample item passes (nothing to contradict).
    """

    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    # SSRF pre-flight BEFORE any outbound request (no packet leaves on a denial).
    guard_poll_endpoint(init_probe_url(config.url))

    if config.auth_value_plaintext is not None:
        auth_value: str | None = config.auth_value_plaintext
    elif config.auth_header is not None and existing_ciphertext is not None:
        auth_value = decrypt_text(existing_ciphertext)
    else:
        auth_value = None
    try:
        page = await fetch_poll_page(
            url=init_probe_url(config.url),
            auth_header=config.auth_header,
            auth_value=auth_value,
            cursor=None,
        )
    except Exception as exc:
        raise CloudApiError(
            "poll_probe_failed",
            f"Could not reach the poll endpoint's /init path to verify its item shape: {exc}",
            status_code=400,
        ) from exc
    for item in page.items:
        mismatches = diff_item_against_schema(item.data, item_schema)
        if mismatches:
            detail = "; ".join(mismatches)
            # The FULL field-by-field diff rides the wire in ``extra_detail`` (merged
            # into the error ``detail`` by the ProliferateError handler), so the setup
            # UI renders every mismatched field — not just the first, and without
            # re-parsing the human message (mental-model §5 flow 2).
            raise CloudApiError(
                "poll_signature_mismatch",
                f"Poll item '{item.id}' does not match the workflow's declared inputs: {detail}",
                status_code=400,
                extra_detail={"item_id": item.id, "mismatches": mismatches},
            )


@dataclass(frozen=True)
class PollInspectResult:
    """Flow 1 (workflow-from-poll) probe result: the /init sample, the v2 ``inputs``
    skeleton derived from it, and the sample fields that could NOT become inputs
    (mental-model §5)."""

    sample_item_id: str | None
    sample_data: dict[str, object] | None
    derived_inputs: list[dict[str, object]]
    # Non-scalar sample fields (arrays/objects/null) that were skipped, each as
    # ``{"name", "reason"}`` — the UI shows these so the author knows which fields
    # didn't become inputs.
    skipped_fields: list[dict[str, str]]


async def inspect_poll_endpoint(poll: TriggerPollRequest) -> PollInspectResult:
    """Flow 1 — workflow-from-poll (mental-model §5, RULED 2026-07-09).

    "Enter API key + endpoint → we call ``/init`` → derive the starting inputs from
    the sample → hard error on bad response." Given an endpoint + optional auth, GET
    the reserved ``<endpoint>/init`` path (NOT the feed URL — poll cycles hit the
    feed only), take the first sample item, and project its ``data`` fields into a
    v2 ``inputs`` block the client seeds a brand-new workflow with. There is no
    workflow yet, so there is nothing to diff against — this only *derives*.

    A bad ``/init`` response (non-200, malformed, timeout, oversize, unreachable)
    raises a structured ``poll_probe_failed`` the setup UI renders. This is the same
    bounded network call as the signature probe (§11 risk profile: timeout,
    no redirect-following, response-size cap — enforced in ``fetch_poll_page``).
    An ``/init`` that serves no sample item derives nothing (empty inputs), leaving
    the author to declare inputs by hand.
    """

    from proliferate.server.cloud.workflows.poller import fetch_poll_page

    config = _validate_poll_config(poll, is_update=False)
    # SSRF pre-flight BEFORE any outbound request — this endpoint is stateless and
    # callable by any authed user with an arbitrary URL, so it is the sharpest edge
    # of the probe surface.
    guard_poll_endpoint(init_probe_url(config.url))
    try:
        page = await fetch_poll_page(
            url=init_probe_url(config.url),
            auth_header=config.auth_header,
            auth_value=config.auth_value_plaintext,
            cursor=None,
        )
    except Exception as exc:
        raise CloudApiError(
            "poll_probe_failed",
            f"Could not reach the poll endpoint's /init path to derive inputs: {exc}",
            status_code=400,
        ) from exc

    if not page.items:
        return PollInspectResult(
            sample_item_id=None, sample_data=None, derived_inputs=[], skipped_fields=[]
        )
    sample = page.items[0]
    return PollInspectResult(
        sample_item_id=sample.id,
        sample_data=dict(sample.data),
        derived_inputs=derive_inputs_from_sample(sample.data),
        skipped_fields=skipped_sample_fields(sample.data),
    )


async def _visible_trigger(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    workflow_id: UUID,
    trigger_id: UUID,
    mutable: bool = False,
) -> WorkflowTriggerRecord:
    await _visible_workflow(db, user=user, workflow_id=workflow_id, mutable=mutable)
    trigger = await trigger_store.get_trigger(db, trigger_id)
    if trigger is None or trigger.workflow_id != workflow_id:
        raise CloudApiError("trigger_not_found", "Trigger not found.", status_code=404)
    return trigger


async def create_trigger(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    body: WorkflowTriggerCreateRequest,
) -> WorkflowTriggerRecord:
    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id, mutable=True)
    if workflow.archived_at is not None:
        raise CloudApiError(
            "workflow_archived", "Cannot schedule an archived workflow.", status_code=409
        )
    _validate_trigger_kind(body.kind)
    _validate_concurrency(body.concurrency_policy)
    _validate_missed_run_policy(body.missed_run_policy)
    _validate_trigger_target_mode(body.target_mode, kind=body.kind)
    await _assert_parallel_target_supported(db, workflow=workflow, target_mode=body.target_mode)
    # D16: the repo pin is the authored "where". For a CLOUD target the server
    # derives + owns the cloud workspace it maps to. For a LOCAL target (2a) the
    # repo pin names the desktop's local worktree instead — no cloud workspace is
    # provisioned and target_workspace_id stays NULL (the local CHECK invariant).
    target_workspace_id: UUID | None = None
    if body.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        target_workspace_id = await _ensure_trigger_target_workspace(
            db, user=user, repo_full_name=body.repo_full_name
        )
    else:
        # Local target: the repo pin names the desktop's local worktree — validate
        # its "owner/name" shape (raises invalid_repo on missing/malformed) but do
        # NOT provision a cloud workspace.
        _split_repo_full_name(body.repo_full_name)

    if body.kind == WORKFLOW_TRIGGER_KIND_POLL:
        return await _create_poll_trigger(
            db, user, workflow, body, target_workspace_id=target_workspace_id
        )

    parsed = _normalize_trigger_schedule(_require_schedule(body.schedule))
    arg_specs = await _workflow_arg_specs_or_raise(
        db, workflow_current_version_id=workflow.current_version_id
    )
    presets = _coerce_schedule_presets(arg_specs, presets=body.args)
    _assert_schedule_enable_gate(arg_specs, presets=presets, enabled=body.enabled)
    return await trigger_store.create_trigger(
        db,
        workflow_id=workflow_id,
        created_by_user_id=user.id,
        kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
        concurrency_policy=body.concurrency_policy,
        missed_run_policy=body.missed_run_policy,
        target_mode=body.target_mode,
        repo_full_name=body.repo_full_name,
        target_workspace_id=target_workspace_id,
        input_presets_json=presets,
        schedule_rrule=parsed.rrule_text,
        schedule_timezone=parsed.timezone,
        schedule_summary=parsed.summary,
        next_run_at=parsed.next_run_at,
        # For schedule triggers the presets ARE the fire-time args.
        args_json=presets,
        enabled=body.enabled,
    )


def _require_schedule(schedule: TriggerScheduleRequest | None) -> TriggerScheduleRequest:
    if schedule is None:
        raise CloudApiError(
            "invalid_schedule", "A schedule is required for a schedule trigger.", status_code=400
        )
    return schedule


async def _create_poll_trigger(
    db: AsyncSession,
    user: ActorIdentity,
    workflow: WorkflowRecord,
    body: WorkflowTriggerCreateRequest,
    *,
    target_workspace_id: UUID,
) -> WorkflowTriggerRecord:
    if body.poll is None:
        raise CloudApiError(
            "invalid_poll_config", "A poll config is required for a poll trigger.", status_code=400
        )
    config = _validate_poll_config(body.poll, is_update=False)
    arg_specs = await _workflow_arg_specs_or_raise(
        db, workflow_current_version_id=workflow.current_version_id
    )
    coerced_static = _validate_poll_static_inputs(arg_specs, static_inputs=body.args)
    # The item schema is DERIVED from the inputs (D17): inputs already covered by a
    # static preset need not appear per-item, so they are not required on the item.
    item_schema = derive_item_schema(arg_specs, covered_names=coerced_static.keys())
    await _probe_poll_signature(config, item_schema=item_schema)
    return await trigger_store.create_trigger(
        db,
        workflow_id=workflow.id,
        created_by_user_id=user.id,
        kind=WORKFLOW_TRIGGER_KIND_POLL,
        concurrency_policy=body.concurrency_policy,
        target_mode=body.target_mode,
        repo_full_name=body.repo_full_name,
        target_workspace_id=target_workspace_id,
        poll_url=config.url,
        poll_auth_header=config.auth_header,
        poll_auth_ciphertext=config.auth_ciphertext,
        poll_interval_secs=config.interval_secs,
        poll_item_schema_json=item_schema,
        args_json=coerced_static,
        enabled=body.enabled,
    )


async def list_triggers(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID
) -> list[WorkflowTriggerRecord]:
    await _visible_workflow(db, user=user, workflow_id=workflow_id)
    return list(await trigger_store.list_triggers_for_workflow(db, workflow_id=workflow_id))


async def get_trigger(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID, trigger_id: UUID
) -> WorkflowTriggerRecord:
    return await _visible_trigger(db, user=user, workflow_id=workflow_id, trigger_id=trigger_id)


async def update_trigger(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    trigger_id: UUID,
    body: WorkflowTriggerUpdateRequest,
) -> WorkflowTriggerRecord:
    workflow = await _visible_workflow(db, user=user, workflow_id=workflow_id, mutable=True)
    existing = await _visible_trigger(
        db, user=user, workflow_id=workflow_id, trigger_id=trigger_id
    )

    # Merge onto the existing config, then re-validate the whole trigger.
    target_mode = body.target_mode if body.target_mode is not None else existing.target_mode
    concurrency = (
        body.concurrency_policy
        if body.concurrency_policy is not None
        else existing.concurrency_policy
    )
    missed_run_policy = (
        body.missed_run_policy
        if body.missed_run_policy is not None
        else existing.missed_run_policy
    )
    enabled = body.enabled if body.enabled is not None else existing.enabled
    _validate_concurrency(concurrency)
    _validate_missed_run_policy(missed_run_policy)
    _validate_trigger_target_mode(target_mode, kind=existing.kind)
    await _assert_parallel_target_supported(db, workflow=workflow, target_mode=target_mode)

    # D16: re-pinning the repo re-derives a fresh server-owned workspace; leaving
    # it alone keeps the existing derived workspace.
    repo_changed = body.repo_full_name is not None and body.repo_full_name.strip() != (
        existing.repo_full_name or ""
    )
    repo_full_name = body.repo_full_name if repo_changed else existing.repo_full_name
    # Local targets never carry a cloud workspace (2a): re-pinning the repo only
    # changes which local worktree the desktop uses. Cloud targets re-derive —
    # also when the target_mode itself is switching TO personal_cloud, since a
    # trigger that was local has no workspace yet (target_workspace_id is None)
    # and the CHECK constraint requires one for personal_cloud.
    clear_target_workspace = target_mode == WORKFLOW_TARGET_MODE_LOCAL
    if clear_target_workspace:
        target_workspace_id: UUID | None = None
    elif repo_changed or existing.target_workspace_id is None:
        target_workspace_id = await _ensure_trigger_target_workspace(
            db, user=user, repo_full_name=repo_full_name
        )
    else:
        target_workspace_id = existing.target_workspace_id

    if existing.kind == WORKFLOW_TRIGGER_KIND_POLL:
        return await _update_poll_trigger(
            db,
            workflow=workflow,
            existing=existing,
            body=body,
            enabled=enabled,
            concurrency=concurrency,
            target_mode=target_mode,
            repo_full_name=repo_full_name,
            target_workspace_id=target_workspace_id,
            clear_target_workspace=clear_target_workspace,
        )
    if body.poll is not None:
        raise CloudApiError(
            "invalid_poll_config", "This trigger is not a poll trigger.", status_code=400
        )

    # Schedule: recompute the cursor only when it would otherwise be stale — the
    # RRULE/timezone changed, or the trigger is (re-)entering the due scan. An
    # args-/concurrency-only edit on a running trigger must NOT shift next_run_at,
    # and a dormant past slot must not fire the instant it re-enables.
    schedule_changed = body.schedule is not None and (
        body.schedule.rrule.strip() != (existing.schedule_rrule or "")
        or body.schedule.timezone.strip() != (existing.schedule_timezone or "")
    )
    schedule_source = body.schedule or TriggerScheduleRequest(
        rrule=existing.schedule_rrule or "", timezone=existing.schedule_timezone or ""
    )
    parsed = _normalize_trigger_schedule(schedule_source)
    becoming_enabled = enabled and not existing.enabled
    recompute_cursor = schedule_changed or becoming_enabled or existing.next_run_at is None
    next_run_at = parsed.next_run_at if recompute_cursor else None

    presets_source = body.args if body.args is not None else existing.input_presets_json or {}
    arg_specs = await _workflow_arg_specs_or_raise(
        db, workflow_current_version_id=workflow.current_version_id
    )
    presets = _coerce_schedule_presets(arg_specs, presets=presets_source)
    _assert_schedule_enable_gate(arg_specs, presets=presets, enabled=enabled)

    updated = await trigger_store.update_trigger(
        db,
        trigger_id=trigger_id,
        enabled=enabled,
        concurrency_policy=concurrency,
        missed_run_policy=missed_run_policy,
        target_mode=target_mode,
        repo_full_name=repo_full_name,
        target_workspace_id=target_workspace_id,
        clear_target_workspace=clear_target_workspace,
        input_presets_json=presets,
        write_input_presets=True,
        schedule_rrule=parsed.rrule_text,
        schedule_timezone=parsed.timezone,
        schedule_summary=parsed.summary,
        next_run_at=next_run_at,
        args_json=presets,
    )
    assert updated is not None
    return updated


async def _update_poll_trigger(
    db: AsyncSession,
    *,
    workflow: WorkflowRecord,
    existing: WorkflowTriggerRecord,
    body: WorkflowTriggerUpdateRequest,
    enabled: bool,
    concurrency: str,
    target_mode: str,
    repo_full_name: str | None,
    target_workspace_id: UUID | None,
    clear_target_workspace: bool,
) -> WorkflowTriggerRecord:
    if body.schedule is not None:
        raise CloudApiError("invalid_schedule", "A poll trigger has no schedule.", status_code=400)

    # Poll config: a supplied ``poll`` block fully replaces the endpoint config
    # (auth value stays write-only — omitting it keeps the stored secret). Absent,
    # the existing config stands and only enabled/concurrency/target/args change.
    config = _validate_poll_config(body.poll, is_update=True) if body.poll is not None else None

    arg_specs = await _workflow_arg_specs_or_raise(
        db, workflow_current_version_id=workflow.current_version_id
    )
    static_args = body.args if body.args is not None else existing.args_json
    coerced_static = _validate_poll_static_inputs(arg_specs, static_inputs=static_args)
    # Re-derive the item schema whenever the inputs' static coverage may have moved.
    item_schema = derive_item_schema(arg_specs, covered_names=coerced_static.keys())

    # Re-probe the reserved /init path when EITHER the endpoint config changed (a
    # poll-block edit could reshape auth/url) OR the workflow's inputs changed since
    # this trigger was last validated. The derived item_schema drifting from the
    # stored one IS "the workflow's inputs changed" (mental-model §5: re-checked when
    # the workflow's inputs change — D17's init-time check mechanism). When only the
    # inputs moved, the endpoint config is unchanged, so probe it from the existing
    # config + stored secret. Either way a signature mismatch hard-fails the update.
    inputs_changed = item_schema != (existing.poll_item_schema_json or {})
    probe_config = config
    if probe_config is None and inputs_changed:
        probe_config = _ValidatedPollConfig(
            url=existing.poll_url,
            auth_header=existing.poll_auth_header,
            interval_secs=existing.poll_interval_secs,
            auth_ciphertext=None,
            update_auth=False,
            auth_value_plaintext=None,
        )
    # Never let the /init reprobe block a transition to disabled. A disabled trigger
    # never polls, so its endpoint shape is irrelevant while off — and forcing a
    # live probe here would BRICK ``PATCH {enabled:false}`` whenever the endpoint is
    # down (the very time an operator most wants to disable it). The reprobe still
    # fires for an enabled trigger whose config/inputs changed; a re-enable later
    # that changes the config/inputs re-validates then.
    if probe_config is not None and enabled:
        # The read record omits the write-only secret; the probe decrypts the stored
        # ciphertext when no fresh auth value was supplied (config-kept-secret or an
        # inputs-only re-validation).
        existing_ciphertext = await trigger_store.get_poll_auth_ciphertext(db, existing.id)
        await _probe_poll_signature(
            probe_config,
            item_schema=item_schema,
            existing_ciphertext=existing_ciphertext,
        )

    # Always rewrite the derived item schema (inputs may have changed); pass the
    # existing endpoint fields through when no poll block was supplied so they are
    # never nulled.
    updated = await trigger_store.update_trigger(
        db,
        trigger_id=existing.id,
        enabled=enabled,
        concurrency_policy=concurrency,
        target_mode=target_mode,
        repo_full_name=repo_full_name,
        target_workspace_id=target_workspace_id,
        clear_target_workspace=clear_target_workspace,
        args_json=coerced_static,
        write_poll_config=True,
        poll_url=config.url if config is not None else existing.poll_url,
        poll_auth_header=(config.auth_header if config is not None else existing.poll_auth_header),
        poll_interval_secs=(
            config.interval_secs if config is not None else existing.poll_interval_secs
        ),
        poll_item_schema_json=item_schema,
        update_poll_auth=config.update_auth if config is not None else False,
        poll_auth_ciphertext=config.auth_ciphertext if config is not None else None,
    )
    assert updated is not None
    return updated


async def delete_trigger(
    db: AsyncSession, user: ActorIdentity, workflow_id: UUID, trigger_id: UUID
) -> None:
    await _visible_trigger(
        db, user=user, workflow_id=workflow_id, trigger_id=trigger_id, mutable=True
    )
    await trigger_store.delete_trigger(db, trigger_id)


async def list_trigger_items(
    db: AsyncSession,
    user: ActorIdentity,
    workflow_id: UUID,
    trigger_id: UUID,
    *,
    limit: int = 100,
    offset: int = 0,
) -> list[trigger_store.WorkflowTriggerItemRecord]:
    """A poll trigger's seen-set items, newest first (the per-item trigger UI)."""

    await _visible_trigger(db, user=user, workflow_id=workflow_id, trigger_id=trigger_id)
    return list(
        await trigger_store.list_trigger_items(
            db, trigger_id=trigger_id, limit=limit, offset=offset
        )
    )
