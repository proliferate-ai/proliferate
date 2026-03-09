/**
 * Worker Jobs DB operations.
 *
 * Raw Drizzle queries for the worker_jobs table.
 */

import {
	type InferSelectModel,
	and,
	desc,
	eq,
	getDb,
	workerJobs,
} from "@proliferate/services/db/client";

// ============================================
// Type Exports
// ============================================

export type WorkerJobRow = InferSelectModel<typeof workerJobs>;

// ============================================
// Queries
// ============================================

export async function findJobById(
	id: string,
	organizationId: string,
): Promise<WorkerJobRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(workerJobs)
		.where(and(eq(workerJobs.id, id), eq(workerJobs.organizationId, organizationId)))
		.limit(1);
	return row;
}

/**
 * List all enabled jobs across all organizations.
 * Used by the tick scheduler to sync BullMQ repeatable jobs.
 */
export async function listAllEnabledJobs(): Promise<WorkerJobRow[]> {
	const db = getDb();
	return db.select().from(workerJobs).where(eq(workerJobs.enabled, true));
}

export async function listJobsForWorker(
	workerId: string,
	organizationId: string,
): Promise<WorkerJobRow[]> {
	const db = getDb();
	return db
		.select()
		.from(workerJobs)
		.where(and(eq(workerJobs.workerId, workerId), eq(workerJobs.organizationId, organizationId)))
		.orderBy(desc(workerJobs.createdAt));
}

export interface CreateWorkerJobInput {
	workerId: string;
	organizationId: string;
	name: string;
	description?: string;
	checkInPrompt: string;
	cronExpression: string;
	enabled?: boolean;
	nextTickAt?: Date;
}

export async function createWorkerJob(input: CreateWorkerJobInput): Promise<WorkerJobRow> {
	const db = getDb();
	const [row] = await db
		.insert(workerJobs)
		.values({
			workerId: input.workerId,
			organizationId: input.organizationId,
			name: input.name,
			description: input.description ?? null,
			checkInPrompt: input.checkInPrompt,
			cronExpression: input.cronExpression,
			enabled: input.enabled ?? true,
			nextTickAt: input.nextTickAt ?? null,
		})
		.returning();
	return row;
}

export async function updateWorkerJob(
	id: string,
	organizationId: string,
	fields: {
		name?: string;
		description?: string | null;
		checkInPrompt?: string;
		cronExpression?: string;
		enabled?: boolean;
		nextTickAt?: Date | null;
	},
): Promise<WorkerJobRow | undefined> {
	const db = getDb();
	const setFields: Record<string, unknown> = { updatedAt: new Date() };
	if (fields.name !== undefined) setFields.name = fields.name;
	if (fields.description !== undefined) setFields.description = fields.description;
	if (fields.checkInPrompt !== undefined) setFields.checkInPrompt = fields.checkInPrompt;
	if (fields.cronExpression !== undefined) setFields.cronExpression = fields.cronExpression;
	if (fields.enabled !== undefined) setFields.enabled = fields.enabled;
	if (fields.nextTickAt !== undefined) setFields.nextTickAt = fields.nextTickAt;

	const [row] = await db
		.update(workerJobs)
		.set(setFields)
		.where(and(eq(workerJobs.id, id), eq(workerJobs.organizationId, organizationId)))
		.returning();
	return row;
}

export async function deleteWorkerJob(id: string, organizationId: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.delete(workerJobs)
		.where(and(eq(workerJobs.id, id), eq(workerJobs.organizationId, organizationId)))
		.returning({ id: workerJobs.id });
	return result.length > 0;
}

export async function updateLastTick(
	id: string,
	organizationId: string,
	lastTickAt: Date,
	nextTickAt: Date | null,
): Promise<WorkerJobRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(workerJobs)
		.set({
			lastTickAt,
			nextTickAt,
			updatedAt: new Date(),
		})
		.where(and(eq(workerJobs.id, id), eq(workerJobs.organizationId, organizationId)))
		.returning();
	return row;
}
