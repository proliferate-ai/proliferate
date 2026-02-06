/**
 * Billing DB operations.
 *
 * Raw Drizzle queries for billing-related tables.
 * Note: LiteLLM_SpendLogs is read via raw SQL as it's managed by LiteLLM proxy.
 */

import { METERING_CONFIG } from "@proliferate/shared/billing";
import { arrayContains } from "drizzle-orm";
import { and, billingEvents, desc, eq, getDb, gte, llmSpendCursors, sql } from "../db/client";

const DEFAULT_LITELLM_SCHEMA = "litellm";
const LITELLM_SPEND_LOGS_TABLE = "LiteLLM_SpendLogs";

function assertValidPgIdentifier(value: string, envName: string): void {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
		throw new Error(`${envName} must be a valid Postgres identifier (got "${value}")`);
	}
}

const LITELLM_SPEND_LOGS_REF = (() => {
	const schema = (process.env.LITELLM_DB_SCHEMA || DEFAULT_LITELLM_SCHEMA).trim();
	assertValidPgIdentifier(schema, "LITELLM_DB_SCHEMA");
	return sql`${sql.identifier(schema)}.${sql.identifier(LITELLM_SPEND_LOGS_TABLE)}`;
})();

// ============================================
// Types
// ============================================

export interface LLMSpendLog {
	request_id: string;
	team_id: string | null; // our org_id (from JWT tenant_id)
	user: string | null; // our session_id (from JWT sub)
	spend: number; // cost in USD
	model: string;
	model_group: string | null;
	total_tokens: number;
	prompt_tokens: number;
	completion_tokens: number;
	// Raw start time from LiteLLM logs (timestamp)
	startTime?: Date | string;
}

