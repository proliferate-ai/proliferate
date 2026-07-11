"""Shared hardcoded constants for workflow definitions, versions, and runs.

The step vocabulary, trigger kinds, run statuses, and transition table encode the
v1 contract from ``specs/tbd/goals-and-workflows-v1.md`` (sections 3.2, 3.3, 3.5).
These values are also enforced by DB ``CHECK`` constraints; keep the two in sync.
"""

from __future__ import annotations

from typing import Final

# --- Trigger kinds (spec 3.5). Every trigger funnels through one StartRun. -----
WORKFLOW_TRIGGER_MANUAL: Final = "manual"
WORKFLOW_TRIGGER_SCHEDULE: Final = "schedule"
WORKFLOW_TRIGGER_POLL: Final = "poll"
WORKFLOW_TRIGGER_CHAT: Final = "chat"
WORKFLOW_TRIGGER_AGENT: Final = "agent"
WORKFLOW_TRIGGER_API: Final = "api"
SUPPORTED_WORKFLOW_TRIGGER_KINDS: Final = frozenset(
    {
        WORKFLOW_TRIGGER_MANUAL,
        WORKFLOW_TRIGGER_SCHEDULE,
        WORKFLOW_TRIGGER_POLL,
        WORKFLOW_TRIGGER_CHAT,
        WORKFLOW_TRIGGER_AGENT,
        WORKFLOW_TRIGGER_API,
    }
)

# --- Target modes (spec 3.2 delivery lanes; v1 personal only). -----------------
WORKFLOW_TARGET_MODE_LOCAL: Final = "local"
WORKFLOW_TARGET_MODE_PERSONAL_CLOUD: Final = "personal_cloud"
SUPPORTED_WORKFLOW_TARGET_MODES: Final = frozenset(
    {
        WORKFLOW_TARGET_MODE_LOCAL,
        WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    }
)

# --- Run lifecycle statuses (spec 3.2). ----------------------------------------
# The run id is the delivery idempotency key: a run is created pending_delivery,
# the client marks it delivered once it has handed the resolved plan to a local/
# cloud anyharness, and the runtime then reports observed transitions.
WORKFLOW_RUN_STATUS_PENDING_DELIVERY: Final = "pending_delivery"
# Desktop-executor lane (track 2a; lifts L15). A server-created *local* scheduled
# run is born ``claimable`` (NOT ``pending_delivery`` — nothing on the server ever
# delivers it): it waits for a desktop executor to claim it. The claim/heartbeat
# lifecycle mirrors the automations claim row (``claimable`` -> ``claimed`` with a
# heartbeat -> ``running`` -> terminal; a stale heartbeat makes a ``claimed`` run
# reclaimable). Cloud runs never enter these two statuses.
WORKFLOW_RUN_STATUS_CLAIMABLE: Final = "claimable"
WORKFLOW_RUN_STATUS_CLAIMED: Final = "claimed"
WORKFLOW_RUN_STATUS_DELIVERED: Final = "delivered"
WORKFLOW_RUN_STATUS_RUNNING: Final = "running"
WORKFLOW_RUN_STATUS_WAITING_APPROVAL: Final = "waiting_approval"
WORKFLOW_RUN_STATUS_COMPLETED: Final = "completed"
WORKFLOW_RUN_STATUS_FAILED: Final = "failed"
WORKFLOW_RUN_STATUS_CANCELLED: Final = "cancelled"
# Missed-run policy (1c): a terminal, server-created history row for a schedule
# occurrence that was NOT fired (an older slot under run_latest, or every slot
# under skip_all) because the scheduler was down while it came due. No sandbox is
# launched, no plan delivered — it exists only so run history has no silent gaps
# (mental-model §4). The runtime never sees or reports this status.
WORKFLOW_RUN_STATUS_MISSED: Final = "missed"

SUPPORTED_WORKFLOW_RUN_STATUSES: Final = frozenset(
    {
        WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
        WORKFLOW_RUN_STATUS_CLAIMABLE,
        WORKFLOW_RUN_STATUS_CLAIMED,
        WORKFLOW_RUN_STATUS_DELIVERED,
        WORKFLOW_RUN_STATUS_RUNNING,
        WORKFLOW_RUN_STATUS_WAITING_APPROVAL,
        WORKFLOW_RUN_STATUS_COMPLETED,
        WORKFLOW_RUN_STATUS_FAILED,
        WORKFLOW_RUN_STATUS_CANCELLED,
        WORKFLOW_RUN_STATUS_MISSED,
    }
)

