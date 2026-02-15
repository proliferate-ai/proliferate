/**
 * Billing DB operations.
 *
 * Raw Drizzle queries for billing-related tables.
 * LLM spend logs are now fetched via the LiteLLM REST API (see litellm-api.ts).
 */

import { arrayContains } from "drizzle-orm";
import { and, billingEvents, desc, eq, getDb, gte, llmSpendCursors, sql } from "../db/client";

// ============================================
// Types
// ============================================

export interface LLMSpendCursor {
	organizationId: string;
	lastStartTime: Date;
	lastRequestId: string | null;
	recordsProcessed: number;
	syncedAt: Date;
}

export interface InsertBillingEventInput {
	organizationId: string;
	eventType: "compute" | "llm";
	quantity: number;
	credits: number;
	idempotencyKey: string;
	sessionIds?: string[];
	status: "pending" | "posted" | "failed";
	metadata?: Record<string, unknown>;
}

export interface BillingEventRow {
	id: string;
	organizationId: string;
	eventType: string;
	quantity: string;
	credits: string;
	sessionIds: string[] | null;
	status: string;
	metadata: Record<string, unknown> | null;
	createdAt: Date;
}

// ============================================
// Queries
// ============================================

/**
 * Insert a billing event. Uses idempotencyKey to prevent duplicates.
 * Returns true if inserted, false if already exists.
 */
export async function insertBillingEvent(event: InsertBillingEventInput): Promise<boolean> {
	const db = getDb();
	try {
		await db.insert(billingEvents).values({
			organizationId: event.organizationId,
			eventType: event.eventType,
			quantity: event.quantity.toString(),
			credits: event.credits.toString(),
			idempotencyKey: event.idempotencyKey,
			sessionIds: event.sessionIds || [],
			status: event.status,
			metadata: event.metadata || {},
		});
		return true;
	} catch (error) {
		// Check for unique constraint violation (duplicate idempotency key)
		if (error instanceof Error && error.message.includes("unique constraint")) {
			return false;
		}
		throw error;
	}
}

/**
 * List posted billing events since a given date.
 */
export async function listPostedEventsSince(
	orgId: string,
	since: Date,
): Promise<Array<Pick<BillingEventRow, "eventType" | "credits">>> {
	const db = getDb();
	const rows = await db
		.select({
			eventType: billingEvents.eventType,
			credits: billingEvents.credits,
		})
		.from(billingEvents)
		.where(
			and(
				eq(billingEvents.organizationId, orgId),
				eq(billingEvents.status, "posted"),
				gte(billingEvents.createdAt, since),
			),
		);

	return rows;
}

export interface ListBillingEventsOptions {
	orgId: string;
	limit: number;
	offset: number;
	status?: string;
	eventType?: string;
	sessionId?: string;
}

/**
 * List billing events for an org with optional filters and pagination.
 */
export async function listBillingEvents(options: ListBillingEventsOptions): Promise<{
	events: BillingEventRow[];
	total: number;
}> {
	const db = getDb();
	const conditions = [eq(billingEvents.organizationId, options.orgId)];

	if (options.status) {
		conditions.push(eq(billingEvents.status, options.status));
	}
	if (options.eventType) {
		conditions.push(eq(billingEvents.eventType, options.eventType));
	}
	if (options.sessionId) {
		conditions.push(arrayContains(billingEvents.sessionIds, [options.sessionId]));
	}

	const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

	const events = (await db
		.select({
			id: billingEvents.id,
			organizationId: billingEvents.organizationId,
			eventType: billingEvents.eventType,
			quantity: billingEvents.quantity,
			credits: billingEvents.credits,
			sessionIds: billingEvents.sessionIds,
			status: billingEvents.status,
			metadata: billingEvents.metadata,
			createdAt: billingEvents.createdAt,
		})
		.from(billingEvents)
		.where(whereClause)
		.orderBy(desc(billingEvents.createdAt))
		.limit(options.limit)
		.offset(options.offset)) as BillingEventRow[];

	const [countRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(billingEvents)
		.where(whereClause);

	return {
		events,
		total: Number(countRow?.count ?? 0),
	};
}

// ============================================
// Per-Org LLM Spend Cursors
// ============================================

/**
 * Get the LLM spend cursor for a specific org.
 * Returns null if no cursor exists (first run for this org).
 */
export async function getLLMSpendCursor(organizationId: string): Promise<LLMSpendCursor | null> {
	const db = getDb();
	const [cursor] = await db
		.select()
		.from(llmSpendCursors)
		.where(eq(llmSpendCursors.organizationId, organizationId));

	if (!cursor) {
		return null;
	}

	return {
		organizationId,
		lastStartTime: cursor.lastStartTime,
		lastRequestId: cursor.lastRequestId,
		recordsProcessed: cursor.recordsProcessed,
		syncedAt: cursor.syncedAt,
	};
}

/**
 * Update the LLM spend cursor for a specific org.
 * Uses upsert to handle first run.
 */
export async function updateLLMSpendCursor(cursor: LLMSpendCursor): Promise<void> {
	const db = getDb();
	await db
		.insert(llmSpendCursors)
		.values({
			organizationId: cursor.organizationId,
			lastStartTime: cursor.lastStartTime,
			lastRequestId: cursor.lastRequestId,
			recordsProcessed: cursor.recordsProcessed,
			syncedAt: cursor.syncedAt,
		})
		.onConflictDoUpdate({
			target: llmSpendCursors.organizationId,
			set: {
				lastStartTime: cursor.lastStartTime,
				lastRequestId: cursor.lastRequestId,
				recordsProcessed: cursor.recordsProcessed,
				syncedAt: cursor.syncedAt,
			},
		});
}
