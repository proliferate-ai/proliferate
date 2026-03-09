/**
 * V1 worker and wake contracts.
 */

/** Synthetic user ID used as the sender for job-tick prompts. */
export const SYSTEM_JOB_TICK_USER_ID = "system:job-tick";

export const WORKER_STATUSES = [
	"active",
	"automations_paused",
	"degraded",
	"failed",
	"archived",
] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

const WORKER_TRANSITIONS: Record<WorkerStatus, readonly WorkerStatus[]> = {
	active: ["automations_paused", "degraded", "failed", "archived"],
	automations_paused: ["active", "failed", "archived"],
	degraded: ["active", "failed", "archived"],
	failed: ["active", "archived"],
	archived: [],
};

export function isValidWorkerTransition(from: WorkerStatus, to: WorkerStatus): boolean {
	return WORKER_TRANSITIONS[from]?.includes(to) ?? false;
}

export const WAKE_EVENT_SOURCES = ["tick", "webhook", "manual", "manual_message"] as const;
export type WakeEventSource = (typeof WAKE_EVENT_SOURCES)[number];

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
