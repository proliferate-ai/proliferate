/**
 * Outbox service.
 */

import { and, eq, getDb, lte, outbox, sql } from "../db/client";
import type { InferSelectModel } from "../db/client";

export type OutboxRow = InferSelectModel<typeof outbox>;

export interface EnqueueOutboxInput {
	organizationId: string;
	kind: string;
	payload: Record<string, unknown>;
	availableAt?: Date;
}

export async function enqueueOutbox(input: EnqueueOutboxInput): Promise<OutboxRow> {
	const db = getDb();
	const [row] = await db
		.insert(outbox)
		.values({
			organizationId: input.organizationId,
			kind: input.kind,
			payload: input.payload,
			availableAt: input.availableAt,
			status: "pending",
		})
		.returning();

	return row;
}

export async function listPendingOutbox(limit = 50): Promise<OutboxRow[]> {
	const db = getDb();
	const now = new Date();
	return db
		.select()
		.from(outbox)
		.where(and(eq(outbox.status, "pending"), lte(outbox.availableAt, now)))
		.limit(limit);
}

export async function markDispatched(outboxId: string): Promise<void> {
	const db = getDb();
	await db.update(outbox).set({ status: "dispatched" }).where(eq(outbox.id, outboxId));
}

export async function markFailed(
	outboxId: string,
	errorMessage: string,
	nextAttemptAt?: Date,
): Promise<void> {
	const db = getDb();
	const status = nextAttemptAt ? "pending" : "failed";
	await db
		.update(outbox)
		.set({
			status,
			lastError: errorMessage,
			attempts: sql`${outbox.attempts} + 1`,
			availableAt: nextAttemptAt,
		})
		.where(eq(outbox.id, outboxId));
}
