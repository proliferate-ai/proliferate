"""Cloud workflows API request/response models and payload constructors."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from proliferate.db.store.cloud_workflow_triggers import (
    WorkflowTriggerItemRecord,
    WorkflowTriggerRecord,
)
from proliferate.db.store.cloud_workflows import (
    WorkflowRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
)

WorkflowTargetMode = Literal["local", "personal_cloud"]
WorkflowTriggerKind = Literal["manual", "schedule", "chat", "agent", "api"]
WorkflowRunObservableStatus = Literal[
    "running", "waiting_approval", "completed", "failed", "cancelled"
]
WorkflowTriggerConcurrency = Literal["skip", "queue"]
WorkflowMissedRunPolicy = Literal["run_latest", "skip_all", "replay_all"]
WorkflowTriggerTargetMode = Literal["local", "personal_cloud"]


class WorkflowBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


# --- requests ------------------------------------------------------------------


class WorkflowCreateRequest(WorkflowBaseModel):
    name: str
    description: str | None = None
    # Raw definition object; validated strictly by the domain layer on write.
    definition: dict[str, object]


class WorkflowUpdateRequest(WorkflowBaseModel):
    name: str | None = None
    description: str | None = None
    definition: dict[str, object]


class WorkflowRunTarget(WorkflowBaseModel):
    """Where a run works (data-contract §3): exactly one of a workspace (manual/
    chat — the workspace you're in) or a trigger (schedule/poll — the server
    derives the pinned workspace from the trigger row; derivation itself is PR G)."""

    workspace_id: UUID | None = Field(default=None, alias="workspaceId")
    trigger_id: UUID | None = Field(default=None, alias="triggerId")

    @model_validator(mode="after")
    def _exactly_one(self) -> WorkflowRunTarget:
        if (self.workspace_id is None) == (self.trigger_id is None):
            raise ValueError("target must set exactly one of workspace_id or trigger_id.")
        return self


class StartRunRequest(WorkflowBaseModel):
    # B9: ``args`` -> ``inputs``. Freeform values coerced against the inputs schema.
    inputs: dict[str, object] = Field(default_factory=dict)
    target_mode: WorkflowTargetMode = Field(alias="targetMode")
    version_id: UUID | None = Field(default=None, alias="versionId")
    # B9 target = workspace_id XOR trigger_id (validated exactly-one). For a
    # ``personal_cloud`` run the workspace is the delivery destination; for a
    # trigger-fired run the workspace is derived server-side (PR G).
    target: WorkflowRunTarget
    # L29: optional per-slot session binding (slot -> session_id). Bind-time
    # validation (same-harness, not held) lands with the session plane.
    session_bindings: dict[str, str] = Field(default_factory=dict, alias="sessionBindings")

    @property
    def target_workspace_id(self) -> UUID | None:
        return self.target.workspace_id

    @property
    def trigger_id(self) -> UUID | None:
        return self.target.trigger_id


class RunStatusRequest(WorkflowBaseModel):
    status: WorkflowRunObservableStatus
    step_cursor: int | None = Field(default=None, alias="stepCursor")
    step_outputs: dict[str, object] | None = Field(default=None, alias="stepOutputs")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")
    anyharness_workspace_id: str | None = Field(default=None, alias="anyharnessWorkspaceId")
    anyharness_session_ids: list[str] | None = Field(default=None, alias="anyharnessSessionIds")
    cost_usd: float | None = Field(default=None, alias="costUsd")
    cost_tokens: int | None = Field(default=None, alias="costTokens")
    # Desktop-executor lane (2a) claim ownership. The desktop relay stamps the claim
    # it holds onto every report for a LOCAL run. For a local run a desktop still
    # holds a live claim on (claimed/running/waiting_approval), an owner-authed
    # report whose claim_id != the run's CURRENT claim is rejected (409 stale_claim)
    # and one that omits it is rejected too — so a laptop whose run was reclaimed by
    # another device can't drive the run via owner-authed /status. Absent on cloud
    # runs (the runtime self-reports via its per-run gateway token); behavior there
    # is unchanged.
    claim_id: UUID | None = Field(default=None, alias="claimId")


# --- responses -----------------------------------------------------------------


class WorkflowResponse(WorkflowBaseModel):
    id: str
    # Nullable: seeded workflows (track 1f) are org-agnostic and have no owner.
    owner_user_id: str | None = Field(alias="ownerUserId")
    created_by_user_id: str | None = Field(alias="createdByUserId")
    name: str
    description: str | None
    current_version_id: str | None = Field(alias="currentVersionId")
    archived_at: str | None = Field(alias="archivedAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    # Track 1f: True for code-defined seed rows reconciled at boot (the
    # strip/picker's "seeds also feed it" source, per R5).
    is_seed: bool = Field(default=False, alias="isSeed")
    seed_slug: str | None = Field(default=None, alias="seedSlug")


class WorkflowVersionResponse(WorkflowBaseModel):
    id: str
    workflow_id: str = Field(alias="workflowId")
    version_n: int = Field(alias="versionN")
    definition: dict[str, object]
    created_by_user_id: str | None = Field(alias="createdByUserId")
    created_at: str = Field(alias="createdAt")


class WorkflowDetailResponse(WorkflowBaseModel):
    workflow: WorkflowResponse
    current_version: WorkflowVersionResponse | None = Field(alias="currentVersion")
    versions: list[WorkflowVersionResponse]


class WorkflowListResponse(WorkflowBaseModel):
    workflows: list[WorkflowResponse]


class WorkflowRunResponse(WorkflowBaseModel):
    id: str
    workflow_id: str = Field(alias="workflowId")
    workflow_version_id: str = Field(alias="workflowVersionId")
    trigger_kind: str = Field(alias="triggerKind")
    # Set for scheduled runs — links a run to the trigger occurrence that fired it.
    trigger_id: str | None = Field(alias="triggerId")
    scheduled_for: str | None = Field(alias="scheduledFor")
    executor_user_id: str = Field(alias="executorUserId")
    args: dict[str, object]
    target_mode: str = Field(alias="targetMode")
    resolved_plan: dict[str, object] = Field(alias="resolvedPlan")
    status: str
    step_cursor: int | None = Field(alias="stepCursor")
    step_outputs: dict[str, object] | None = Field(alias="stepOutputs")
    anyharness_workspace_id: str | None = Field(alias="anyharnessWorkspaceId")
    anyharness_session_ids: list[str] | None = Field(alias="anyharnessSessionIds")
    error_code: str | None = Field(alias="errorCode")
    error_message: str | None = Field(alias="errorMessage")
    cost_usd: str | None = Field(alias="costUsd")
    cost_tokens: int | None = Field(alias="costTokens")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    delivered_at: str | None = Field(alias="deliveredAt")
    started_at: str | None = Field(alias="startedAt")
    finished_at: str | None = Field(alias="finishedAt")
    # D15: the user who took over / cancelled the run (audit).
    stopped_by_user_id: str | None = Field(default=None, alias="stoppedByUserId")
    # Desktop-executor claim plane (2a); populated only on claimed local runs.
    executor_id: str | None = Field(default=None, alias="executorId")
    claim_id: str | None = Field(default=None, alias="claimId")
    claimed_at: str | None = Field(default=None, alias="claimedAt")
    claim_expires_at: str | None = Field(default=None, alias="claimExpiresAt")
    last_heartbeat_at: str | None = Field(default=None, alias="lastHeartbeatAt")


class StepActionResponse(WorkflowBaseModel):
    step_key: str = Field(alias="stepKey")
    action_kind: str = Field(alias="actionKind")
    status: str
    result_json: dict[str, object] | None = Field(alias="resultJson")
    error_message: str | None = Field(alias="errorMessage")
    attempt_count: int = Field(alias="attemptCount")


class WorkflowRunDetailResponse(WorkflowBaseModel):
    run: WorkflowRunResponse
    step_actions: list[StepActionResponse] = Field(alias="stepActions")


class WorkflowRunListResponse(WorkflowBaseModel):
    runs: list[WorkflowRunResponse]


class SlackChannelResponse(WorkflowBaseModel):
    id: str
    name: str


class SlackChannelsResponse(WorkflowBaseModel):
    channels: list[SlackChannelResponse]
    connected: bool


# --- constructors --------------------------------------------------------------


def _iso(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


def workflow_payload(record: WorkflowRecord) -> WorkflowResponse:
    return WorkflowResponse(
        id=str(record.id),
        owner_user_id=str(record.owner_user_id) if record.owner_user_id else None,
        created_by_user_id=(str(record.created_by_user_id) if record.created_by_user_id else None),
        name=record.name,
        description=record.description,
        current_version_id=str(record.current_version_id) if record.current_version_id else None,
        archived_at=_iso(record.archived_at),
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
        is_seed=record.is_seed,
        seed_slug=record.seed_slug,
    )


def version_payload(record: WorkflowVersionRecord) -> WorkflowVersionResponse:
    return WorkflowVersionResponse(
        id=str(record.id),
        workflow_id=str(record.workflow_id),
        version_n=record.version_n,
        definition=record.definition_json,
        created_by_user_id=(str(record.created_by_user_id) if record.created_by_user_id else None),
        created_at=record.created_at.isoformat(),
    )


def workflow_detail_payload(
    workflow: WorkflowRecord,
    versions: list[WorkflowVersionRecord],
) -> WorkflowDetailResponse:
    current = next((v for v in versions if v.id == workflow.current_version_id), None)
    return WorkflowDetailResponse(
        workflow=workflow_payload(workflow),
        current_version=version_payload(current) if current is not None else None,
        versions=[version_payload(v) for v in versions],
    )


def _decimal_str(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


def run_payload(record: WorkflowRunRecord) -> WorkflowRunResponse:
    return WorkflowRunResponse(
        id=str(record.id),
        workflow_id=str(record.workflow_id),
        workflow_version_id=str(record.workflow_version_id),
        trigger_kind=record.trigger_kind,
        trigger_id=str(record.trigger_id) if record.trigger_id else None,
        scheduled_for=_iso(record.scheduled_for),
        executor_user_id=str(record.executor_user_id),
        args=record.args_json,
        target_mode=record.target_mode,
        resolved_plan=record.resolved_plan_json,
        status=record.status,
        step_cursor=record.step_cursor,
        step_outputs=record.step_outputs_json,
        anyharness_workspace_id=record.anyharness_workspace_id,
        anyharness_session_ids=record.anyharness_session_ids,
        error_code=record.error_code,
        error_message=record.error_message,
        cost_usd=_decimal_str(record.cost_usd),
        cost_tokens=record.cost_tokens,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
        delivered_at=_iso(record.delivered_at),
        started_at=_iso(record.started_at),
        finished_at=_iso(record.finished_at),
        stopped_by_user_id=(str(record.stopped_by_user_id) if record.stopped_by_user_id else None),
        executor_id=record.executor_id,
        claim_id=str(record.claim_id) if record.claim_id else None,
        claimed_at=_iso(record.claimed_at),
        claim_expires_at=_iso(record.claim_expires_at),
        last_heartbeat_at=_iso(record.last_heartbeat_at),
    )


# --- desktop executor claim plane (track 2a) -----------------------------------


class LocalWorkflowClaimRequest(WorkflowBaseModel):
    """A desktop executor's claim poll: identify the executor + cap the batch."""

    executor_id: str = Field(alias="executorId")
    limit: int = 5


