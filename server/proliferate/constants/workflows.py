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

# --- Step kinds (spec 3.3). ----------------------------------------------------
WORKFLOW_STEP_AGENT_PROMPT: Final = "agent.prompt"
WORKFLOW_STEP_SHELL_RUN: Final = "shell.run"
WORKFLOW_STEP_SCM_OPEN_PR: Final = "scm.open_pr"
WORKFLOW_STEP_NOTIFY: Final = "notify"
WORKFLOW_STEP_HUMAN_APPROVAL: Final = "human.approval"
SUPPORTED_WORKFLOW_STEP_KINDS: Final = frozenset(
    {
        WORKFLOW_STEP_AGENT_PROMPT,
        WORKFLOW_STEP_SHELL_RUN,
        WORKFLOW_STEP_SCM_OPEN_PR,
        WORKFLOW_STEP_NOTIFY,
        WORKFLOW_STEP_HUMAN_APPROVAL,
    }
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

# --- notify channels (spec 3.3: Slack v1, in-app is the floor). ----------------
WORKFLOW_NOTIFY_CHANNEL_IN_APP: Final = "in_app"
WORKFLOW_NOTIFY_CHANNEL_SLACK: Final = "slack"
SUPPORTED_WORKFLOW_NOTIFY_CHANNELS: Final = frozenset(
    {WORKFLOW_NOTIFY_CHANNEL_IN_APP, WORKFLOW_NOTIFY_CHANNEL_SLACK}
)

# --- human.approval on_timeout (spec 3.3). -------------------------------------
WORKFLOW_APPROVAL_ON_TIMEOUT_FAIL: Final = "fail"
WORKFLOW_APPROVAL_ON_TIMEOUT_CONTINUE: Final = "continue"
SUPPORTED_WORKFLOW_APPROVAL_ON_TIMEOUT: Final = frozenset(
    {WORKFLOW_APPROVAL_ON_TIMEOUT_FAIL, WORKFLOW_APPROVAL_ON_TIMEOUT_CONTINUE}
)

# --- Workflow-level args schema (spec 3.3 / 3.6 Setup). ------------------------
WORKFLOW_ARG_TYPE_STRING: Final = "string"
WORKFLOW_ARG_TYPE_NUMBER: Final = "number"
WORKFLOW_ARG_TYPE_BOOLEAN: Final = "boolean"
WORKFLOW_ARG_TYPE_ENUM: Final = "enum"
SUPPORTED_WORKFLOW_ARG_TYPES: Final = frozenset(
    {
        WORKFLOW_ARG_TYPE_STRING,
        WORKFLOW_ARG_TYPE_NUMBER,
        WORKFLOW_ARG_TYPE_BOOLEAN,
        WORKFLOW_ARG_TYPE_ENUM,
    }
)

# --- setup.session_binding (spec 3.3). -----------------------------------------
WORKFLOW_SESSION_BINDING_FRESH: Final = "fresh"
WORKFLOW_SESSION_BINDING_HEADLESS: Final = "headless"
SUPPORTED_WORKFLOW_SESSION_BINDINGS: Final = frozenset(
    {WORKFLOW_SESSION_BINDING_FRESH, WORKFLOW_SESSION_BINDING_HEADLESS}
)

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
