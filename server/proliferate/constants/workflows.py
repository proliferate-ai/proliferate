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
WORKFLOW_TRIGGER_CHAT: Final = "chat"
WORKFLOW_TRIGGER_AGENT: Final = "agent"
WORKFLOW_TRIGGER_API: Final = "api"
SUPPORTED_WORKFLOW_TRIGGER_KINDS: Final = frozenset(
    {
        WORKFLOW_TRIGGER_MANUAL,
        WORKFLOW_TRIGGER_SCHEDULE,
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
WORKFLOW_RUN_STATUS_DELIVERED: Final = "delivered"
WORKFLOW_RUN_STATUS_RUNNING: Final = "running"
WORKFLOW_RUN_STATUS_WAITING_APPROVAL: Final = "waiting_approval"
WORKFLOW_RUN_STATUS_COMPLETED: Final = "completed"
WORKFLOW_RUN_STATUS_FAILED: Final = "failed"
WORKFLOW_RUN_STATUS_CANCELLED: Final = "cancelled"

SUPPORTED_WORKFLOW_RUN_STATUSES: Final = frozenset(
    {
        WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
        WORKFLOW_RUN_STATUS_DELIVERED,
        WORKFLOW_RUN_STATUS_RUNNING,
        WORKFLOW_RUN_STATUS_WAITING_APPROVAL,
        WORKFLOW_RUN_STATUS_COMPLETED,
        WORKFLOW_RUN_STATUS_FAILED,
        WORKFLOW_RUN_STATUS_CANCELLED,
    }
)

WORKFLOW_RUN_TERMINAL_STATUSES: Final = frozenset(
    {
        WORKFLOW_RUN_STATUS_COMPLETED,
        WORKFLOW_RUN_STATUS_FAILED,
        WORKFLOW_RUN_STATUS_CANCELLED,
    }
)

# Legal desired/observed transitions. Terminal statuses have no outgoing edges.
# The control plane keeps desired state (cancel) and the runtime reports observed
# state; both funnel through the same guard so an out-of-order report is rejected.
WORKFLOW_RUN_STATUS_TRANSITIONS: Final[dict[str, frozenset[str]]] = {
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY: frozenset(
        {WORKFLOW_RUN_STATUS_DELIVERED, WORKFLOW_RUN_STATUS_CANCELLED}
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
SUPPORTED_WORKFLOW_STEP_KINDS: Final = frozenset(
    {
        WORKFLOW_STEP_AGENT_CONFIG,
        WORKFLOW_STEP_AGENT_PROMPT,
        WORKFLOW_STEP_AGENT_EMIT,
        WORKFLOW_STEP_SHELL_RUN,
        WORKFLOW_STEP_SCM_OPEN_PR,
        WORKFLOW_STEP_NOTIFY,
        WORKFLOW_STEP_BRANCH,
    }
)

# Default emit re-ask budget (executor MAX_EMIT_ATTEMPTS; overridable per emit).
WORKFLOW_EMIT_DEFAULT_MAX_ATTEMPTS: Final = 3

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

# --- session_binding: defaulted per-slot in the resolved plan by trigger kind
# (manual/chat=fresh, schedule/poll=headless); no longer an authored field. -----
WORKFLOW_SESSION_BINDING_FRESH: Final = "fresh"
WORKFLOW_SESSION_BINDING_HEADLESS: Final = "headless"
SUPPORTED_WORKFLOW_SESSION_BINDINGS: Final = frozenset(
    {WORKFLOW_SESSION_BINDING_FRESH, WORKFLOW_SESSION_BINDING_HEADLESS}
)

# --- Trigger records (workflow_trigger table; spec 3.5). -----------------------
# A trigger is *only* a trigger: it pins target + schedule + concurrency and calls
# the same StartRun (no interpreter, no special execution path). The kind
# vocabulary is intentionally open (webhook/api later); v1 ships schedule only.
WORKFLOW_TRIGGER_KIND_SCHEDULE: Final = "schedule"
SUPPORTED_WORKFLOW_TRIGGER_TYPES: Final = frozenset({WORKFLOW_TRIGGER_KIND_SCHEDULE})

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

# Skip-tick surfacing is stored inline on the trigger (last_skipped_at +
# last_skip_reason) rather than a separate tick log — one row, no fan-out.
WORKFLOW_TRIGGER_SKIP_REASON_MAX_LENGTH: Final = 255
WORKFLOW_TRIGGER_SKIP_REASON_CONCURRENCY: Final = (
    "A previous run of this trigger was still running."
)

# --- Scheduler tick bounds (mirrors the automations beat; spec 3.5). -----------
WORKFLOW_SCHEDULER_DEFAULT_INTERVAL_SECONDS: Final = 15.0
WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE: Final = 100
# Each cloud delivery wakes a sandbox, so cap wakes per beat to keep it bounded
# (the house automation loop bounds its per-tick work the same way).
WORKFLOW_SCHEDULER_MAX_DELIVERIES_PER_TICK: Final = 25

# --- Sizing / abuse limits. ----------------------------------------------------
WORKFLOW_SHORT_TEXT_MAX_LENGTH: Final = 255
WORKFLOW_MAX_STEPS: Final = 50
WORKFLOW_MAX_ARGS: Final = 25

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