class LocalWorkflowClaimActionRequest(WorkflowBaseModel):
    """A per-run action (heartbeat) proving which claim the executor holds."""

    executor_id: str = Field(alias="executorId")
    claim_id: UUID = Field(alias="claimId")


class LocalWorkflowClaimListResponse(WorkflowBaseModel):
    """Runs the poll claimed this cycle — each carries its resolved plan + claim."""

    runs: list[WorkflowRunResponse]


class LocalWorkflowClaimMutationResponse(WorkflowBaseModel):
    """A heartbeat outcome: the refreshed run, or ``accepted=false`` when the claim
    is no longer live (reclaimed / terminal / expired) and the executor must stop."""

    run: WorkflowRunResponse | None = None
    accepted: bool


# --- triggers (spec 3.5) -------------------------------------------------------


class TriggerScheduleRequest(WorkflowBaseModel):
    """The RRULE + IANA timezone a schedule trigger fires on (house RRULE rules)."""

    rrule: str
    timezone: str


class TriggerPollRequest(WorkflowBaseModel):
    """Poll trigger config (spec 4.2/4.3). ``auth_value`` is the header VALUE and is
    WRITE-ONLY: it is encrypted at rest (house crypto) and never echoed back on a
    read. Omitting it on an update keeps the stored secret; setting ``auth_header``
    to null clears the auth entirely."""

    # The poll item schema is DERIVED from the workflow's declared inputs (D17):
    # there is no authoring surface, so this request carries no item_schema or
    # args_mapping — item data is matched to inputs by name.
    url: str
    auth_header: str | None = Field(default=None, alias="authHeader")
    auth_value: str | None = Field(default=None, alias="authValue")
    interval_secs: int = Field(alias="intervalSecs")


