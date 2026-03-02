/**
 * V1 Entity Contracts — canonical enums, status sets, and state machine helpers.
 *
 * These are the single source of truth for V1 status values and transitions.
 * Spec reference: docs/specs/agent-platform-v1/12-reference-index-files-and-models.md
 */

// ============================================
// Session Kind
// ============================================

export const SESSION_KINDS = ["manager", "task", "setup"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

// ============================================
// Worker Status
// ============================================

export const WORKER_STATUSES = ["active", "paused", "degraded", "failed"] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

const WORKER_TRANSITIONS: Record<WorkerStatus, readonly WorkerStatus[]> = {
	active: ["paused", "degraded", "failed"],
	paused: ["active", "failed"],
	degraded: ["active", "failed"],
	failed: ["active"],
};

export function isValidWorkerTransition(from: WorkerStatus, to: WorkerStatus): boolean {
	return WORKER_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================
// Wake Event Source
// ============================================

export const WAKE_EVENT_SOURCES = ["tick", "webhook", "manual", "manual_message"] as const;
export type WakeEventSource = (typeof WAKE_EVENT_SOURCES)[number];

// ============================================
// Wake Event Status
// ============================================

export const WAKE_EVENT_STATUSES = [
	"queued",
	"claimed",
	"consumed",
	"coalesced",
	"cancelled",
	"failed",
] as const;
export type WakeEventStatus = (typeof WAKE_EVENT_STATUSES)[number];

export const TERMINAL_WAKE_EVENT_STATUSES: readonly WakeEventStatus[] = [
	"consumed",
	"coalesced",
	"cancelled",
	"failed",
];

const WAKE_EVENT_TRANSITIONS: Record<string, readonly WakeEventStatus[]> = {
	queued: ["claimed", "cancelled", "coalesced", "failed"],
	claimed: ["consumed", "failed", "cancelled"],
};

export function isValidWakeEventTransition(from: WakeEventStatus, to: WakeEventStatus): boolean {
	return WAKE_EVENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalWakeEventStatus(status: WakeEventStatus): boolean {
	return TERMINAL_WAKE_EVENT_STATUSES.includes(status);
}

// ============================================
// Worker Run Status
// ============================================

export const WORKER_RUN_STATUSES = [
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled",
	"health_degraded",
] as const;
export type WorkerRunStatus = (typeof WORKER_RUN_STATUSES)[number];

export const TERMINAL_WORKER_RUN_STATUSES: readonly WorkerRunStatus[] = [
	"completed",
	"failed",
	"cancelled",
	"health_degraded",
];
export const NON_TERMINAL_WORKER_RUN_STATUSES: readonly WorkerRunStatus[] = ["queued", "running"];

const WORKER_RUN_TRANSITIONS: Record<string, readonly WorkerRunStatus[]> = {
	queued: ["running", "cancelled", "failed"],
	running: ["completed", "failed", "cancelled", "health_degraded"],
	health_degraded: ["failed"],
};

export function isValidWorkerRunTransition(from: WorkerRunStatus, to: WorkerRunStatus): boolean {
	return WORKER_RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalWorkerRunStatus(status: WorkerRunStatus): boolean {
	return TERMINAL_WORKER_RUN_STATUSES.includes(status);
}

export function isNonTerminalWorkerRunStatus(status: WorkerRunStatus): boolean {
	return NON_TERMINAL_WORKER_RUN_STATUSES.includes(status);
}

// ============================================
// Session Runtime Status
// ============================================

export const SESSION_RUNTIME_STATUSES = [
	"starting",
	"running",
	"paused",
	"completed",
	"failed",
	"cancelled",
] as const;
export type SessionRuntimeStatus = (typeof SESSION_RUNTIME_STATUSES)[number];

export const TERMINAL_SESSION_RUNTIME_STATUSES: readonly SessionRuntimeStatus[] = [
	"completed",
	"failed",
	"cancelled",
];
export const NON_TERMINAL_SESSION_RUNTIME_STATUSES: readonly SessionRuntimeStatus[] = [
	"starting",
	"running",
	"paused",
];

const SESSION_RUNTIME_TRANSITIONS: Record<string, readonly SessionRuntimeStatus[]> = {
	starting: ["running", "failed", "cancelled"],
	running: ["paused", "completed", "failed", "cancelled"],
	paused: ["running", "failed", "cancelled"],
};

export function isValidSessionRuntimeTransition(
	from: SessionRuntimeStatus,
	to: SessionRuntimeStatus,
): boolean {
	return SESSION_RUNTIME_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalSessionRuntimeStatus(status: SessionRuntimeStatus): boolean {
	return TERMINAL_SESSION_RUNTIME_STATUSES.includes(status);
}

export function isNonTerminalSessionRuntimeStatus(status: SessionRuntimeStatus): boolean {
	return NON_TERMINAL_SESSION_RUNTIME_STATUSES.includes(status);
}

// ============================================
// Session Operator Status
// ============================================

export const SESSION_OPERATOR_STATUSES = [
	"active",
	"waiting_for_approval",
	"needs_input",
	"ready_for_review",
	"errored",
	"done",
] as const;
export type SessionOperatorStatus = (typeof SESSION_OPERATOR_STATUSES)[number];

const SESSION_OPERATOR_TRANSITIONS: Record<string, readonly SessionOperatorStatus[]> = {
	active: ["waiting_for_approval", "needs_input", "ready_for_review", "errored", "done"],
	waiting_for_approval: ["active", "needs_input", "ready_for_review", "errored", "done"],
	needs_input: ["active", "waiting_for_approval", "ready_for_review", "errored", "done"],
	ready_for_review: ["active", "waiting_for_approval", "needs_input", "errored", "done"],
	errored: ["active", "done"],
};

export function isValidSessionOperatorTransition(
	from: SessionOperatorStatus,
	to: SessionOperatorStatus,
): boolean {
	return SESSION_OPERATOR_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================
// Session Message Direction
// ============================================

export const SESSION_MESSAGE_DIRECTIONS = [
	"user_to_manager",
	"user_to_task",
	"manager_to_task",
	"task_to_manager",
] as const;
export type SessionMessageDirection = (typeof SESSION_MESSAGE_DIRECTIONS)[number];

// ============================================
// Session Message Delivery State
// ============================================

export const SESSION_MESSAGE_DELIVERY_STATES = [
	"queued",
	"delivered",
	"consumed",
	"failed",
] as const;
export type SessionMessageDeliveryState = (typeof SESSION_MESSAGE_DELIVERY_STATES)[number];

// ============================================
// Session Visibility
// ============================================

export const SESSION_VISIBILITIES = ["private", "shared", "org"] as const;
export type SessionVisibility = (typeof SESSION_VISIBILITIES)[number];

// ============================================
// Session ACL Roles
// ============================================

export const SESSION_ACL_ROLES = ["viewer", "editor", "reviewer"] as const;
export type SessionAclRole = (typeof SESSION_ACL_ROLES)[number];

// ============================================
// Capability Modes
// ============================================

export const CAPABILITY_MODES = ["allow", "require_approval", "deny"] as const;
export type CapabilityMode = (typeof CAPABILITY_MODES)[number];

// ============================================
// Repo Baseline Status
// ============================================

export const REPO_BASELINE_STATUSES = ["validating", "ready", "stale", "failed"] as const;
export type RepoBaselineStatus = (typeof REPO_BASELINE_STATUSES)[number];

const REPO_BASELINE_TRANSITIONS: Record<string, readonly RepoBaselineStatus[]> = {
	validating: ["ready", "failed"],
	ready: ["stale", "validating"],
	stale: ["validating"],
	failed: ["validating"],
};

export function isValidRepoBaselineTransition(
	from: RepoBaselineStatus,
	to: RepoBaselineStatus,
): boolean {
	return REPO_BASELINE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================
// Action Invocation Status
// ============================================

export const ACTION_INVOCATION_STATUSES = [
	"pending",
	"approved",
	"denied",
	"expired",
	"executing",
	"completed",
	"failed",
] as const;
export type ActionInvocationStatus = (typeof ACTION_INVOCATION_STATUSES)[number];

export const TERMINAL_ACTION_INVOCATION_STATUSES: readonly ActionInvocationStatus[] = [
	"denied",
	"expired",
	"completed",
	"failed",
];

const ACTION_INVOCATION_TRANSITIONS: Record<string, readonly ActionInvocationStatus[]> = {
	pending: ["approved", "denied", "expired"],
	approved: ["executing", "failed"],
	executing: ["completed", "failed"],
};

export function isValidActionInvocationTransition(
	from: ActionInvocationStatus,
	to: ActionInvocationStatus,
): boolean {
	return ACTION_INVOCATION_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================
// Resume Intent Status
// ============================================

export const RESUME_INTENT_STATUSES = [
	"queued",
	"claimed",
	"resuming",
	"satisfied",
	"continued",
	"resume_failed",
] as const;
export type ResumeIntentStatus = (typeof RESUME_INTENT_STATUSES)[number];

export const TERMINAL_RESUME_INTENT_STATUSES: readonly ResumeIntentStatus[] = [
	"satisfied",
	"continued",
	"resume_failed",
];
export const ACTIVE_RESUME_INTENT_STATUSES: readonly ResumeIntentStatus[] = [
	"queued",
	"claimed",
	"resuming",
];

const RESUME_INTENT_TRANSITIONS: Record<string, readonly ResumeIntentStatus[]> = {
	queued: ["claimed"],
	claimed: ["resuming", "continued", "resume_failed"],
	resuming: ["satisfied", "continued", "resume_failed"],
};

export function isValidResumeIntentTransition(
	from: ResumeIntentStatus,
	to: ResumeIntentStatus,
): boolean {
	return RESUME_INTENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isActiveResumeIntentStatus(status: ResumeIntentStatus): boolean {
	return ACTIVE_RESUME_INTENT_STATUSES.includes(status);
}

// ============================================
// Worker Run Event Types
// ============================================

export const WORKER_RUN_EVENT_TYPES = [
	"wake_started",
	"triage_summary",
	"source_observation",
	"directive_received",
	"task_spawned",
	"action_requested",
	"action_pending_approval",
	"action_completed",
	"action_failed",
	"action_denied",
	"action_expired",
	"manager_note",
	"wake_completed",
	"wake_failed",
] as const;
export type WorkerRunEventType = (typeof WORKER_RUN_EVENT_TYPES)[number];

// ============================================
// Pull Request State
// ============================================

export const PULL_REQUEST_STATES = ["open", "closed", "merged", "draft"] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

// ============================================
// Canonical Error Taxonomy (Minimum Set)
// ============================================

export const V1_ERROR_CODES = [
	"CAPABILITY_NOT_VISIBLE",
	"POLICY_DENIED",
	"APPROVAL_EXPIRED",
	"INTEGRATION_REVOKED",
	"CREDENTIAL_MISSING",
	"CONNECTOR_DISABLED",
	"SANDBOX_RESUME_FAILED",
	"SANDBOX_LOST",
	"BASELINE_STALE",
	"BUDGET_EXHAUSTED",
] as const;
export type V1ErrorCode = (typeof V1_ERROR_CODES)[number];

export function isV1ErrorCode(code: string): code is V1ErrorCode {
	return (V1_ERROR_CODES as readonly string[]).includes(code);
}

// ============================================
// Session Event Types
// ============================================

export const SESSION_EVENT_TYPES = [
	"session_created",
	"session_started",
	"session_paused",
	"session_resumed",
	"session_completed",
	"session_failed",
	"session_cancelled",
	"session_outcome_persisted",
] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

// ============================================
// Structured Terminal Outcome
// ============================================

export interface SessionOutcome {
	summary: string | null;
	changedFileCount: number;
	topChangedFiles: string[];
	testSummary: {
		ran: number;
		passed: number;
		failed: number;
		skipped: number;
	} | null;
	pullRequest: {
		url: string;
		number: number;
		state: PullRequestState;
		branch: string;
	} | null;
	errorCode: string | null;
	errorMessage: string | null;
}
