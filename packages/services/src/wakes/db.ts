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
} from "@proliferate/services/db/client";
import type { WakeEventSource, WakeEventStatus } from "@proliferate/shared/contracts";

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
	source: WakeEventSource;
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
	status: WakeEventStatus,
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
	fromStatuses: WakeEventStatus[];
	toStatus: WakeEventStatus;
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

export async function listQueuedByWorkerAndSource(
	workerId: string,
	organizationId: string,
	source: WakeEventSource,
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
				eq(wakeEvents.source, source),
			),
		)
		.orderBy(asc(wakeEvents.createdAt));
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