WORKFLOW_RUN_TERMINAL_STATUSES: Final = frozenset(
    {
        WORKFLOW_RUN_STATUS_COMPLETED,
        WORKFLOW_RUN_STATUS_FAILED,
        WORKFLOW_RUN_STATUS_CANCELLED,
        # A missed row is born terminal: it never delivers, so the concurrency +
        # FIFO-delivery scans (which key off "non-terminal") must treat it as inert.
        WORKFLOW_RUN_STATUS_MISSED,
    }
)

# Legal desired/observed transitions. Terminal statuses have no outgoing edges.
# The control plane keeps desired state (cancel) and the runtime reports observed
# state; both funnel through the same guard so an out-of-order report is rejected.
WORKFLOW_RUN_STATUS_TRANSITIONS: Final[dict[str, frozenset[str]]] = {
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY: frozenset(
        {
            WORKFLOW_RUN_STATUS_DELIVERED,
            WORKFLOW_RUN_STATUS_CANCELLED,
            # A server-side pre-dispatch gate (e.g. budget_blocked, D-002) lands a
            # pending_delivery run terminal without ever waking a sandbox. The
            # runtime cannot reach this edge — it only self-reports from delivered
            # onward (WORKFLOW_RUN_OBSERVABLE_STATUSES) and never sees a
            # pending_delivery run.
            WORKFLOW_RUN_STATUS_FAILED,
        }
    ),
    # Desktop-executor lane (2a). A claimable run is claimed by a desktop executor
    # (a direct, row-locked store mutation, not a runtime self-report) or cancelled
    # by a pre-claim take-over. A claimed run's desktop relay then reports
    # ``running`` via the same /status path the cloud lane uses (claim IS the local
    # "delivery"; there is no separate /delivered step for the claimed lane), or the
    # user takes it over (cancelled), or the executor reports an early failure.
    WORKFLOW_RUN_STATUS_CLAIMABLE: frozenset(
        {
            WORKFLOW_RUN_STATUS_CLAIMED,
            WORKFLOW_RUN_STATUS_CANCELLED,
        }
    ),
    WORKFLOW_RUN_STATUS_CLAIMED: frozenset(
        {
            WORKFLOW_RUN_STATUS_RUNNING,
            WORKFLOW_RUN_STATUS_FAILED,
            WORKFLOW_RUN_STATUS_CANCELLED,
        }
    ),
    WORKFLOW_RUN_STATUS_DELIVERED: frozenset(
        {WORKFLOW_RUN_STATUS_RUNNING, WORKFLOW_RUN_STATUS_CANCELLED}
    ),
    WORKFLOW_RUN_STATUS_RUNNING: frozenset(
        {
            WORKFLOW_RUN_STATUS_WAITING_APPROVAL,
            WORKFLOW_RUN_STATUS_COMPLETED,
            WORKFLOW_RUN_STATUS_FAILED,
            WORKFLOW_RUN_STATUS_CANCELLED,
        }
    ),
    WORKFLOW_RUN_STATUS_WAITING_APPROVAL: frozenset(
        {
            WORKFLOW_RUN_STATUS_RUNNING,
            WORKFLOW_RUN_STATUS_COMPLETED,
            WORKFLOW_RUN_STATUS_FAILED,
            WORKFLOW_RUN_STATUS_CANCELLED,
        }
    ),
    WORKFLOW_RUN_STATUS_COMPLETED: frozenset(),
    WORKFLOW_RUN_STATUS_FAILED: frozenset(),
    WORKFLOW_RUN_STATUS_CANCELLED: frozenset(),
    # Terminal on creation — a missed row is inserted directly, never transitioned.
    WORKFLOW_RUN_STATUS_MISSED: frozenset(),
}

# Statuses the runtime is allowed to self-report through the /status endpoint.
# Delivery is its own dedicated endpoint (pending_delivery -> delivered).
WORKFLOW_RUN_OBSERVABLE_STATUSES: Final = frozenset(
    {
        WORKFLOW_RUN_STATUS_RUNNING,
        WORKFLOW_RUN_STATUS_WAITING_APPROVAL,
        WORKFLOW_RUN_STATUS_COMPLETED,
        WORKFLOW_RUN_STATUS_FAILED,
        WORKFLOW_RUN_STATUS_CANCELLED,
    }
)

# Distinct run error kind (not a status): a scheduled/unattended run that fired
# while the owner's billing subject was over budget lands terminal (status=failed)
# with this error_code so run history shows *why* it never dispatched (D-002).
# Reverse path: swap the terminal error for a `deferred` status + retry-on-reset.
WORKFLOW_RUN_ERROR_BUDGET_BLOCKED: Final = "budget_blocked"

# --- Independent run state axes (spec §8.1; WS2c behavioral cutover). -----------
# The ADD-ONLY axis columns (WS2a) carry desired/delivery/observed/execution-health
# facts alongside the legacy ``status`` (which stays authoritative for public
# status until the WS9c/API cutover — WS2c writes BOTH and derives nothing yet).

