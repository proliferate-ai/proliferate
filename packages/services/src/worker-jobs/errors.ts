/**
 * Custom error classes for the worker-jobs service.
 */

export class WorkerJobNotFoundError extends Error {
	constructor(jobId: string) {
		super(`Worker job not found: ${jobId}`);
	}
}

export class WorkerJobValidationError extends Error {}
