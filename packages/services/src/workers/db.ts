/**
 * Workers DB operations.
 *
 * Raw Drizzle queries for workers, worker_runs, worker_run_events.
 */

import {
	type InferSelectModel,
	and,
	desc,
	eq,
	getDb,
	workerRunEvents,
	workerRuns,
	workers,
} from "../db/client";

// ============================================
// Type Exports
// ============================================

export type WorkerRow = InferSelectModel<typeof workers>;
export type WorkerRunRow = InferSelectModel<typeof workerRuns>;
export type WorkerRunEventRow = InferSelectModel<typeof workerRunEvents>;

// ============================================
// Workers — Queries
// ============================================

export async function findWorkerById(id: string, orgId: string): Promise<WorkerRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(workers)
		.where(and(eq(workers.id, id), eq(workers.organizationId, orgId)))
		.limit(1);
	return row;
}

export async function listWorkersByOrg(orgId: string): Promise<WorkerRow[]> {
	const db = getDb();
	return db
		.select()
		.from(workers)
		.where(eq(workers.organizationId, orgId))
		.orderBy(desc(workers.updatedAt));
}

export interface CreateWorkerInput {
	organizationId: string;
	name: string;
	objective?: string;
	managerSessionId: string;
	modelId?: string;
	computeProfile?: string;
	createdBy?: string;
}

export async function createWorker(input: CreateWorkerInput): Promise<WorkerRow> {
	if (!input.managerSessionId) {
		throw new Error("workers.managerSessionId is required");
	}

	const db = getDb();
	const [row] = await db
		.insert(workers)
		.values({
			organizationId: input.organizationId,
			name: input.name,
			objective: input.objective ?? null,
			managerSessionId: input.managerSessionId,
			modelId: input.modelId ?? null,
			computeProfile: input.computeProfile ?? null,
			createdBy: input.createdBy ?? null,
		})
		.returning();
	return row;
}

export async function updateWorkerStatus(
	id: string,
	status: string,
	fields?: {
		lastWakeAt?: Date;
		lastCompletedRunAt?: Date;
		lastErrorCode?: string | null;
		pausedAt?: Date | null;
		pausedBy?: string | null;
	},
): Promise<WorkerRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(workers)
		.set({
			status,
			updatedAt: new Date(),
			...fields,
		})
		.where(eq(workers.id, id))
		.returning();
	return row;
}

// ============================================
// Worker Runs — Queries
// ============================================

export interface CreateWorkerRunInput {
	workerId: string;
	organizationId: string;
	managerSessionId: string;
	wakeEventId: string;
}

/**
 * Create a worker run. managerSessionId must be set (required invariant).
 */
export async function createWorkerRun(input: CreateWorkerRunInput): Promise<WorkerRunRow> {
	if (!input.managerSessionId) {
		throw new Error("worker_runs.managerSessionId is required (immutable snapshot)");
	}
	const db = getDb();
	const [row] = await db
		.insert(workerRuns)
		.values({
			workerId: input.workerId,
			organizationId: input.organizationId,
			managerSessionId: input.managerSessionId,
			wakeEventId: input.wakeEventId,
		})
		.returning();
	return row;
}

export async function findWorkerRunById(id: string): Promise<WorkerRunRow | undefined> {
	const db = getDb();
	const [row] = await db.select().from(workerRuns).where(eq(workerRuns.id, id)).limit(1);
	return row;
}

export async function updateWorkerRunStatus(
	id: string,
	status: string,
	fields?: { summary?: string; completedAt?: Date; startedAt?: Date },
): Promise<WorkerRunRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(workerRuns)
		.set({ status, ...fields })
		.where(eq(workerRuns.id, id))
		.returning();
	return row;
}

export async function listRunsByWorker(workerId: string, limit = 10): Promise<WorkerRunRow[]> {
	const db = getDb();
	return db
		.select()
		.from(workerRuns)
		.where(eq(workerRuns.workerId, workerId))
		.orderBy(desc(workerRuns.createdAt))
		.limit(limit);
}

// ============================================
// Worker Run Events — Queries
// ============================================

export interface CreateWorkerRunEventInput {
	workerRunId: string;
	workerId: string;
	eventIndex: number;
	eventType: string;
	summaryText?: string;
	payloadJson?: unknown;
	payloadVersion?: number;
	sessionId?: string;
	actionInvocationId?: string;
	dedupeKey?: string;
}

export async function createWorkerRunEvent(
	input: CreateWorkerRunEventInput,
): Promise<WorkerRunEventRow> {
	const db = getDb();
	const [row] = await db
		.insert(workerRunEvents)
		.values({
			workerRunId: input.workerRunId,
			workerId: input.workerId,
			eventIndex: input.eventIndex,
			eventType: input.eventType,
			summaryText: input.summaryText ?? null,
			payloadJson: input.payloadJson ?? null,
			payloadVersion: input.payloadVersion ?? 1,
			sessionId: input.sessionId ?? null,
			actionInvocationId: input.actionInvocationId ?? null,
			dedupeKey: input.dedupeKey ?? null,
		})
		.returning();
	return row;
}

export async function listEventsByRun(workerRunId: string): Promise<WorkerRunEventRow[]> {
	const db = getDb();
	return db
		.select()
		.from(workerRunEvents)
		.where(eq(workerRunEvents.workerRunId, workerRunId))
		.orderBy(workerRunEvents.eventIndex);
}