# desired state: the human/control-plane intent.
WORKFLOW_DESIRED_STATE_RUNNING: Final = "running"
WORKFLOW_DESIRED_STATE_CANCEL_REQUESTED: Final = "cancel_requested"

# delivery state: ready -> claimed -> materializing -> delivered -> acknowledged,
# with retryable_ready / terminal_delivery_failure branches.
WORKFLOW_DELIVERY_STATE_READY: Final = "ready"
WORKFLOW_DELIVERY_STATE_CLAIMED: Final = "claimed"
WORKFLOW_DELIVERY_STATE_MATERIALIZING: Final = "materializing"
WORKFLOW_DELIVERY_STATE_DELIVERED: Final = "delivered"
WORKFLOW_DELIVERY_STATE_ACKNOWLEDGED: Final = "acknowledged"
WORKFLOW_DELIVERY_STATE_RETRYABLE_READY: Final = "retryable_ready"
WORKFLOW_DELIVERY_STATE_TERMINAL_FAILURE: Final = "terminal_delivery_failure"

# control-plane execution health: healthy -> suspect -> orphaned. ``orphaned`` is
# a server-owned coordination marker; it NEVER overwrites an observed_* field.
WORKFLOW_EXECUTION_HEALTH_HEALTHY: Final = "healthy"
WORKFLOW_EXECUTION_HEALTH_SUSPECT: Final = "suspect"
WORKFLOW_EXECUTION_HEALTH_ORPHANED: Final = "orphaned"

# pre-acceptance cancellation coordination (§8.3 branch 1).
WORKFLOW_PREACCEPT_CANCEL_NONE: Final = "none"
WORKFLOW_PREACCEPT_CANCEL_CANCELLING: Final = "cancelling_preaccept"
WORKFLOW_PREACCEPT_CANCEL_CANCELLED: Final = "cancelled_before_acceptance"

# --- Revisioned observed-run report path (spec §5.4; WS2c). --------------------
# The runtime (WS5c) sends a whole ``ObservedRun`` snapshot bound to the immutable
# delivery identity ``(run_id, plan_hash, binding_hash, execution_generation)``
# plus a strictly increasing ``revision``. A legacy run (delivered pre-WS2c, or a
# current run whose binding/generation is not yet set) has NULL identity columns
# and accepts these unambiguous sentinels (a real hash is ``sha256:…`` and a real
# generation is ``>= 1``).
WORKFLOW_LEGACY_HASH_SENTINEL: Final = ""
WORKFLOW_LEGACY_GENERATION_SENTINEL: Final = 0

# The ObservedRun ``observedState`` vocabulary (contracts/models.py) mapped to the
# legacy public ``status`` slug so the run view keeps working through the cutover.
# waiting_action_result / waiting_credential_refresh / quiescing are all live
# sub-states of a running run in v1 (no human approval — §8.1).
WORKFLOW_OBSERVED_STATE_TO_LEGACY_STATUS: Final[dict[str, str]] = {
    "accepted": WORKFLOW_RUN_STATUS_DELIVERED,
    "running": WORKFLOW_RUN_STATUS_RUNNING,
    "waiting_action_result": WORKFLOW_RUN_STATUS_RUNNING,
    "waiting_credential_refresh": WORKFLOW_RUN_STATUS_RUNNING,
    "waiting_approval": WORKFLOW_RUN_STATUS_WAITING_APPROVAL,
    "quiescing": WORKFLOW_RUN_STATUS_RUNNING,
    "completed": WORKFLOW_RUN_STATUS_COMPLETED,
    "failed": WORKFLOW_RUN_STATUS_FAILED,
    "cancelled": WORKFLOW_RUN_STATUS_CANCELLED,
}

# The terminal observed-run states (§5.4: once terminal the snapshot is immutable).
WORKFLOW_OBSERVED_TERMINAL_STATES: Final = frozenset(
    {"completed", "failed", "cancelled"}
)

