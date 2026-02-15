/**
 * Webhook Inbox DB operations.
 *
 * Raw Drizzle queries for the async webhook inbox pattern.
 * The inbox decouples fast-ack ingestion from async processing.
 */

import { and, eq, getDb, inArray, lt, sql, webhookInbox } from "../db/client";
import type { InferSelectModel } from "../db/client";

export type WebhookInboxRow = InferSelectModel<typeof webhookInbox>;

// ============================================
// Insert
// ============================================

export interface InsertInboxRowInput {
	provider: string;
	organizationId?: string | null;
	externalId?: string | null;
	headers?: Record<string, unknown> | null;
	payload: unknown;
	signature?: string | null;
}

/**
 * Insert a raw webhook payload into the inbox for async processing.
 * Called by the fast-ack Express handler.
 */
export async function insertInboxRow(input: InsertInboxRowInput): Promise<WebhookInboxRow> {
	const db = getDb();
	const [row] = await db
		.insert(webhookInbox)
		.values({
			provider: input.provider,
			organizationId: input.organizationId ?? null,
			externalId: input.externalId ?? null,
			headers: input.headers ?? null,
			payload: input.payload,
			signature: input.signature ?? null,
			status: "pending",
		})
		.returning();
	return row;
}

// ============================================
// Claim & Process
// ============================================

/**
 * Claim a batch of pending inbox rows for processing.
 * Uses SELECT FOR UPDATE SKIP LOCKED to allow concurrent workers.
 */
export async function claimBatch(limit: number): Promise<WebhookInboxRow[]> {
	const db = getDb();
	const rows = await db.execute<WebhookInboxRow>(sql`
		UPDATE webhook_inbox
		SET status = 'processing'
		WHERE id IN (
			SELECT id FROM webhook_inbox
			WHERE status = 'pending'
			ORDER BY received_at ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		)
		RETURNING *
	`);
	return [...rows];
}

/**
 * Mark an inbox row as successfully processed.
 */
export async function markCompleted(id: string): Promise<void> {
	const db = getDb();
	await db
		.update(webhookInbox)
		.set({
			status: "completed",
			processedAt: new Date(),
		})
		.where(eq(webhookInbox.id, id));
}

/**
 * Mark an inbox row as failed with an error message.
 */
export async function markFailed(id: string, error: string): Promise<void> {
	const db = getDb();
	await db
		.update(webhookInbox)
		.set({
			status: "failed",
			error,
			processedAt: new Date(),
		})
		.where(eq(webhookInbox.id, id));
}

// ============================================
// Garbage Collection
// ============================================

/**
 * Delete old completed/failed inbox rows beyond the retention period.
 * Prevents PostgreSQL table bloat.
 */
export async function gcOldRows(retentionDays: number): Promise<number> {
	const db = getDb();
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - retentionDays);

	const result = await db
		.delete(webhookInbox)
		.where(
			and(
				inArray(webhookInbox.status, ["completed", "failed"]),
				lt(webhookInbox.processedAt, cutoff),
			),
		)
		.returning({ id: webhookInbox.id });

	return result.length;
}
