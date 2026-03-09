/**
 * Worker Jobs service.
 *
 * Business rules around scheduled check-in prompts for coworkers.
 */

import { getServicesLogger } from "../logger";
import * as workersDb from "../workers/db";
import type { WorkerJobRow } from "./db";
import * as workerJobsDb from "./db";
import { WorkerJobNotFoundError, WorkerJobValidationError } from "./errors";

export { WorkerJobNotFoundError, WorkerJobValidationError } from "./errors";

const logger = getServicesLogger().child({ module: "worker-jobs" });

// ============================================
// Types
// ============================================

export interface WorkerJobDetail {
	id: string;
	workerId: string;
	organizationId: string;
	name: string;
	description: string | null;
	checkInPrompt: string;
	cronExpression: string;
	enabled: boolean;
	lastTickAt: Date | null;
	nextTickAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateWorkerJobInput {
	workerId: string;
	organizationId: string;
	name: string;
	description?: string;
	checkInPrompt: string;
	cronExpression: string;
	enabled?: boolean;
}

export interface UpdateWorkerJobInput {
	jobId: string;
	organizationId: string;
	fields: {
		name?: string;
		description?: string | null;
		checkInPrompt?: string;
		cronExpression?: string;
		enabled?: boolean;
	};
}

// ============================================
// Helpers
// ============================================

function toJobDetail(row: WorkerJobRow): WorkerJobDetail {
	return {
		id: row.id,
		workerId: row.workerId,
		organizationId: row.organizationId,
		name: row.name,
		description: row.description,
		checkInPrompt: row.checkInPrompt,
		cronExpression: row.cronExpression,
		enabled: row.enabled,
		lastTickAt: row.lastTickAt,
		nextTickAt: row.nextTickAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Basic cron expression validation.
 * Accepts standard 5-field cron expressions (minute hour dom month dow).
 */
function validateCronExpression(expr: string): void {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) {
		throw new WorkerJobValidationError(
			`Invalid cron expression: expected 5 fields, got ${parts.length}`,
		);
	}
}

// ============================================
// Service Functions
// ============================================

export async function createWorkerJob(input: CreateWorkerJobInput): Promise<WorkerJobDetail> {
	// Validate worker exists and belongs to the org
	const worker = await workersDb.findWorkerById(input.workerId, input.organizationId);
	if (!worker) {
		throw new WorkerJobValidationError(`Worker not found: ${input.workerId}`);
	}

	validateCronExpression(input.cronExpression);

	if (!input.name.trim()) {
		throw new WorkerJobValidationError("Job name cannot be empty");
	}

	if (!input.checkInPrompt.trim()) {
		throw new WorkerJobValidationError("Check-in prompt cannot be empty");
	}

	const row = await workerJobsDb.createWorkerJob({
		workerId: input.workerId,
		organizationId: input.organizationId,
		name: input.name.trim(),
		description: input.description?.trim(),
		checkInPrompt: input.checkInPrompt.trim(),
		cronExpression: input.cronExpression.trim(),
		enabled: input.enabled,
	});

	logger.info({ jobId: row.id, workerId: input.workerId }, "Worker job created");
	return toJobDetail(row);
}

export async function updateWorkerJob(input: UpdateWorkerJobInput): Promise<WorkerJobDetail> {
	if (input.fields.cronExpression !== undefined) {
		validateCronExpression(input.fields.cronExpression);
	}

	if (input.fields.name !== undefined && !input.fields.name.trim()) {
		throw new WorkerJobValidationError("Job name cannot be empty");
	}

	if (input.fields.checkInPrompt !== undefined && !input.fields.checkInPrompt.trim()) {
		throw new WorkerJobValidationError("Check-in prompt cannot be empty");
	}

	const row = await workerJobsDb.updateWorkerJob(input.jobId, input.organizationId, input.fields);
	if (!row) {
		throw new WorkerJobNotFoundError(input.jobId);
	}

	return toJobDetail(row);
}

export async function deleteWorkerJob(jobId: string, organizationId: string): Promise<boolean> {
	const deleted = await workerJobsDb.deleteWorkerJob(jobId, organizationId);
	if (!deleted) {
		throw new WorkerJobNotFoundError(jobId);
	}
	return true;
}

export async function listJobsForWorker(
	workerId: string,
	organizationId: string,
): Promise<WorkerJobDetail[]> {
	// Validate worker exists
	const worker = await workersDb.findWorkerById(workerId, organizationId);
	if (!worker) {
		throw new WorkerJobValidationError(`Worker not found: ${workerId}`);
	}

	const rows = await workerJobsDb.listJobsForWorker(workerId);
	return rows.map(toJobDetail);
}

export async function findJobById(jobId: string, organizationId: string): Promise<WorkerJobDetail> {
	const row = await workerJobsDb.findJobById(jobId, organizationId);
	if (!row) {
		throw new WorkerJobNotFoundError(jobId);
	}
	return toJobDetail(row);
}

export async function updateLastTick(
	jobId: string,
	organizationId: string,
	lastTickAt: Date,
	nextTickAt: Date | null,
): Promise<WorkerJobDetail> {
	const row = await workerJobsDb.updateLastTick(jobId, organizationId, lastTickAt, nextTickAt);
	if (!row) {
		throw new WorkerJobNotFoundError(jobId);
	}
	return toJobDetail(row);
}