# --- Step kinds (definition format v2; data-contract §1.2). --------------------
# human.approval is REMOVED (E1); agent.emit and branch are NEW (A3/C11). The
# waiting_approval run status survives via goal.on_blocked, not a step kind.
WORKFLOW_STEP_AGENT_CONFIG: Final = "agent.config"
WORKFLOW_STEP_AGENT_PROMPT: Final = "agent.prompt"
WORKFLOW_STEP_AGENT_EMIT: Final = "agent.emit"
WORKFLOW_STEP_SHELL_RUN: Final = "shell.run"
WORKFLOW_STEP_SCM_OPEN_PR: Final = "scm.open_pr"
WORKFLOW_STEP_NOTIFY: Final = "notify"
WORKFLOW_STEP_BRANCH: Final = "branch"
# Composition (spec 3.5 / L20): a definition-only step that names another workflow
# whose CURRENT version's steps are inlined into this plan at resolution time. It
# is deliberately NOT "workflow.run" — no runtime verb is implied. The server's
# plan resolver eliminates it before delivery, so it never reaches the runtime
# (the Rust plan.rs has no matching StepKind — that IS the L20 property).
WORKFLOW_STEP_WORKFLOW_INCLUDE: Final = "workflow.include"
SUPPORTED_WORKFLOW_STEP_KINDS: Final = frozenset(
    {
        WORKFLOW_STEP_AGENT_CONFIG,
        WORKFLOW_STEP_AGENT_PROMPT,
        WORKFLOW_STEP_AGENT_EMIT,
        WORKFLOW_STEP_SHELL_RUN,
        WORKFLOW_STEP_SCM_OPEN_PR,
        WORKFLOW_STEP_NOTIFY,
        WORKFLOW_STEP_BRANCH,
        WORKFLOW_STEP_WORKFLOW_INCLUDE,
    }
)

# Default emit re-ask budget (executor MAX_EMIT_ATTEMPTS; overridable per emit).
WORKFLOW_EMIT_DEFAULT_MAX_ATTEMPTS: Final = 3

# Max workflow.include nesting depth (spec 3.5 / L20). A breach fails at save time
# (cycle/depth walk) and, defensively, at resolution time (include_depth_exceeded)
# BEFORE any delivery — the runtime never sees a partially-resolved plan.
WORKFLOW_MAX_INCLUDE_DEPTH: Final = 5

# --- branch targets (data-contract §1.2 / C11: narrowed to continue|end). ------
WORKFLOW_BRANCH_TARGET_CONTINUE: Final = "continue"
WORKFLOW_BRANCH_TARGET_END: Final = "end"
SUPPORTED_WORKFLOW_BRANCH_TARGETS: Final = frozenset(
    {WORKFLOW_BRANCH_TARGET_CONTINUE, WORKFLOW_BRANCH_TARGET_END}
)

# --- Per-step on_fail policy (spec 3.3). ---------------------------------------
WORKFLOW_ON_FAIL_STOP: Final = "stop"
WORKFLOW_ON_FAIL_RETRY: Final = "retry"
WORKFLOW_ON_FAIL_CONTINUE: Final = "continue"
SUPPORTED_WORKFLOW_ON_FAIL_KINDS: Final = frozenset(
    {WORKFLOW_ON_FAIL_STOP, WORKFLOW_ON_FAIL_RETRY, WORKFLOW_ON_FAIL_CONTINUE}
)

# --- Goal knobs (spec 3.3). ----------------------------------------------------
WORKFLOW_GOAL_ON_BLOCKED_NOTIFY: Final = "notify"
WORKFLOW_GOAL_ON_BLOCKED_PAUSE: Final = "pause_for_approval"
WORKFLOW_GOAL_ON_BLOCKED_FAIL: Final = "fail"
SUPPORTED_WORKFLOW_GOAL_ON_BLOCKED: Final = frozenset(
    {
        WORKFLOW_GOAL_ON_BLOCKED_NOTIFY,
        WORKFLOW_GOAL_ON_BLOCKED_PAUSE,
        WORKFLOW_GOAL_ON_BLOCKED_FAIL,
    }
)

# --- notify: Slack-only (E1b). No channel discriminator; template-only v1. -----
# Retained slug for the server-side slack_notify action kind.
WORKFLOW_NOTIFY_CHANNEL_SLACK: Final = "slack"

# --- Input types (data-contract §1 / E2). text|number|choice|boolean. ----------
# string->text, enum->choice; the coercion machinery is unchanged.
WORKFLOW_INPUT_TYPE_TEXT: Final = "text"
WORKFLOW_INPUT_TYPE_NUMBER: Final = "number"
WORKFLOW_INPUT_TYPE_CHOICE: Final = "choice"
WORKFLOW_INPUT_TYPE_BOOLEAN: Final = "boolean"
SUPPORTED_WORKFLOW_INPUT_TYPES: Final = frozenset(
    {
        WORKFLOW_INPUT_TYPE_TEXT,
        WORKFLOW_INPUT_TYPE_NUMBER,
        WORKFLOW_INPUT_TYPE_CHOICE,
        WORKFLOW_INPUT_TYPE_BOOLEAN,
    }
)

# --- slot / agent-node grammar (data-contract §1.1 / A4). ----------------------
WORKFLOW_MAX_AGENTS: Final = 20

