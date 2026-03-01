/**
 * Wake Events DB operations.
 *
 * Raw Drizzle queries for wake_events.
 */

import {
	type InferSelectModel,
	and,
	desc,
	eq,
	getDb,
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

export async function findWakeEventById(id: string): Promise<WakeEventRow | undefined> {
	const db = getDb();
	const [row] = await db.select().from(wakeEvents).where(eq(wakeEvents.id, id)).limit(1);
	return row;
}

export async function updateWakeEventStatus(
	id: string,
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
		.where(eq(wakeEvents.id, id))
		.returning();
	return row;
}

export async function listQueuedByWorker(workerId: string): Promise<WakeEventRow[]> {
	const db = getDb();
	return db
		.select()
		.from(wakeEvents)
		.where(and(eq(wakeEvents.workerId, workerId), eq(wakeEvents.status, "queued")))
		.orderBy(desc(wakeEvents.createdAt));
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
