/**
 * Workers DB operations.
 *
 * Raw Drizzle queries for workers, worker_runs, worker_run_events.
 */

import {
	type InferSelectModel,
	actionInvocations,
	and,
	asc,
	desc,
	eq,
	getDb,
	inArray,
	sessionMessages,
	sessions,
	sql,
	wakeEvents,
	workerRunEvents,
	workerRuns,
	workers,
} from "@proliferate/services/db/client";
import type {
	WakeEventSource,
	WorkerRunEventType,
	WorkerRunStatus,
	WorkerStatus,
} from "@proliferate/shared/contracts";

// ============================================
// Transaction Helpers
// ============================================

export type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export function withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
	return getDb().transaction(fn);
}

const MAX_WORKER_RUNS = 100;

// ============================================
// Type Exports
// ============================================

export type WorkerRow = InferSelectModel<typeof workers>;
export type WakeEventRow = InferSelectModel<typeof wakeEvents>;
export type WorkerRunRow = InferSelectModel<typeof workerRuns>;
export type WorkerRunEventRow = InferSelectModel<typeof workerRunEvents>;
export type SessionRow = InferSelectModel<typeof sessions>;
export type SessionMessageRow = InferSelectModel<typeof sessionMessages>;

const ACTIVE_WORKER_RUN_STATUSES = ["queued", "running"] as const;
export const COALESCEABLE_WAKE_SOURCES = ["tick", "webhook"] as const;

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

/**
 * List all active workers across all organizations.
 * Used by the tick engine to produce wake events.
 */
export async function listActiveWorkers(): Promise<WorkerRow[]> {
	const db = getDb();
	return db.select().from(workers).where(eq(workers.status, "active"));
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
	organizationId: string,
	status: WorkerStatus,
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
		.where(and(eq(workers.id, id), eq(workers.organizationId, organizationId)))
		.returning();
	return row;
}

export async function transitionWorkerStatus(
	id: string,
	organizationId: string,
	fromStatuses: WorkerStatus[],
	toStatus: WorkerStatus,
	fields?: {
		lastWakeAt?: Date;
		lastCompletedRunAt?: Date;
		lastErrorCode?: string | null;
		pausedAt?: Date | null;
		pausedBy?: string | null;
	},
): Promise<WorkerRow | undefined> {
	if (fromStatuses.length === 0) {
		throw new Error("fromStatuses must include at least one status");
	}

	const db = getDb();
	const [row] = await db
		.update(workers)
		.set({
			status: toStatus,
			updatedAt: new Date(),
			...fields,
		})
		.where(
			and(
				eq(workers.id, id),
				eq(workers.organizationId, organizationId),
				inArray(workers.status, fromStatuses),
			),
		)
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

export async function findActiveRunByWorker(
	workerId: string,
	organizationId: string,
): Promise<WorkerRunRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(workerRuns)
		.where(
			and(
				eq(workerRuns.workerId, workerId),
				eq(workerRuns.organizationId, organizationId),
				inArray(workerRuns.status, [...ACTIVE_WORKER_RUN_STATUSES]),
			),
		)
		.orderBy(desc(workerRuns.createdAt))
		.limit(1);
	return row;
}

export async function updateWorkerRunStatus(
	id: string,
	organizationId: string,
	status: WorkerRunStatus,
	fields?: { summary?: string; completedAt?: Date; startedAt?: Date },
): Promise<WorkerRunRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(workerRuns)
		.set({ status, ...fields })
		.where(and(eq(workerRuns.id, id), eq(workerRuns.organizationId, organizationId)))
		.returning();
	return row;
}

export async function transitionWorkerRunStatus(
	id: string,
	organizationId: string,
	fromStatuses: WorkerRunStatus[],
	toStatus: WorkerRunStatus,
	fields?: { summary?: string; completedAt?: Date; startedAt?: Date },
): Promise<WorkerRunRow | undefined> {
	if (fromStatuses.length === 0) {
		throw new Error("fromStatuses must include at least one status");
	}

	const db = getDb();
	const [row] = await db
		.update(workerRuns)
		.set({
			status: toStatus,
			...fields,
		})
		.where(
			and(
				eq(workerRuns.id, id),
				eq(workerRuns.organizationId, organizationId),
				inArray(workerRuns.status, fromStatuses),
			),
		)
		.returning();
	return row;
}