class PollInspectRequest(WorkflowBaseModel):
    """Flow 1 (workflow-from-poll, mental-model §5): probe a poll endpoint's
    reserved ``/init`` path to derive a new workflow's starting inputs. Carries no
    interval — no trigger exists yet; ``auth_value`` is the header VALUE, sent once
    for the probe and never stored by this call."""

    url: str
    auth_header: str | None = Field(default=None, alias="authHeader")
    auth_value: str | None = Field(default=None, alias="authValue")


class PollInputSpecResponse(WorkflowBaseModel):
    """One derived v2 input spec (``{name, type, required}``) — the same canonical
    shape the definition validator accepts, so the client seeds a definition's
    ``inputs`` directly."""

    name: str
    type: str
    required: bool


class PollSkippedFieldResponse(WorkflowBaseModel):
    """One sample field that could NOT become a derived input (a non-scalar
    array/object/null value), with a human ``reason``. Surfaced so the flow-1 UI
    can tell the author which sample fields didn't become inputs."""

    name: str
    reason: str


class PollInspectResponse(WorkflowBaseModel):
    """Flow 1 result: the /init sample item (if any), the derived inputs skeleton,
    and the sample fields that couldn't become inputs. A bad /init response never
    reaches here — it raises a structured ``poll_probe_failed`` error instead."""

    sample_item_id: str | None = Field(alias="sampleItemId")
    sample_data: dict[str, object] | None = Field(alias="sampleData")
    derived_inputs: list[PollInputSpecResponse] = Field(alias="derivedInputs")
    skipped_fields: list[PollSkippedFieldResponse] = Field(alias="skippedFields")


