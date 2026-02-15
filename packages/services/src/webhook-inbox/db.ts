/**
 * Webhook Inbox — Database operations for raw webhook event storage.
 *
 * The inbox decouples webhook receipt from processing:
 *   1. HTTP handler verifies signature, INSERTs row, returns 200 immediately.
 *   2. A BullMQ worker picks up the row asynchronously and processes it.
 */

import { webhookInbox } from "@proliferate/db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../db/client";

// ============================================
// Types
// ============================================

export interface InsertWebhookInboxInput {
	provider: string;
	organizationId?: string | null;
	externalId?: string | null;
	headers?: Record<string, string> | null;
	payload: Record<string, unknown>;
	signature?: string | null;
}

export interface WebhookInboxRow {
	id: string;
	organizationId: string | null;
	provider: string;
	externalId: string | null;
	headers: unknown;
	payload: unknown;
	signature: string | null;
	status: string;
	error: string | null;
	processedAt: Date | null;
	receivedAt: Date | null;
	createdAt: Date | null;
}

// ============================================
// Queries
// ============================================

/**
 * Insert a raw webhook into the inbox.
 * Returns the generated row ID for BullMQ job correlation.
 */
export async function insert(input: InsertWebhookInboxInput): Promise<string> {
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
		.returning({ id: webhookInbox.id });
	return row.id;
}

/**
 * Fetch a pending inbox row by ID.
 */
export async function findById(id: string): Promise<WebhookInboxRow | null> {
	const db = getDb();
	const row = await db.query.webhookInbox.findFirst({
		where: eq(webhookInbox.id, id),
	});
	return (row as WebhookInboxRow) ?? null;
}

/**
 * Mark an inbox row as completed.
 */
export async function markCompleted(id: string): Promise<void> {
	const db = getDb();
	await db
		.update(webhookInbox)
		.set({ status: "completed", processedAt: new Date() })
		.where(eq(webhookInbox.id, id));
}

/**
 * Mark an inbox row as failed with an error message.
 */
export async function markFailed(id: string, error: string): Promise<void> {
	const db = getDb();
	await db
		.update(webhookInbox)
		.set({ status: "failed", error, processedAt: new Date() })
		.where(eq(webhookInbox.id, id));
}

/**
 * Garbage-collect old processed inbox rows.
 * Deletes rows with status 'completed' or 'failed' that were processed more than `retentionDays` ago.
 */
export async function gc(retentionDays = 7): Promise<number> {
	const db = getDb();
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
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