export async function listRunsByWorker(workerId: string, limit = 10): Promise<WorkerRunRow[]> {
	const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 10;
	const sanitizedLimit = Math.max(1, Math.min(MAX_WORKER_RUNS, normalizedLimit));
	const db = getDb();
	return db
		.select()
		.from(workerRuns)
		.where(eq(workerRuns.workerId, workerId))
		.orderBy(desc(workerRuns.createdAt))
		.limit(sanitizedLimit);
}

export interface ClaimNextWakeAndCreateRunResult {
	worker: WorkerRow;
	wakeEvent: WakeEventRow;
	workerRun: WorkerRunRow;
	wakeStartedEvent: WorkerRunEventRow;
	coalescedWakeEventIds: string[];
}

// ============================================
// Transaction-aware query helpers for wake claim orchestration
// ============================================

export async function findWorkerForClaim(
	tx: DbTransaction,
	workerId: string,
	organizationId: string,
): Promise<WorkerRow | undefined> {
	const [row] = await tx
		.select()
		.from(workers)
		.where(and(eq(workers.id, workerId), eq(workers.organizationId, organizationId)))
		.limit(1);
	return row;
}

export async function hasActiveWorkerRun(
	tx: DbTransaction,
	workerId: string,
	organizationId: string,
): Promise<boolean> {
	const [activeRun] = await tx
		.select({ id: workerRuns.id })
		.from(workerRuns)
		.where(
			and(
				eq(workerRuns.workerId, workerId),
				eq(workerRuns.organizationId, organizationId),
				inArray(workerRuns.status, [...ACTIVE_WORKER_RUN_STATUSES]),
			),
		)
		.limit(1);
	return !!activeRun;
}

export async function claimNextQueuedWakeEvent(
	tx: DbTransaction,
	workerId: string,
	organizationId: string,
): Promise<string | null> {
	const claimedRows = await tx.execute<{ id: string }>(sql`
		UPDATE ${wakeEvents}
		SET "status" = 'claimed',
		    "claimed_at" = now()
		WHERE ${wakeEvents.id} IN (
			SELECT ${wakeEvents.id}
			FROM ${wakeEvents}
			WHERE ${wakeEvents.workerId} = ${workerId}
			  AND ${wakeEvents.organizationId} = ${organizationId}
			  AND ${wakeEvents.status} = 'queued'
			  AND EXISTS (
				SELECT 1
				FROM ${workers}
				WHERE ${workers.id} = ${wakeEvents.workerId}
				  AND ${workers.organizationId} = ${organizationId}
				  AND ${workers.status} = 'active'
			  )
			  AND NOT EXISTS (
				SELECT 1
				FROM ${workerRuns}
				WHERE ${workerRuns.workerId} = ${wakeEvents.workerId}
				  AND ${workerRuns.organizationId} = ${organizationId}
				  AND ${workerRuns.status} IN ('queued', 'running')
			  )
			ORDER BY
				CASE ${wakeEvents.source}
					WHEN 'manual_message' THEN 1
					WHEN 'manual' THEN 2
					WHEN 'webhook' THEN 3
					WHEN 'tick' THEN 4
					ELSE 99
				END ASC,
				${wakeEvents.createdAt} ASC
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING ${wakeEvents.id}
	`);
	return claimedRows[0]?.id ?? null;
}

export async function fetchWakeEventRow(
	tx: DbTransaction,
	wakeId: string,
	organizationId: string,
): Promise<WakeEventRow | undefined> {
	const [row] = await tx
		.select()
		.from(wakeEvents)
		.where(and(eq(wakeEvents.id, wakeId), eq(wakeEvents.organizationId, organizationId)))
		.limit(1);
	return row;
}

export async function findQueuedWakesBySource(
	tx: DbTransaction,
	workerId: string,
	organizationId: string,
	source: WakeEventSource,
): Promise<WakeEventRow[]> {
	return tx
		.select()
		.from(wakeEvents)
		.where(
			and(
				eq(wakeEvents.workerId, workerId),
				eq(wakeEvents.organizationId, organizationId),
				eq(wakeEvents.status, "queued"),
				eq(wakeEvents.source, source),
			),
		)
		.orderBy(asc(wakeEvents.createdAt));
}