class WorkflowTriggerCreateRequest(WorkflowBaseModel):
    # v1 vocabulary is schedule + poll; the field stays open so webhook/api slot in.
    kind: Literal["schedule", "poll"] = "schedule"
    enabled: bool = True
    concurrency_policy: WorkflowTriggerConcurrency = Field(alias="concurrencyPolicy")
    # Missed-run policy (schedule triggers; mental-model §4). Defaults run_latest.
    missed_run_policy: WorkflowMissedRunPolicy = Field(
        default="run_latest", alias="missedRunPolicy"
    )
    target_mode: WorkflowTriggerTargetMode = Field(alias="targetMode")
    # D16: the authored "where" is a repo pin ("org/repo"), not a workspace id.
    # The server derives + owns the dedicated cloud workspace. Required for
    # schedule/poll (validated in the service, enforced by DB CHECK).
    repo_full_name: str | None = Field(default=None, alias="repoFullName")
    # Exactly one of schedule / poll is required, matching ``kind``.
    schedule: TriggerScheduleRequest | None = None
    poll: TriggerPollRequest | None = None
    # Schedule preset input values / poll static input defaults.
    args: dict[str, object] = Field(default_factory=dict)


class WorkflowTriggerUpdateRequest(WorkflowBaseModel):
    """Partial update: only supplied fields change, then the whole trigger is
    re-validated as a unit (schedule/poll ⋈ target ⋈ args are interdependent)."""

    enabled: bool | None = None
    concurrency_policy: WorkflowTriggerConcurrency | None = Field(
        default=None, alias="concurrencyPolicy"
    )
    missed_run_policy: WorkflowMissedRunPolicy | None = Field(
        default=None, alias="missedRunPolicy"
    )
    target_mode: WorkflowTriggerTargetMode | None = Field(default=None, alias="targetMode")
    # D16: re-pinning the repo re-derives the workspace. None = no change.
    repo_full_name: str | None = Field(default=None, alias="repoFullName")
    schedule: TriggerScheduleRequest | None = None
    poll: TriggerPollRequest | None = None
    args: dict[str, object] | None = None


class TriggerScheduleResponse(WorkflowBaseModel):
    rrule: str
    timezone: str
    summary: str | None