# --- reserved reference first-segments (data-contract §1.3 / B6). --------------
# `inputs` = eager run inputs; `steps` = the runtime's rewritten indexed target;
# `fields` = reserved for the notify agent-filled follow-up. None may be an emit
# name (emit names share the ref namespace).
WORKFLOW_RESERVED_REF_SEGMENTS: Final = frozenset({"inputs", "steps", "fields"})

# --- notify agent-filled fields (data-contract Part II follow-up; track 3c). ---
# A `notify` step may declare an `agent_fields` block: a slot + a flat schema of
# named scalar fields the AGENT fills (via the emit machinery) right before the
# notification is sent. The template references those values as `{{fields.<name>}}`
# in the notify `message` (`fields` is a reserved ref segment above). The resolver
# expands one notify-with-agent_fields into TWO plan steps — an injected
# `agent.emit` in the named slot, then the notify whose `{{fields.*}}` late-bind to
# that emit's output (indexed refs, exactly like `{{<emit>.<field>}}`). The runtime
# never learns the word `fields`; plan.rs is untouched. Schema field types are the
# scalar subset (the runtime's emit output_schema validates the emitted object).
WORKFLOW_NOTIFY_FIELD_TYPE_STRING: Final = "string"
WORKFLOW_NOTIFY_FIELD_TYPE_NUMBER: Final = "number"
WORKFLOW_NOTIFY_FIELD_TYPE_BOOLEAN: Final = "boolean"
SUPPORTED_WORKFLOW_NOTIFY_FIELD_TYPES: Final = frozenset(
    {
        WORKFLOW_NOTIFY_FIELD_TYPE_STRING,
        WORKFLOW_NOTIFY_FIELD_TYPE_NUMBER,
        WORKFLOW_NOTIFY_FIELD_TYPE_BOOLEAN,
    }
)
# Reserved emit-name prefix for the resolver's injected notify-fields emit. Users
# may not author an emit (or include handle) whose name starts with this — the
# resolver owns the namespace so an injected step can never collide with a
# user-authored one.
WORKFLOW_NOTIFY_FIELDS_EMIT_PREFIX: Final = "__notify_fields"

# --- run isolation (wave 2b; data-contract §4 plan-level, mental-model §9/§11).
# Whether the run's sessions execute directly in the pinned workspace's checkout
# (``workspace``, the legacy behavior — also what an ABSENT field means, so old
# stored plans stay valid) or in a fresh git worktree the runtime mints per run
# inside that checkout (``worktree``). Plan-level in v1 (one worktree per RUN,
# shared by every slot); L30 parallel lanes inherit this field and later split it
# per lane. The runtime consumer is anyharness ``plan.rs::Isolation``.
WORKFLOW_ISOLATION_WORKSPACE: Final = "workspace"
WORKFLOW_ISOLATION_WORKTREE: Final = "worktree"
SUPPORTED_WORKFLOW_ISOLATIONS: Final = frozenset(
    {WORKFLOW_ISOLATION_WORKSPACE, WORKFLOW_ISOLATION_WORKTREE}
)
# The default when nothing pins isolation: run in the pinned checkout as-is. The
# field is emitted explicitly so the resolved plan is self-describing, but the
# Rust parser also treats an absent field as this value (back-compat).
WORKFLOW_ISOLATION_DEFAULT: Final = WORKFLOW_ISOLATION_WORKSPACE

# --- session_binding: defaulted per-slot in the resolved plan by trigger kind
# (manual/chat=fresh, schedule/poll=headless); no longer an authored field. -----
WORKFLOW_SESSION_BINDING_FRESH: Final = "fresh"
WORKFLOW_SESSION_BINDING_HEADLESS: Final = "headless"
SUPPORTED_WORKFLOW_SESSION_BINDINGS: Final = frozenset(
    {WORKFLOW_SESSION_BINDING_FRESH, WORKFLOW_SESSION_BINDING_HEADLESS}
)

# --- Trigger records (workflow_trigger table; spec 3.5). -----------------------
# A trigger is *only* a trigger: it pins target + schedule/poll + concurrency and
# calls the same StartRun (no interpreter, no special execution path). The kind
# vocabulary is intentionally open (webhook/api later); v1 ships schedule + poll.
WORKFLOW_TRIGGER_KIND_SCHEDULE: Final = "schedule"
WORKFLOW_TRIGGER_KIND_POLL: Final = "poll"
SUPPORTED_WORKFLOW_TRIGGER_TYPES: Final = frozenset(
    {WORKFLOW_TRIGGER_KIND_SCHEDULE, WORKFLOW_TRIGGER_KIND_POLL}
)

# Trigger kinds whose runs are created server-side (pending_delivery) and delivered
# by the workflow scheduler's phase-2 delivery pass (schedule + poll). Client-
# initiated kinds (manual/chat) deliver themselves.
WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS: Final = frozenset(
    {WORKFLOW_TRIGGER_KIND_SCHEDULE, WORKFLOW_TRIGGER_KIND_POLL}
)

