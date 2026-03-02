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
	sql,
	wakeEvents,
} from "@proliferate/services/db/client";

// ============================================
// Type Exports
// ============================================

export type WakeEventRow = InferSelectModel<typeof wakeEvents>;

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

export async function findWakeEventById(
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

export async function listQueuedByWorker(
	workerId: string,
	organizationId: string,
): Promise<WakeEventRow[]> {
	const db = getDb();
	return db
		.select()
		.from(wakeEvents)
		.where(
			and(
				eq(wakeEvents.workerId, workerId),
				eq(wakeEvents.organizationId, organizationId),
				eq(wakeEvents.status, "queued"),
			),
		)
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

export async function listByWorker(
	workerId: string,
	organizationId: string,
	limit = 20,
): Promise<WakeEventRow[]> {
	const db = getDb();
	return db
		.select()
		.from(wakeEvents)
		.where(and(eq(wakeEvents.workerId, workerId), eq(wakeEvents.organizationId, organizationId)))
		.orderBy(desc(wakeEvents.createdAt))
		.limit(limit);
}