class TriggerPollResponse(WorkflowBaseModel):
    """Poll config on a read — the secret is never echoed; ``has_auth`` reports
    whether an encrypted auth value is stored, and ``auth_header`` its name."""

    url: str
    auth_header: str | None = Field(alias="authHeader")
    has_auth: bool = Field(alias="hasAuth")
    interval_secs: int = Field(alias="intervalSecs")
    # Derived (read-only) item schema — surfaced so the UI can show what shape the
    # endpoint must return, but never authored.
    item_schema: dict[str, object] | None = Field(alias="itemSchema")
    last_poll_at: str | None = Field(alias="lastPollAt")
    last_poll_error: str | None = Field(alias="lastPollError")


class WorkflowTriggerResponse(WorkflowBaseModel):
    id: str
    workflow_id: str = Field(alias="workflowId")
    kind: str
    enabled: bool
    concurrency_policy: str = Field(alias="concurrencyPolicy")
    missed_run_policy: str = Field(alias="missedRunPolicy")
    target_mode: str = Field(alias="targetMode")
    # D16: the authored repo pin + the derived (server-owned) workspace it maps to.
    repo_full_name: str | None = Field(alias="repoFullName")
    target_workspace_id: str | None = Field(alias="targetWorkspaceId")
    # Schedule preset input values (the enable-gate record); null for poll.
    input_presets: dict[str, object] | None = Field(default=None, alias="inputPresets")
    schedule: TriggerScheduleResponse | None
    poll: TriggerPollResponse | None = None
    next_run_at: str | None = Field(alias="nextRunAt")
    last_scheduled_at: str | None = Field(alias="lastScheduledAt")
    last_skipped_at: str | None = Field(alias="lastSkippedAt")
    last_skip_reason: str | None = Field(alias="lastSkipReason")
    args: dict[str, object]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class WorkflowTriggerListResponse(WorkflowBaseModel):
    triggers: list[WorkflowTriggerResponse]


class WorkflowTriggerItemResponse(WorkflowBaseModel):
    """One seen-set item for a poll trigger's per-item table (spec 8.2 row B)."""

    item_id: str = Field(alias="itemId")
    run_id: str | None = Field(alias="runId")
    status: str
    error_message: str | None = Field(alias="errorMessage")
    received_at: str = Field(alias="receivedAt")


class WorkflowTriggerItemListResponse(WorkflowBaseModel):
    items: list[WorkflowTriggerItemResponse]


def trigger_payload(record: WorkflowTriggerRecord) -> WorkflowTriggerResponse:
    schedule = (
        TriggerScheduleResponse(
            rrule=record.schedule_rrule,
            timezone=record.schedule_timezone,
            summary=record.schedule_summary,
        )
        if record.schedule_rrule is not None and record.schedule_timezone is not None
        else None
    )
    poll = (
        TriggerPollResponse(
            url=record.poll_url,
            auth_header=record.poll_auth_header,
            has_auth=record.poll_has_auth,
            interval_secs=record.poll_interval_secs,
            item_schema=record.poll_item_schema_json,
            last_poll_at=_iso(record.last_poll_at),
            last_poll_error=record.last_poll_error,
        )
        if record.poll_url is not None and record.poll_interval_secs is not None
        else None
    )
    return WorkflowTriggerResponse(
        id=str(record.id),
        workflow_id=str(record.workflow_id),
        kind=record.kind,
        enabled=record.enabled,
        concurrency_policy=record.concurrency_policy,
        missed_run_policy=record.missed_run_policy,
        target_mode=record.target_mode,
        repo_full_name=record.repo_full_name,
        target_workspace_id=(
            str(record.target_workspace_id) if record.target_workspace_id else None
        ),
        input_presets=record.input_presets_json,
        schedule=schedule,
        poll=poll,
        next_run_at=_iso(record.next_run_at),
        last_scheduled_at=_iso(record.last_scheduled_at),
        last_skipped_at=_iso(record.last_skipped_at),
        last_skip_reason=record.last_skip_reason,
        args=record.args_json,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


def trigger_item_payload(record: WorkflowTriggerItemRecord) -> WorkflowTriggerItemResponse:
    return WorkflowTriggerItemResponse(
        item_id=record.item_id,
        run_id=str(record.run_id) if record.run_id else None,
        status=record.status,
        error_message=record.error_message,
        received_at=record.received_at.isoformat(),
    )