# --- Poll trigger (spec 4.2/4.3; issue-autofix-system-v1 §2). ------------------
# The poller GETs a conforming endpoint on an interval, spawns one run per new
# item (idempotent by item id), and echoes the opaque server-issued cursor.
# The interval floor keeps a misconfigured trigger from hammering an endpoint.
WORKFLOW_POLL_MIN_INTERVAL_SECONDS: Final = 60
WORKFLOW_POLL_DEFAULT_LIMIT: Final = 50
WORKFLOW_POLL_HTTP_TIMEOUT_SECONDS: Final = 10.0
# Hard cap on a poll/init response body. The endpoint is third-party; without a
# ceiling a hostile or broken feed could stream unbounded bytes into memory. The
# poller aborts the read (and the /init setup probe fails with a clean error)
# once this many bytes arrive. 8 MiB comfortably fits a full page of items.
WORKFLOW_POLL_MAX_RESPONSE_BYTES: Final = 8 * 1024 * 1024
WORKFLOW_POLL_ITEM_ID_MAX_LENGTH: Final = 255
WORKFLOW_POLL_ERROR_MAX_LENGTH: Final = 480
# The poller runs alongside the schedule beat (spec 4.1: same worker process).
WORKFLOW_POLLER_DEFAULT_BATCH_SIZE: Final = 100
WORKFLOW_TRIGGER_ITEM_STATUS_SPAWNED: Final = "spawned"
WORKFLOW_TRIGGER_ITEM_STATUS_INVALID: Final = "invalid"
WORKFLOW_TRIGGER_ITEM_STATUS_ERROR: Final = "error"

# --- Concurrency policy (spec 3.5: simple skip | queue, no batch/parallel). -----
# skip:  a due tick is dropped (recorded with a reason) while a prior run of the
#        same trigger is still non-terminal.
# queue: a due tick always creates the run, but the scheduler defers *delivery*
#        until the trigger's prior run reaches a terminal state (FIFO by slot).
WORKFLOW_CONCURRENCY_SKIP: Final = "skip"
WORKFLOW_CONCURRENCY_QUEUE: Final = "queue"
SUPPORTED_WORKFLOW_CONCURRENCY_POLICIES: Final = frozenset(
    {WORKFLOW_CONCURRENCY_SKIP, WORKFLOW_CONCURRENCY_QUEUE}
)

# --- Missed-run policy (per schedule trigger; mental-model §4, RULED 2026-07-09).
# When the scheduler was down while occurrences came due, this decides how the
# catch-up tick treats the slots in the missed window (cursor .. now]:
#   run_latest (default): fire ONLY the newest missed occurrence; every OLDER slot
#       is recorded as a terminal `missed` run row (honest history, no fire).
#   skip_all:  fire NOTHING; ALL missed slots recorded as `missed` rows.
#   replay_all: fire EVERY missed slot in order (the (trigger_id, scheduled_for)
#       unique index dedupes a re-tick).
# All three record honest history — no silent gaps (the amnesia the old hardcoded
# run_latest left behind).
WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST: Final = "run_latest"
WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL: Final = "skip_all"
WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL: Final = "replay_all"
SUPPORTED_WORKFLOW_MISSED_RUN_POLICIES: Final = frozenset(
    {
        WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST,
        WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL,
        WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    }
)
WORKFLOW_MISSED_RUN_POLICY_DEFAULT: Final = WORKFLOW_MISSED_RUN_POLICY_RUN_LATEST
# Safety valve: the most catch-up slots one trigger processes in a single tick.
# A trigger whose worker was down for a pathological stretch keeps the most-recent
# slots (so run_latest still fires the true newest) and logs the truncation, rather
# than materialising an unbounded backfill in one transaction.
WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS: Final = 500

# Skip-tick surfacing is stored inline on the trigger (last_skipped_at +
# last_skip_reason) rather than a separate tick log — one row, no fan-out.
WORKFLOW_TRIGGER_SKIP_REASON_MAX_LENGTH: Final = 255
WORKFLOW_TRIGGER_SKIP_REASON_CONCURRENCY: Final = (
    "A previous run of this trigger was still running."
)

# --- Scheduler tick bounds (mirrors the automations beat; spec 3.5). -----------
WORKFLOW_SCHEDULER_DEFAULT_INTERVAL_SECONDS: Final = 15.0
WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE: Final = 100

