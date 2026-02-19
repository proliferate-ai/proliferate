/**
 * Billing DB operations.
 *
 * Raw Drizzle queries for billing-related tables.
 * LLM spend logs are now fetched via the LiteLLM REST API (see litellm-api.ts).
 */

import { arrayContains, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
	and,
	billingEventKeys,
	billingEvents,
	desc,
	eq,
	getDb,
	gte,
	llmSpendCursors,
	organization,
	sql,
} from "../db/client";

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
// Billable Orgs
// ============================================

/**
 * List org IDs with an active billing state (active, trial, or grace).
 * These are the orgs that may accumulate LLM spend.
 */
export async function listBillableOrgIds(): Promise<string[]> {
	const db = getDb();
	const rows = await db
		.select({ id: organization.id })
		.from(organization)
		.where(inArray(organization.billingState, ["active", "trial", "grace"]));
	return rows.map((r) => r.id);
}

/**
 * List billable orgs that have an Autumn customer ID.
 * Used by the nightly reconciliation job to sync shadow balances.
 */
export async function listBillableOrgsWithCustomerId(): Promise<
	{ id: string; autumnCustomerId: string }[]
> {
	const db = getDb();
	const rows = await db
		.select({
			id: organization.id,
			autumnCustomerId: organization.autumnCustomerId,
		})
		.from(organization)
		.where(
			and(
				inArray(organization.billingState, ["active", "trial", "grace"]),
				isNotNull(organization.autumnCustomerId),
			),
		);
	return rows.map((r) => ({
		id: r.id,
		autumnCustomerId: r.autumnCustomerId!,
	}));
}

/**
 * List orgs with stale reconciliation (last_reconciled_at older than maxAgeMs).
 */
export async function listStaleReconcileOrgs(
	maxAgeMs: number,
): Promise<{ id: string; lastReconciledAt: Date | null }[]> {
	const db = getDb();
	const threshold = new Date(Date.now() - maxAgeMs);
	const rows = await db
		.select({
			id: organization.id,
			lastReconciledAt: organization.lastReconciledAt,
		})
		.from(organization)
		.where(
			and(
				isNotNull(organization.autumnCustomerId),
				inArray(organization.billingState, ["active", "trial", "grace"]),
				or(isNull(organization.lastReconciledAt), lt(organization.lastReconciledAt, threshold)),
			),
		);
	return rows;
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

// ============================================
// Partition Maintenance
// ============================================

/**
 * Try to create a billing_events partition for the given month.
 * No-op if billing_events is not partitioned or partition already exists.
 * Returns true if the partition exists or was created; false if billing_events is not partitioned.
 */
export async function ensureBillingPartition(
	partitionName: string,
	rangeStart: string,
	rangeEnd: string,
): Promise<boolean> {
	// Validate inputs to prevent SQL injection (inputs are system-generated, but defense-in-depth)
	if (!/^billing_events_\d{6}$/.test(partitionName)) {
		throw new Error(`Invalid partition name: ${partitionName}`);
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)) {
		throw new Error(`Invalid date range: ${rangeStart} to ${rangeEnd}`);
	}

	const db = getDb();
	try {
		await db.execute(
			sql.raw(
				`CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF billing_events FOR VALUES FROM ('${rangeStart}') TO ('${rangeEnd}')`,
			),
		);
		return true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("is not partitioned") || msg.includes("not a partitioned table")) {
			return false;
		}
		throw err;
	}
}

/**
 * Clean billing_event_keys older than the given cutoff date.
 * Returns the number of rows deleted.
 */
export async function cleanOldBillingEventKeys(cutoff: Date): Promise<number> {
	const db = getDb();
	const result = await db
		.delete(billingEventKeys)
		.where(lt(billingEventKeys.createdAt, cutoff))
		.returning({ key: billingEventKeys.idempotencyKey });
	return result.length;
}

/**
 * List billing_events partitions (child tables via pg_inherits).
 * Returns empty array if billing_events is not partitioned.
 */
export async function listBillingEventPartitions(): Promise<string[]> {
	const db = getDb();
	try {
		const result = await db.execute(
			sql`SELECT c.relname AS partition_name
				FROM pg_inherits i
				JOIN pg_class c ON c.oid = i.inhrelid
				JOIN pg_class p ON p.oid = i.inhparent
				WHERE p.relname = 'billing_events'
				ORDER BY c.relname`,
		);
		const rows = (result as { rows?: Array<{ partition_name: string }> }).rows ?? [];
		return rows.map((r) => r.partition_name);
	} catch {
		return [];
	}
}
