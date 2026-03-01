/**
 * Wake Events DB operations.
 *
 * Raw Drizzle queries for wake_events.
 */

import {
	type InferSelectModel,
	and,
	asc,
	desc,
	eq,
	getDb,
	inArray,
	sql,
	wakeEvents,
	workerRuns,
	workers,
} from "@proliferate/services/db/client";

// ============================================
// Type Exports
// ============================================

export type WakeEventRow = InferSelectModel<typeof wakeEvents>;

export const WAKE_SOURCE_PRIORITY = {
	manual_message: 1,
	manual: 2,
	webhook: 3,
	tick: 4,
} as const;

// ============================================
// Queries
// ============================================

export interface CreateWakeEventInput {
	workerId: string;
	organizationId: string;
	source: string;
	payloadJson?: unknown;
}

export async function createWakeEvent(input: CreateWakeEventInput): Promise<WakeEventRow> {
	const db = getDb();
	const [row] = await db
		.insert(wakeEvents)
		.values({
			workerId: input.workerId,
			organizationId: input.organizationId,
			source: input.source,
			payloadJson: input.payloadJson ?? null,
		})
		.returning();
	return row;
}

export async function findWakeEventById(id: string): Promise<WakeEventRow | undefined> {
	const db = getDb();
	const [row] = await db.select().from(wakeEvents).where(eq(wakeEvents.id, id)).limit(1);
	return row;
}

export async function findWakeEventByIdForOrg(
	id: string,
	organizationId: string,
): Promise<WakeEventRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(wakeEvents)
		.where(and(eq(wakeEvents.id, id), eq(wakeEvents.organizationId, organizationId)))
		.limit(1);
	return row;
}

export async function updateWakeEventStatus(
	id: string,
	organizationId: string,
	status: string,
	fields?: {
		coalescedIntoWakeEventId?: string;
		claimedAt?: Date;
		consumedAt?: Date;
		failedAt?: Date;
	},
): Promise<WakeEventRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(wakeEvents)
		.set({ status, ...fields })
		.where(and(eq(wakeEvents.id, id), eq(wakeEvents.organizationId, organizationId)))
		.returning();
	return row;
}

export async function transitionWakeEventStatus(input: {
	id: string;
	organizationId: string;
	fromStatuses: string[];
	toStatus: string;
	fields?: {
		coalescedIntoWakeEventId?: string | null;
		claimedAt?: Date | null;
		consumedAt?: Date | null;
		failedAt?: Date | null;
	};
}): Promise<WakeEventRow | undefined> {
	if (input.fromStatuses.length === 0) {
		throw new Error("fromStatuses must include at least one status");
	}

	const db = getDb();
	const [row] = await db
		.update(wakeEvents)
		.set({
			status: input.toStatus,
			coalescedIntoWakeEventId: input.fields?.coalescedIntoWakeEventId,
			claimedAt: input.fields?.claimedAt,
			consumedAt: input.fields?.consumedAt,
			failedAt: input.fields?.failedAt,
		})
		.where(
			and(
				eq(wakeEvents.id, input.id),
				eq(wakeEvents.organizationId, input.organizationId),
				inArray(wakeEvents.status, input.fromStatuses),
			),
		)
		.returning();

	return row;
}

export async function updateWakePayload(
	id: string,
	organizationId: string,
	payloadJson: unknown,
): Promise<WakeEventRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(wakeEvents)
		.set({ payloadJson })
		.where(and(eq(wakeEvents.id, id), eq(wakeEvents.organizationId, organizationId)))
		.returning();
	return row;
}

/**
 * Atomically claims the highest-priority queued wake for a worker when:
 * - worker status is active
 * - worker has no active/non-terminal run
 */
export async function claimNextQueuedWakeForWorker(
	workerId: string,
	organizationId: string,
): Promise<WakeEventRow | undefined> {
	const db = getDb();
	const rows = await db.execute<WakeEventRow>(sql`
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
		RETURNING *
	`);

	return rows[0];
}

export async function listQueuedByWorker(workerId: string): Promise<WakeEventRow[]> {
	const db = getDb();
	return db
		.select()
		.from(wakeEvents)
		.where(and(eq(wakeEvents.workerId, workerId), eq(wakeEvents.status, "queued")))
		.orderBy(
			sql`CASE ${wakeEvents.source}
				WHEN 'manual_message' THEN 1
				WHEN 'manual' THEN 2
				WHEN 'webhook' THEN 3
				WHEN 'tick' THEN 4
				ELSE 99
			END`,
			asc(wakeEvents.createdAt),
		);
}

export async function listQueuedByWorkerAndSource(
	workerId: string,
	source: string,
): Promise<WakeEventRow[]> {
	const db = getDb();
	return db
		.select()
		.from(wakeEvents)
		.where(
			and(
				eq(wakeEvents.workerId, workerId),
				eq(wakeEvents.status, "queued"),
				eq(wakeEvents.source, source),
			),
		)
		.orderBy(asc(wakeEvents.createdAt));
}

export async function listByWorker(workerId: string, limit = 20): Promise<WakeEventRow[]> {
	const db = getDb();
	return db
		.select()
		.from(wakeEvents)
		.where(eq(wakeEvents.workerId, workerId))
		.orderBy(desc(wakeEvents.createdAt))
		.limit(limit);
}