export async function bulkCoalesceWakeEvents(
	tx: DbTransaction,
	candidateIds: string[],
	organizationId: string,
	coalescedIntoId: string,
): Promise<WakeEventRow[]> {
	if (candidateIds.length === 0) return [];
	return tx
		.update(wakeEvents)
		.set({
			status: "coalesced",
			coalescedIntoWakeEventId: coalescedIntoId,
		})
		.where(
			and(
				inArray(wakeEvents.id, candidateIds),
				eq(wakeEvents.organizationId, organizationId),
				eq(wakeEvents.status, "queued"),
			),
		)
		.returning();
}

export async function updateWakeEventPayload(
	tx: DbTransaction,
	wakeId: string,
	organizationId: string,
	payload: Record<string, unknown>,
): Promise<WakeEventRow | undefined> {
	const [row] = await tx
		.update(wakeEvents)
		.set({ payloadJson: payload })
		.where(and(eq(wakeEvents.id, wakeId), eq(wakeEvents.organizationId, organizationId)))
		.returning();
	return row;
}

export async function insertWorkerRun(
	tx: DbTransaction,
	values: {
		workerId: string;
		organizationId: string;
		managerSessionId: string;
		wakeEventId: string;
	},
): Promise<WorkerRunRow> {
	const [row] = await tx.insert(workerRuns).values(values).returning();
	return row;
}

export async function consumeWakeEvent(
	tx: DbTransaction,
	wakeId: string,
	organizationId: string,
): Promise<WakeEventRow | undefined> {
	const [row] = await tx
		.update(wakeEvents)
		.set({
			status: "consumed",
			consumedAt: new Date(),
		})
		.where(
			and(
				eq(wakeEvents.id, wakeId),
				eq(wakeEvents.organizationId, organizationId),
				eq(wakeEvents.status, "claimed"),
			),
		)
		.returning();
	return row;
}

export async function touchWorkerLastWake(
	tx: DbTransaction,
	workerId: string,
	organizationId: string,
): Promise<void> {
	await tx
		.update(workers)
		.set({
			lastWakeAt: new Date(),
			updatedAt: new Date(),
		})
		.where(and(eq(workers.id, workerId), eq(workers.organizationId, organizationId)));
}

export async function insertWakeStartedEvent(
	tx: DbTransaction,
	workerRunId: string,
	workerId: string,
	payload: { wakeEventId: string; source: string; coalescedWakeEventIds: string[] },
): Promise<WorkerRunEventRow> {
	const [row] = await tx
		.insert(workerRunEvents)
		.values({
			workerRunId,
			workerId,
			eventIndex: 0,
			eventType: "wake_started",
			payloadJson: payload,
			payloadVersion: 1,
		})
		.returning();
	return row;
}

// ============================================
// Worker Run Events — Queries
// ============================================

