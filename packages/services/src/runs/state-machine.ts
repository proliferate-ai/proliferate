import type { AutomationRunStatus } from "@proliferate/shared/contracts";

/**
 * Legal automation run status transitions.
 *
 * `canceled` and `skipped` are preserved for schema compatibility but have
 * no in-pipeline entry points today.
 */
export const VALID_TRANSITIONS: Record<AutomationRunStatus, readonly AutomationRunStatus[]> = {
	queued: ["enriching"],
	enriching: ["ready", "failed"],
	ready: ["running", "failed"],
	running: ["succeeded", "failed", "needs_human", "timed_out"],
	succeeded: [],
	failed: ["succeeded", "failed"],
	needs_human: ["succeeded", "failed"],
	timed_out: ["succeeded", "failed"],
	canceled: [],
	skipped: [],
};

function isRunStatus(value: string): value is AutomationRunStatus {
	return value in VALID_TRANSITIONS;
}

export class InvalidRunStatusTransitionError extends Error {
	readonly fromStatus: string;
	readonly toStatus: string;

	constructor(fromStatus: string, toStatus: string) {
		super(`Invalid automation run status transition: ${fromStatus} -> ${toStatus}`);
		this.fromStatus = fromStatus;
		this.toStatus = toStatus;
	}
}

export function validateTransition(fromStatus: string, toStatus: string): void {
	if (!isRunStatus(fromStatus)) {
		throw new InvalidRunStatusTransitionError(fromStatus, toStatus);
	}
	if (!isRunStatus(toStatus)) {
		throw new InvalidRunStatusTransitionError(fromStatus, toStatus);
	}
	if (!VALID_TRANSITIONS[fromStatus].includes(toStatus)) {
		throw new InvalidRunStatusTransitionError(fromStatus, toStatus);
	}
}
