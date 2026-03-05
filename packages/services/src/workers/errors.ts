/**
 * Custom error classes for the workers service.
 */

export class WorkerNotFoundError extends Error {
	constructor(workerId: string) {
		super(`Worker not found: ${workerId}`);
	}
}

export class WorkerStatusTransitionError extends Error {
	constructor(fromStatus: string, toStatus: string) {
		super(`Invalid worker transition: ${fromStatus} -> ${toStatus}`);
	}
}

export class WorkerResumeRequiredError extends Error {
	readonly code = "resume_required";

	constructor(workerId: string) {
		super(`Worker ${workerId} is paused and must be resumed before running now`);
	}
}

export class WorkerNotActiveError extends Error {
	constructor(workerId: string, status: string) {
		super(`Worker ${workerId} must be active to run now (current: ${status})`);
	}
}

export class WorkerRunNotFoundError extends Error {
	constructor(workerRunId: string) {
		super(`Worker run not found: ${workerRunId}`);
	}
}

export class WorkerRunTransitionError extends Error {
	constructor(fromStatus: string, toStatus: string) {
		super(`Invalid worker run transition: ${fromStatus} -> ${toStatus}`);
	}
}

export class WorkerRunEventTypeError extends Error {
	constructor(eventType: string) {
		super(`Invalid worker run event type: ${eventType}`);
	}
}