# --- Transactional outbox kinds (WS4a; spec §10.2, §6 WF-6). -------------------
# A schedule/poll fire that targets a cloud runtime writes a ``cloud_delivery``
# outbox row in the SAME transaction as the run intent, so a crash after intent
# commit never loses the follow-up delivery. A local-ready run needs no outbox —
# it is claimable over its HTTP API the moment it commits (§10.2).
WORKFLOW_OUTBOX_KIND_CLOUD_DELIVERY: Final = "cloud_delivery"
SUPPORTED_WORKFLOW_OUTBOX_KINDS: Final = frozenset({WORKFLOW_OUTBOX_KIND_CLOUD_DELIVERY})
# Relay backoff for a claimed cloud-delivery row that could not be delivered this
# cycle (a transient wake/transport failure, or a run deferred behind its FIFO
# predecessor under the ``queue`` concurrency policy). The row returns to
# ``pending`` with this delay and is re-claimed on a later relay cycle.
WORKFLOW_OUTBOX_RELAY_BATCH_SIZE: Final = 50
WORKFLOW_OUTBOX_RELAY_RETRY_DELAY_SECONDS: Final = 30.0
# Each cloud delivery wakes a sandbox, so cap wakes per beat to keep it bounded
# (the house automation loop bounds its per-tick work the same way).
WORKFLOW_SCHEDULER_MAX_DELIVERIES_PER_TICK: Final = 25

# --- Desktop local executor claim plane (track 2a; lifts L15). -----------------
# Ports the automations claim machinery to workflow runs. A server-created local
# scheduled run is born ``claimable``; a desktop executor claims a batch (10s claim
# poll), stamps a claim + heartbeat, and keeps it alive (30s heartbeat). If the
# laptop closes and the heartbeat lapses past this TTL, a ``claimed`` (pre-run) row
# is reclaimable by the next claim — exactly once, guarded by the row lock +
# claim_id rotation (SKIP LOCKED). A run that already reached ``running`` is NEVER
# silently reclaimed (that would double-execute); it waits for take-over (D15),
# same as a stuck cloud run. TTL mirrors the automations claim TTL so the desktop's
# existing 30s heartbeat cadence carries over unchanged.
WORKFLOW_LOCAL_CLAIM_TTL_SECONDS: Final = 90
WORKFLOW_LOCAL_CLAIM_MAX_LIMIT: Final = 25
WORKFLOW_LOCAL_EXTERNAL_ID_MAX_LENGTH: Final = 255
# Statuses a stale (heartbeat-lapsed) claim may be reclaimed FROM — the pre-run
# state only. Mirrors the automations RECLAIMABLE set excluding dispatched states.
WORKFLOW_LOCAL_RECLAIMABLE_STATUSES: Final = frozenset({WORKFLOW_RUN_STATUS_CLAIMED})
# Statuses where a heartbeat is accepted (the claim is still meaningful): the
# claimed pre-run state plus the live in-run states the desktop relay drives.
WORKFLOW_LOCAL_ACTIVE_CLAIM_STATUSES: Final = frozenset(
    {
        WORKFLOW_RUN_STATUS_CLAIMED,
        WORKFLOW_RUN_STATUS_RUNNING,
        WORKFLOW_RUN_STATUS_WAITING_APPROVAL,
    }
)

# --- Sizing / abuse limits. ----------------------------------------------------
WORKFLOW_SHORT_TEXT_MAX_LENGTH: Final = 255
WORKFLOW_MAX_STEPS: Final = 50
WORKFLOW_MAX_ARGS: Final = 25

# --- Per-run gateway function grants (spec 6 / L16, L22, L25). -----------------
# A definition may declare a top-level ``functions`` allow-list — one entry per
# provider, each with a non-empty tool list. StartRun resolves it into the run's
# frozen gateway scope. The caps keep a definition from declaring an unbounded
# grant surface.
WORKFLOW_MAX_FUNCTION_PROVIDERS: Final = 25
WORKFLOW_MAX_TOOLS_PER_PROVIDER: Final = 100

# The per-run gateway token (OPEN-3(a)) lives for the run + a grace window; it is
# flipped to ``expired`` the instant the run reaches a terminal status, so 24h is a
# backstop for a run whose terminal report never arrives.
WORKFLOW_RUN_GATEWAY_TOKEN_TTL_SECONDS: Final = 24 * 60 * 60
WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_ACTIVE: Final = "active"
WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_EXPIRED: Final = "expired"
WORKFLOW_RUN_GATEWAY_TOKEN_STATUS_REVOKED: Final = "revoked"

