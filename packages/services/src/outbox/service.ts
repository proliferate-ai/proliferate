/**
 * Outbox service.
 */

import { and, eq, getDb, lte, outbox, sql } from "../db/client";
import type { InferSelectModel } from "../db/client";

export type OutboxRow = InferSelectModel<typeof outbox>;

export const MAX_ATTEMPTS = 5;
export const CLAIM_LEASE_MS = 5 * 60 * 1000;

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

/**
 * Atomically claim pending outbox rows for processing.
 *
 * Uses UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING
 * to guarantee each row is claimed by exactly one poller, even under
 * concurrent polling ticks.
 */
export async function claimPendingOutbox(limit = 50): Promise<OutboxRow[]> {
	const db = getDb();
	// NOTE: SET targets must use unqualified column names (PostgreSQL requirement).
	// Drizzle's ${outbox.col} produces "outbox"."col" which is invalid on the LHS of SET.
	const rows = await db.execute<OutboxRow>(sql`
		UPDATE ${outbox}
		SET "status" = 'processing',
		    "claimed_at" = now()
		WHERE ${outbox.id} IN (
			SELECT ${outbox.id}
			FROM ${outbox}
			WHERE ${outbox.status} = 'pending'
			  AND ${outbox.availableAt} <= now()
			ORDER BY ${outbox.availableAt} ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		)
		RETURNING *
	`);
	return Array.from(rows);
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
	const newAttempts = sql`${outbox.attempts} + 1`;

	// If we've exhausted retries, permanently fail regardless of nextAttemptAt
	const maxedOut = sql`${outbox.attempts} + 1 >= ${MAX_ATTEMPTS}`;
	const status = nextAttemptAt
		? sql`CASE WHEN ${maxedOut} THEN 'failed' ELSE 'pending' END`
		: sql`'failed'`;

	await db
		.update(outbox)
		.set({
			status: sql`${status}`,
			lastError: errorMessage,
			attempts: newAttempts,
			availableAt: nextAttemptAt ?? sql`${outbox.availableAt}`,
			claimedAt: null,
		})
		.where(eq(outbox.id, outboxId));
}

/**
 * Recover outbox rows stuck in 'processing' state beyond the lease timeout.
 * Resets them to 'pending' so they can be re-claimed on the next tick.
 *
 * Returns the number of recovered rows.
 */
export async function recoverStuckOutbox(leaseMs = CLAIM_LEASE_MS): Promise<number> {
	const db = getDb();
	const cutoff = new Date(Date.now() - leaseMs).toISOString();
	// NOTE: SET targets must use unqualified column names (PostgreSQL requirement).
	// RHS and WHERE can use table-qualified refs via Drizzle's ${outbox.col}.
	const result = await db.execute<{ count: string }>(sql`
		UPDATE ${outbox}
		SET "status" = CASE
		      WHEN ${outbox.attempts} + 1 >= ${MAX_ATTEMPTS} THEN 'failed'
		      ELSE 'pending'
		    END,
		    "attempts" = ${outbox.attempts} + 1,
		    "claimed_at" = NULL
		WHERE ${outbox.status} = 'processing'
		  AND ${outbox.claimedAt} < ${cutoff}
		RETURNING 1 AS count
	`);
	return result.length;
}