export interface CreateWorkerRunEventInput {
	workerRunId: string;
	workerId: string;
	eventIndex: number;
	eventType: WorkerRunEventType;
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

export interface AppendWorkerRunEventAtomicInput {
	workerRunId: string;
	workerId: string;
	eventType: WorkerRunEventType;
	summaryText?: string;
	payloadJson?: unknown;
	payloadVersion?: number;
	sessionId?: string;
	actionInvocationId?: string;
	dedupeKey?: string;
}

/**
 * Append a worker run event atomically per run.
 *
 * The worker_run row lock serializes writes for a run, guaranteeing monotonic
 * eventIndex allocation and race-safe dedupe reuse.
 */
export async function appendWorkerRunEventAtomic(
	input: AppendWorkerRunEventAtomicInput,
): Promise<WorkerRunEventRow> {
	const db = getDb();
	return db.transaction(async (tx) => {
		const [lockedRun] = await tx
			.select({ id: workerRuns.id })
			.from(workerRuns)
			.where(eq(workerRuns.id, input.workerRunId))
			.for("update")
			.limit(1);
		if (!lockedRun) {
			throw new Error(`Worker run not found for event append: ${input.workerRunId}`);
		}

		if (input.dedupeKey) {
			const [existing] = await tx
				.select()
				.from(workerRunEvents)
				.where(
					and(
						eq(workerRunEvents.workerRunId, input.workerRunId),
						eq(workerRunEvents.dedupeKey, input.dedupeKey),
					),
				)
				.limit(1);
			if (existing) {
				return existing;
			}
		}

		const [lastRow] = await tx
			.select({ eventIndex: workerRunEvents.eventIndex })
			.from(workerRunEvents)
			.where(eq(workerRunEvents.workerRunId, input.workerRunId))
			.orderBy(desc(workerRunEvents.eventIndex))
			.limit(1);
		const eventIndex = (lastRow?.eventIndex ?? -1) + 1;

		const [row] = await tx
			.insert(workerRunEvents)
			.values({
				workerRunId: input.workerRunId,
				workerId: input.workerId,
				eventIndex,
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
	});
}

export interface TransitionWorkerRunWithTerminalEventInput {
	workerRunId: string;
	organizationId: string;
	fromStatuses: WorkerRunStatus[];
	toStatus: WorkerRunStatus;
	summary?: string;
	completedAt: Date;
	eventType: WorkerRunEventType;
	eventPayloadJson?: unknown;
	eventSummaryText?: string;
}

/**
 * Atomically transitions a worker run and appends the terminal timeline event.
 */
export async function transitionWorkerRunWithTerminalEvent(
	input: TransitionWorkerRunWithTerminalEventInput,
): Promise<{ workerRun: WorkerRunRow; event: WorkerRunEventRow } | null> {
	const db = getDb();
	return db.transaction(async (tx) => {
		const [run] = await tx
			.select()
			.from(workerRuns)
			.where(
				and(
					eq(workerRuns.id, input.workerRunId),
					eq(workerRuns.organizationId, input.organizationId),
				),
			)
			.for("update")
			.limit(1);
		if (!run) {
			return null;
		}
		if (!input.fromStatuses.includes(run.status)) {
			return null;
		}

		const [updatedRun] = await tx
			.update(workerRuns)
			.set({
				status: input.toStatus,
				summary: input.summary,
				completedAt: input.completedAt,
			})
			.where(
				and(
					eq(workerRuns.id, input.workerRunId),
					eq(workerRuns.organizationId, input.organizationId),
					inArray(workerRuns.status, input.fromStatuses),
				),
			)
			.returning();
		if (!updatedRun) {
			return null;
		}

		const [lastRow] = await tx
			.select({ eventIndex: workerRunEvents.eventIndex })
			.from(workerRunEvents)
			.where(eq(workerRunEvents.workerRunId, updatedRun.id))
			.orderBy(desc(workerRunEvents.eventIndex))
			.limit(1);
		const nextEventIndex = (lastRow?.eventIndex ?? -1) + 1;

		const [event] = await tx
			.insert(workerRunEvents)
			.values({
				workerRunId: updatedRun.id,
				workerId: updatedRun.workerId,
				eventIndex: nextEventIndex,
				eventType: input.eventType,
				summaryText: input.eventSummaryText ?? null,
				payloadJson: input.eventPayloadJson ?? null,
				payloadVersion: 1,
			})
			.returning();

		return { workerRun: updatedRun, event };
	});
}

export async function findWorkerRunEventByDedupeKey(
	workerRunId: string,
	dedupeKey: string,
): Promise<WorkerRunEventRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(workerRunEvents)
		.where(
			and(eq(workerRunEvents.workerRunId, workerRunId), eq(workerRunEvents.dedupeKey, dedupeKey)),
		)
		.limit(1);
	return row;
}

export async function getNextWorkerRunEventIndex(workerRunId: string): Promise<number> {
	const db = getDb();
	const [lastRow] = await db
		.select({ eventIndex: workerRunEvents.eventIndex })
		.from(workerRunEvents)
		.where(eq(workerRunEvents.workerRunId, workerRunId))
		.orderBy(desc(workerRunEvents.eventIndex))
		.limit(1);
	return (lastRow?.eventIndex ?? -1) + 1;
}

export async function listEventsByRun(workerRunId: string): Promise<WorkerRunEventRow[]> {
	const db = getDb();
	return db
		.select()
		.from(workerRunEvents)
		.where(eq(workerRunEvents.workerRunId, workerRunId))
		.orderBy(workerRunEvents.eventIndex);
}

// ============================================
// Workers — Aggregate Queries (Coworker UI)
// ============================================

export type WorkerWithCounts = WorkerRow & {
	activeTaskCount: number;
	pendingApprovalCount: number;
};

export async function listWorkersByOrgWithCounts(orgId: string): Promise<WorkerWithCounts[]> {
	const db = getDb();
	const rows = await db
		.select({
			worker: workers,
			activeTaskCount: sql<number>`(
				SELECT count(*)::int FROM ${sessions}
				WHERE ${sessions.workerId} = ${workers.id}
				AND ${sessions.kind} = 'task'
				AND ${sessions.status} NOT IN ('completed', 'failed', 'cancelled')
			)`.as("active_task_count"),
			pendingApprovalCount: sql<number>`(
				SELECT count(*)::int FROM ${actionInvocations}
				WHERE ${actionInvocations.sessionId} IN (
					SELECT ${sessions.id} FROM ${sessions}
					WHERE ${sessions.workerId} = ${workers.id}
				)
				AND ${actionInvocations.status} = 'pending'
			)`.as("pending_approval_count"),
		})
		.from(workers)
		.where(eq(workers.organizationId, orgId))
		.orderBy(desc(workers.updatedAt));

	return rows.map((row) => ({
		...row.worker,
		activeTaskCount: row.activeTaskCount,
		pendingApprovalCount: row.pendingApprovalCount,
	}));
}

export async function listRunsByWorkerWithEvents(
	workerId: string,
	limit = 10,
): Promise<Array<WorkerRunRow & { events: WorkerRunEventRow[] }>> {
	const runs = await listRunsByWorker(workerId, limit);
	const results = await Promise.all(
		runs.map(async (run) => {
			const events = await listEventsByRun(run.id);
			return { ...run, events };
		}),
	);
	return results;
}

export async function listSessionsByWorker(
	workerId: string,
	orgId: string,
	limit = 50,
): Promise<SessionRow[]> {
	const db = getDb();
	return db
		.select()
		.from(sessions)
		.where(
			and(
				eq(sessions.workerId, workerId),
				eq(sessions.organizationId, orgId),
				eq(sessions.kind, "task"),
			),
		)
		.orderBy(desc(sessions.startedAt))
		.limit(limit);
}

export async function listChildSessionsByWorkerRun(
	workerRunId: string,
	orgId: string,
): Promise<SessionRow[]> {
	const db = getDb();
	return db
		.select()
		.from(sessions)
		.where(
			and(
				eq(sessions.workerRunId, workerRunId),
				eq(sessions.organizationId, orgId),
				eq(sessions.kind, "task"),
			),
		)
		.orderBy(desc(sessions.startedAt));
}

export async function listPendingDirectives(
	managerSessionId: string,
): Promise<SessionMessageRow[]> {
	const db = getDb();
	return db
		.select()
		.from(sessionMessages)
		.where(
			and(
				eq(sessionMessages.sessionId, managerSessionId),
				eq(sessionMessages.deliveryState, "queued"),
				eq(sessionMessages.direction, "user_to_manager"),
			),
		)
		.orderBy(asc(sessionMessages.queuedAt));
}

export async function updateWorker(
	id: string,
	orgId: string,
	fields: { name?: string; objective?: string; modelId?: string },
): Promise<WorkerRow | undefined> {
	const db = getDb();
	const setFields: Record<string, unknown> = { updatedAt: new Date() };
	if (fields.name !== undefined) setFields.name = fields.name;
	if (fields.objective !== undefined) setFields.objective = fields.objective;
	if (fields.modelId !== undefined) setFields.modelId = fields.modelId;

	const [row] = await db
		.update(workers)
		.set(setFields)
		.where(and(eq(workers.id, id), eq(workers.organizationId, orgId)))
		.returning();
	return row;
}

export async function deleteWorker(id: string, orgId: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.delete(workers)
		.where(and(eq(workers.id, id), eq(workers.organizationId, orgId)))
		.returning({ id: workers.id });
	return result.length > 0;
}