export interface LLMSpendCursor {
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
 * Get unprocessed LLM spend logs from LiteLLM_SpendLogs.
 * Uses raw SQL as this table is managed by LiteLLM proxy.
 * Returns logs from the specified time that have a team_id (org).
 */
export async function getUnprocessedLLMSpendLogs(since: Date, limit = 100): Promise<LLMSpendLog[]> {
	const db = getDb();
	const result = await db.execute(sql`
		SELECT
			request_id,
			team_id,
			"user",
			spend,
			model,
			model_group,
			total_tokens,
			prompt_tokens,
			completion_tokens
		FROM ${LITELLM_SPEND_LOGS_REF}
		WHERE "startTime" >= ${since.toISOString()}
		AND team_id IS NOT NULL
		ORDER BY "startTime" ASC
		LIMIT ${limit}
	`);

	return result as unknown as LLMSpendLog[];
}

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
// Cursor-based LLM Spend Sync (V2)
// ============================================

/**
 * Get the current LLM spend cursor.
 * Returns null if no cursor exists (first run).
 */
export async function getLLMSpendCursor(): Promise<LLMSpendCursor | null> {
	const db = getDb();
	const [cursor] = await db.select().from(llmSpendCursors).where(eq(llmSpendCursors.id, "global"));

	if (!cursor) {
		return null;
	}

	return {
		lastStartTime: cursor.lastStartTime,
		lastRequestId: cursor.lastRequestId,
		recordsProcessed: cursor.recordsProcessed,
		syncedAt: cursor.syncedAt,
	};
}

/**
 * Update the LLM spend cursor.
 * Uses upsert to handle first run.
 */
export async function updateLLMSpendCursor(cursor: LLMSpendCursor): Promise<void> {
	const db = getDb();
	await db
		.insert(llmSpendCursors)
		.values({
			id: "global",
			lastStartTime: cursor.lastStartTime,
			lastRequestId: cursor.lastRequestId,
			recordsProcessed: cursor.recordsProcessed,
			syncedAt: cursor.syncedAt,
		})
		.onConflictDoUpdate({
			target: llmSpendCursors.id,
			set: {
				lastStartTime: cursor.lastStartTime,
				lastRequestId: cursor.lastRequestId,
				recordsProcessed: cursor.recordsProcessed,
				syncedAt: cursor.syncedAt,
			},
		});
}

/**
 * Get the earliest LLM spend log start time.
 * Used for full backfill bootstrap when cursor is missing.
 */
export async function getLLMSpendMinStartTime(): Promise<Date | null> {
	const db = getDb();
	const result = (await db.execute(sql`
		SELECT MIN("startTime") AS min_start
		FROM ${LITELLM_SPEND_LOGS_REF}
		WHERE team_id IS NOT NULL
	`)) as unknown as Array<{ min_start: Date | string | null }>;

	const minStart = result[0]?.min_start;
	if (!minStart) return null;
	return minStart instanceof Date ? minStart : new Date(minStart);
}

/**
 * Get LLM spend logs using cursor-based pagination.
 * Returns logs after the cursor position, ordered by startTime and request_id.
 *
 * @param cursor - Current cursor position (null for first run with lookback)
 * @param batchSize - Number of records to fetch
 * @returns Array of spend logs
 */
export async function getLLMSpendLogsByCursor(
	cursor: LLMSpendCursor | null,
	batchSize: number = METERING_CONFIG.llmSyncBatchSize,
): Promise<LLMSpendLog[]> {
	const db = getDb();

	// If no cursor, start from lookback window
	const lookbackTime =
		cursor?.lastStartTime ?? new Date(Date.now() - METERING_CONFIG.llmSyncBootstrapLookbackMs);
	const lastRequestId = cursor?.lastRequestId;

	// Query with cursor-based pagination
	// Order by startTime, then request_id for deterministic ordering
	let result: LLMSpendLog[];

	if (lastRequestId) {
		// Have both timestamp and request_id - skip records at same timestamp with lower request_id
		result = (await db.execute(sql`
			SELECT
				request_id,
				team_id,
				"user",
				spend,
				model,
				model_group,
				total_tokens,
				prompt_tokens,
				completion_tokens,
				"startTime"
			FROM ${LITELLM_SPEND_LOGS_REF}
			WHERE team_id IS NOT NULL
			AND (
				"startTime" > ${lookbackTime.toISOString()}
				OR ("startTime" = ${lookbackTime.toISOString()} AND request_id > ${lastRequestId})
			)
			ORDER BY "startTime" ASC, request_id ASC
			LIMIT ${batchSize}
		`)) as unknown as LLMSpendLog[];
	} else {
		// Only have timestamp - get all records at or after that time
		result = (await db.execute(sql`
			SELECT
				request_id,
				team_id,
				"user",
				spend,
				model,
				model_group,
				total_tokens,
				prompt_tokens,
				completion_tokens,
				"startTime"
			FROM ${LITELLM_SPEND_LOGS_REF}
			WHERE team_id IS NOT NULL
			AND "startTime" >= ${lookbackTime.toISOString()}
			ORDER BY "startTime" ASC, request_id ASC
			LIMIT ${batchSize}
		`)) as unknown as LLMSpendLog[];
	}

	return result;
}

/**
 * Get LLM spend logs from a lookback window (for late-arriving logs).
 * This does NOT advance the cursor (idempotency handles duplicates).
 */
export async function getLLMSpendLogsLookback(
	lookbackMs: number = METERING_CONFIG.llmSyncLookbackMs,
	batchSize: number = METERING_CONFIG.llmSyncBatchSize,
): Promise<LLMSpendLog[]> {
	const db = getDb();
	const lookbackTime = new Date(Date.now() - lookbackMs);

	const result = (await db.execute(sql`
		SELECT
			request_id,
			team_id,
			"user",
			spend,
			model,
			model_group,
			total_tokens,
			prompt_tokens,
			completion_tokens,
			"startTime"
		FROM ${LITELLM_SPEND_LOGS_REF}
		WHERE team_id IS NOT NULL
		AND "startTime" >= ${lookbackTime.toISOString()}
		ORDER BY "startTime" ASC, request_id ASC
		LIMIT ${batchSize}
	`)) as unknown as LLMSpendLog[];

	return result;
}

/**
 * Get the new cursor position from processed logs.
 * Returns null if no logs were processed.
 */
export function getNewCursorFromLogs(
	logs: LLMSpendLog[],
	previousCursor: LLMSpendCursor | null,
): LLMSpendCursor | null {
	if (logs.length === 0) {
		return previousCursor;
	}

	const lastLog = logs[logs.length - 1];
	const lastStartTime =
		lastLog.startTime instanceof Date
			? lastLog.startTime
			: lastLog.startTime
				? new Date(lastLog.startTime)
				: new Date();

	return {
		lastStartTime,
		lastRequestId: lastLog.request_id,
		recordsProcessed: (previousCursor?.recordsProcessed ?? 0) + logs.length,
		syncedAt: new Date(),
	};
}