# --- WS3b credential audiences (feature spec §5.3 / §7.1). ---------------------
# Every short-lived workflow credential carries a typed audience. A token minted
# for one audience is denied at every other endpoint family. A NULL audience is a
# LEGACY (pre-WS3b) all-purpose run token that still authenticates everywhere it
# did before migration (compat); enforcement is strict only for new-style tokens.
WORKFLOW_CREDENTIAL_AUDIENCE_INTEGRATION: Final = "integration"
WORKFLOW_CREDENTIAL_AUDIENCE_RUN_REPORT: Final = "run_report"
WORKFLOW_CREDENTIAL_AUDIENCE_PING: Final = "ping"
WORKFLOW_CREDENTIAL_AUDIENCE_DELIVERY_CLAIM: Final = "delivery_claim"
WORKFLOW_CREDENTIAL_AUDIENCES: Final = frozenset(
    {
        WORKFLOW_CREDENTIAL_AUDIENCE_INTEGRATION,
        WORKFLOW_CREDENTIAL_AUDIENCE_RUN_REPORT,
        WORKFLOW_CREDENTIAL_AUDIENCE_PING,
        WORKFLOW_CREDENTIAL_AUDIENCE_DELIVERY_CLAIM,
    }
)
# The control channel (§5.3 "authenticated control channel"): the run_report or
# delivery_claim credential may drive the credential exchange/ACK endpoints.
WORKFLOW_CONTROL_CHANNEL_AUDIENCES: Final = frozenset(
    {
        WORKFLOW_CREDENTIAL_AUDIENCE_RUN_REPORT,
        WORKFLOW_CREDENTIAL_AUDIENCE_DELIVERY_CLAIM,
    }
)

# --- WS3b per-slot one-use issuance handles (feature spec §5.3). ---------------
# A handle is minted per slot into the private envelope at StartRun and exchanged
# once (per session) for a session-bound integration credential. ``pending`` =
# minted, never exchanged; ``exchanged`` = credential issued, awaiting runtime
# install ACK (an identical retry returns the SAME generation); ``acknowledged``
# = the runtime installed it and the handle is consumed (no further exchange).
WORKFLOW_ISSUANCE_STATUS_PENDING: Final = "pending"
WORKFLOW_ISSUANCE_STATUS_EXCHANGED: Final = "exchanged"
WORKFLOW_ISSUANCE_STATUS_ACKNOWLEDGED: Final = "acknowledged"
# The short-lived integration credential's lifetime; rotation refreshes it before
# expiry over the authenticated control channel (§5.3).
WORKFLOW_INTEGRATION_CREDENTIAL_TTL_SECONDS: Final = 60 * 60

# --- Function invocations (Part II mental-model §1; track 1b phase 2). ---------
# User-authored HTTP functions exposed at the integration gateway under the
# reserved ``functions`` provider namespace. The agent addresses one by its
# stable ``name`` (also the grant-list key); dispatch is a raw-httpx path
# (modeled on the poller's ``fetch_poll_page``), NOT the MCP outbound path.
FUNCTION_INVOCATION_PROVIDER_NAMESPACE: Final = "functions"
FUNCTION_INVOCATION_NAME_MAX_LENGTH: Final = 64
FUNCTION_INVOCATION_SUPPORTED_METHODS: Final = frozenset({"get", "post", "patch", "put", "delete"})
# SSRF + resource safety posture (PROPOSED, standard). The gateway makes the
# request itself, so it must not be steered at private/link-local/loopback ranges
# or our own infra, must cap response size + time, and must never follow a
# cross-host redirect.
FUNCTION_INVOCATION_HTTP_TIMEOUT_SECONDS: Final = 20.0
FUNCTION_INVOCATION_MAX_RESPONSE_BYTES: Final = 2 * 1024 * 1024

# --- Free-plan cap (spec 6: 1 non-archived workflow per user). -----------------
FREE_PLAN_MAX_WORKFLOWS_PER_USER: Final = 1

# --- Cloud delivery (spec 3.2 cloud lane). -------------------------------------
# The server delivers the resolved plan gateway-direct to sandbox anyharness. A
# typed delivery failure is recorded on the still-pending run (non-terminal, so a
# re-deliver stays possible) rather than moving the run to a terminal state.
WORKFLOW_DELIVERY_ERROR_CODE: Final = "delivery_failed"
# Wake latency budget: the gateway helper wakes the sandbox before returning an
# upstream url, so the POST itself is fast; the whole handshake stays bounded.
WORKFLOW_CLOUD_DELIVERY_TIMEOUT_SECONDS: Final = 60.0
WORKFLOW_CLOUD_REFRESH_TIMEOUT_SECONDS: Final = 15.0

# --- Goal cap defaults (spec 3.6: 25 turns / 90m / 400k tokens). ---------------
WORKFLOW_GOAL_DEFAULT_MAX_TURNS: Final = 25
WORKFLOW_GOAL_DEFAULT_MAX_WALL_SECS: Final = 90 * 60
WORKFLOW_GOAL_DEFAULT_TOKEN_BUDGET: Final = 400_000
