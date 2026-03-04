/**
 * Webhook Inbox service.
 *
 * Thin service wrappers over DB operations for the async webhook inbox pattern.
 */

import * as webhookInboxDb from "./db";

export type { WebhookInboxRow, InsertInboxRowInput } from "./db";

/**
 * Insert a raw webhook payload into the inbox for async processing.
 */
export async function insertInboxRow(input: webhookInboxDb.InsertInboxRowInput) {
	return webhookInboxDb.insertInboxRow(input);
}

/**
 * Claim a batch of pending inbox rows for processing.
 */
export async function claimBatch(limit: number) {
	return webhookInboxDb.claimBatch(limit);
}

/**
 * Mark an inbox row as successfully processed.
 */
export async function markCompleted(id: string) {
	return webhookInboxDb.markCompleted(id);
}

/**
 * Mark an inbox row as failed with an error message.
 */
export async function markFailed(id: string, error: string) {
	return webhookInboxDb.markFailed(id, error);
}

/**
 * Delete old completed/failed inbox rows beyond the retention period.
 */
export async function gcOldRows(retentionDays: number) {
	return webhookInboxDb.gcOldRows(retentionDays);
}
