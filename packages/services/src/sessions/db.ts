/**
 * Sessions DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import type { ClientSource } from "@proliferate/shared";
import {
	type InferSelectModel,
	and,
	desc,
	eq,
	getDb,
	isNull,
	ne,
	type repos,
	sessionConnections,
	sessions,
	sql,
} from "../db/client";
import type {
	CreateSessionInput,
	CreateSetupSessionInput,
	ListSessionsFilters,
	UpdateSessionInput,
} from "../types/sessions";

// ============================================
// Types
// ============================================

/** Session row type from Drizzle schema */
export type SessionRow = InferSelectModel<typeof sessions>;

/** Repo row type from Drizzle schema (for relations) */
export type RepoRow = InferSelectModel<typeof repos>;

/** Automation summary for session list responses */
export type AutomationSummary = { id: string; name: string };

/** Session with repo relation */
export type SessionWithRepoRow = SessionRow & {
	repo: RepoRow | null;
	automation?: AutomationSummary | null;
};

// ============================================
// Queries
// ============================================

/**
 * List sessions for an organization with optional filters.
 */
export async function listByOrganization(
	orgId: string,
	filters?: ListSessionsFilters,
): Promise<SessionWithRepoRow[]> {
	const db = getDb();

	// Build where conditions
	const conditions = [eq(sessions.organizationId, orgId)];

	if (filters?.repoId) {
		conditions.push(eq(sessions.repoId, filters.repoId));
	}

	if (filters?.status) {
		conditions.push(eq(sessions.status, filters.status));
	}

	if (filters?.excludeSetup) {
		conditions.push(ne(sessions.sessionType, "setup"));
	}

	if (filters?.excludeCli) {
		conditions.push(ne(sessions.origin, "cli"));
	}

	if (filters?.excludeAutomation) {
		conditions.push(isNull(sessions.automationId));
	}

	if (filters?.createdBy) {
		conditions.push(eq(sessions.createdBy, filters.createdBy));
	}

	const results = await db.query.sessions.findMany({
		where: and(...conditions),
		with: {
			repo: true,
			automation: {
				columns: { id: true, name: true },
			},
		},
		orderBy: [
			sql`CASE WHEN ${sessions.status} IN ('starting', 'running', 'paused') THEN 0 ELSE 1 END`,
			desc(sessions.lastActivityAt),
		],
		...(filters?.limit ? { limit: filters.limit } : {}),
	});

	return results;
}

/**
 * Get a single session by ID with repo.
 */
export async function findById(id: string, orgId: string): Promise<SessionWithRepoRow | null> {
	const db = getDb();
	const result = await db.query.sessions.findFirst({
		where: and(eq(sessions.id, id), eq(sessions.organizationId, orgId)),
		with: {
			repo: true,
			automation: {
				columns: { id: true, name: true },
			},
		},
	});

	return result ?? null;
}

/**
 * Get session by ID without org check (for status endpoint).
 */
export async function findByIdNoOrg(id: string): Promise<Pick<SessionRow, "id" | "status"> | null> {
	const db = getDb();
	const result = await db.query.sessions.findFirst({
		where: eq(sessions.id, id),
		columns: {
			id: true,
			status: true,
		},
	});

	return result ?? null;
}

/**
 * Create a new session.
 */
export async function create(input: CreateSessionInput): Promise<SessionRow> {
	const db = getDb();
	const [result] = await db
		.insert(sessions)
		.values({
			id: input.id,
			configurationId: input.configurationId,
			organizationId: input.organizationId,
			sessionType: input.sessionType,
			status: input.status,
			sandboxProvider: input.sandboxProvider,
			createdBy: input.createdBy ?? null,
			snapshotId: input.snapshotId ?? null,
			initialPrompt: input.initialPrompt,
			title: input.title,
			clientType: input.clientType,
			clientMetadata: input.clientMetadata,
			agentConfig: input.agentConfig,
			localPathHash: input.localPathHash,
			origin: input.origin,
			automationId: input.automationId ?? null,
			triggerId: input.triggerId ?? null,
			triggerEventId: input.triggerEventId ?? null,
		})
		.returning();

	return result;
}

/**
 * Atomic concurrent admission guard for session creation.
 *
 * Uses pg_advisory_xact_lock to serialize admission per org so that
 * parallel creates cannot exceed the concurrent session limit (TOCTOU-safe).
 *
 * Lock scope: transaction-scoped advisory lock keyed on org ID.
 * Released automatically when the transaction commits or rolls back.
 */
export async function createWithAdmissionGuard(
	input: CreateSessionInput,
	maxConcurrent: number,
): Promise<{ created: boolean }> {
	const db = getDb();
	return await db.transaction(async (tx) => {
		// Serialize concurrent admission per org
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId} || ':session_admit'))`,
		);

		// Count active sessions under the lock
		const [result] = await tx
			.select({ count: sql<number>`count(*)` })
			.from(sessions)
			.where(
				and(
					eq(sessions.organizationId, input.organizationId),
					sql`${sessions.status} IN ('starting', 'pending', 'running')`,
				),
			);

		if (Number(result?.count ?? 0) >= maxConcurrent) {
			return { created: false };
		}

		// Insert session within the same transaction
		await tx.insert(sessions).values({
			id: input.id,
			configurationId: input.configurationId,
			organizationId: input.organizationId,
			sessionType: input.sessionType,
			status: input.status,
			sandboxProvider: input.sandboxProvider,
			createdBy: input.createdBy ?? null,
			snapshotId: input.snapshotId ?? null,
			initialPrompt: input.initialPrompt,
			title: input.title,
			clientType: input.clientType,
			clientMetadata: input.clientMetadata,
			agentConfig: input.agentConfig,
			localPathHash: input.localPathHash,
			origin: input.origin,
			automationId: input.automationId ?? null,
			triggerId: input.triggerId ?? null,
			triggerEventId: input.triggerEventId ?? null,
		});

		return { created: true };
	});
}

/**
 * Update a session.
 */
export async function update(id: string, input: UpdateSessionInput): Promise<void> {
	const db = getDb();
	const updates: Partial<typeof sessions.$inferInsert> = {};

	if (input.status !== undefined) updates.status = input.status;
	if (input.sandboxId !== undefined) updates.sandboxId = input.sandboxId;
	if (input.snapshotId !== undefined) updates.snapshotId = input.snapshotId;
	if (input.title !== undefined) updates.title = input.title;
	if (input.openCodeTunnelUrl !== undefined) updates.openCodeTunnelUrl = input.openCodeTunnelUrl;
	if (input.previewTunnelUrl !== undefined) updates.previewTunnelUrl = input.previewTunnelUrl;
	if (input.codingAgentSessionId !== undefined)
		updates.codingAgentSessionId = input.codingAgentSessionId;
	if (input.pausedAt !== undefined)
		updates.pausedAt = input.pausedAt ? new Date(input.pausedAt) : null;
	if (input.pauseReason !== undefined) updates.pauseReason = input.pauseReason;
	if (input.sandboxExpiresAt !== undefined)
		updates.sandboxExpiresAt = input.sandboxExpiresAt ? new Date(input.sandboxExpiresAt) : null;
	if (input.automationId !== undefined) updates.automationId = input.automationId;
	if (input.triggerId !== undefined) updates.triggerId = input.triggerId;
	if (input.triggerEventId !== undefined) updates.triggerEventId = input.triggerEventId;
	if (input.latestTask !== undefined) updates.latestTask = input.latestTask;
	if (input.outcome !== undefined) updates.outcome = input.outcome;
	if (input.summary !== undefined) updates.summary = input.summary;
	if (input.prUrls !== undefined) updates.prUrls = input.prUrls;
	if (input.metrics !== undefined) updates.metrics = input.metrics;

	await db.update(sessions).set(updates).where(eq(sessions.id, id));
}

/**
 * Update session with org check.
 */
export async function updateWithOrgCheck(
	id: string,
	orgId: string,
	input: UpdateSessionInput,
): Promise<void> {
	const db = getDb();
	const updates: Partial<typeof sessions.$inferInsert> = {};

	if (input.status !== undefined) updates.status = input.status;
	if (input.sandboxId !== undefined) updates.sandboxId = input.sandboxId;
	if (input.snapshotId !== undefined) updates.snapshotId = input.snapshotId;
	if (input.title !== undefined) updates.title = input.title;
	if (input.openCodeTunnelUrl !== undefined) updates.openCodeTunnelUrl = input.openCodeTunnelUrl;
	if (input.previewTunnelUrl !== undefined) updates.previewTunnelUrl = input.previewTunnelUrl;
	if (input.codingAgentSessionId !== undefined)
		updates.codingAgentSessionId = input.codingAgentSessionId;
	if (input.pausedAt !== undefined)
		updates.pausedAt = input.pausedAt ? new Date(input.pausedAt) : null;
	if (input.pauseReason !== undefined) updates.pauseReason = input.pauseReason;
	if (input.latestTask !== undefined) updates.latestTask = input.latestTask;
	if (input.outcome !== undefined) updates.outcome = input.outcome;
	if (input.summary !== undefined) updates.summary = input.summary;
	if (input.prUrls !== undefined) updates.prUrls = input.prUrls;
	if (input.metrics !== undefined) updates.metrics = input.metrics;

	await db
		.update(sessions)
		.set(updates)
		.where(and(eq(sessions.id, id), eq(sessions.organizationId, orgId)));
}

/**
 * CAS/fencing update: only applies if sandbox_id still matches expectedSandboxId.
 * Returns the number of rows affected (0 = another actor already advanced state).
 */
export async function updateWhereSandboxIdMatches(
	id: string,
	expectedSandboxId: string,
	input: UpdateSessionInput,
): Promise<number> {
	const db = getDb();
	const updates: Partial<typeof sessions.$inferInsert> = {};

	if (input.status !== undefined) updates.status = input.status;
	if (input.sandboxId !== undefined) updates.sandboxId = input.sandboxId;
	if (input.snapshotId !== undefined) updates.snapshotId = input.snapshotId;
	if (input.pausedAt !== undefined)
		updates.pausedAt = input.pausedAt ? new Date(input.pausedAt) : null;
	if (input.pauseReason !== undefined) updates.pauseReason = input.pauseReason;
	if (input.latestTask !== undefined) updates.latestTask = input.latestTask;

	const rows = await db
		.update(sessions)
		.set(updates)
		.where(and(eq(sessions.id, id), eq(sessions.sandboxId, expectedSandboxId)))
		.returning({ id: sessions.id });

	return rows.length;
}

/**
 * Delete a session.
 */
export async function deleteById(id: string, orgId: string): Promise<void> {
	const db = getDb();
	await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.organizationId, orgId)));
}

/**
 * Get full session row for internal operations (pause/resume).
 */
export async function findFullById(id: string, orgId: string): Promise<SessionRow | null> {
	const db = getDb();
	const result = await db.query.sessions.findFirst({
		where: and(eq(sessions.id, id), eq(sessions.organizationId, orgId)),
	});

	return result ?? null;
}

/**
 * Get session by ID (no org check, for internal use like finalize).
 */
export async function findByIdInternal(id: string): Promise<SessionRow | null> {
	const db = getDb();
	const result = await db.query.sessions.findFirst({
		where: eq(sessions.id, id),
	});

	return result ?? null;
}

/**
 * Update session configuration_id.
 */
export async function updateConfigurationId(
	sessionId: string,
	configurationId: string,
): Promise<void> {
	const db = getDb();
	await db.update(sessions).set({ configurationId }).where(eq(sessions.id, sessionId));
}

/**
 * Mark session as stopped with ended_at timestamp.
 */
export async function markStopped(sessionId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({
			status: "stopped",
			endedAt: new Date(),
			latestTask: null,
		})
		.where(eq(sessions.id, sessionId));
}

/**
 * Flush telemetry counters to DB using SQL-level increments.
 * Builds dynamic SET clauses to avoid MVCC churn on unchanged columns.
 */
export async function flushTelemetry(
	sessionId: string,
	delta: { toolCalls: number; messagesExchanged: number; activeSeconds: number },
	newPrUrls: string[],
	latestTask: string | null,
): Promise<void> {
	const db = getDb();

	const hasDelta = delta.toolCalls > 0 || delta.messagesExchanged > 0 || delta.activeSeconds > 0;
	const hasPrUrls = newPrUrls.length > 0;

	// Build dynamic SET clauses
	const setClauses: ReturnType<typeof sql>[] = [];

	if (hasDelta) {
		setClauses.push(
			sql`metrics = jsonb_build_object(
				'toolCalls', COALESCE((${sessions.metrics}->>'toolCalls')::int, 0) + ${delta.toolCalls},
				'messagesExchanged', COALESCE((${sessions.metrics}->>'messagesExchanged')::int, 0) + ${delta.messagesExchanged},
				'activeSeconds', COALESCE((${sessions.metrics}->>'activeSeconds')::int, 0) + ${delta.activeSeconds}
			)`,
		);
	}

	if (hasPrUrls) {
		const urlsJson = JSON.stringify(newPrUrls);
		setClauses.push(
			sql`pr_urls = (
				SELECT COALESCE(jsonb_agg(DISTINCT val), '[]'::jsonb)
				FROM jsonb_array_elements(COALESCE(${sessions.prUrls}, '[]'::jsonb) || ${urlsJson}::jsonb) AS val
			)`,
		);
	}

	// Always set latest_task with dirty check
	setClauses.push(
		sql`latest_task = CASE
			WHEN ${sessions.latestTask} IS DISTINCT FROM ${latestTask}
			THEN ${latestTask}
			ELSE ${sessions.latestTask}
		END`,
	);

	if (setClauses.length === 0) return;

	const setClause = sql.join(setClauses, sql.raw(", "));
	await db.execute(sql`UPDATE sessions SET ${setClause} WHERE id = ${sessionId}`);
}

/**
 * Create a setup session for a managed configuration.
 */
export async function createSetupSession(input: CreateSetupSessionInput): Promise<void> {
	const db = getDb();
	await db.insert(sessions).values({
		id: input.id,
		configurationId: input.configurationId,
		organizationId: input.organizationId,
		sessionType: "setup",
		status: "starting",
		initialPrompt: input.initialPrompt,
		source: "managed-configuration",
	});
}

/**
 * Atomic concurrent admission guard for setup session creation.
 * Same advisory lock pattern as createWithAdmissionGuard.
 */
export async function createSetupSessionWithAdmissionGuard(
	input: CreateSetupSessionInput,
	maxConcurrent: number,
): Promise<{ created: boolean }> {
	const db = getDb();
	return await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId} || ':session_admit'))`,
		);

		const [result] = await tx
			.select({ count: sql<number>`count(*)` })
			.from(sessions)
			.where(
				and(
					eq(sessions.organizationId, input.organizationId),
					sql`${sessions.status} IN ('starting', 'pending', 'running')`,
				),
			);

		if (Number(result?.count ?? 0) >= maxConcurrent) {
			return { created: false };
		}

		await tx.insert(sessions).values({
			id: input.id,
			configurationId: input.configurationId,
			organizationId: input.organizationId,
			sessionType: "setup",
			status: "starting",
			initialPrompt: input.initialPrompt,
			source: "managed-configuration",
		});

		return { created: true };
	});
}

// ============================================
// Async Client Queries (Slack, etc.)
// ============================================

/**
 * Find session by Slack thread metadata.
 * Used by SlackClient.processInbound() to find existing session for a thread.
 */
export async function findBySlackThread(
	installationId: string,
	channelId: string,
	threadTs: string,
): Promise<Pick<SessionRow, "id" | "status"> | null> {
	const db = getDb();
	const result = await db.query.sessions.findFirst({
		where: and(
			eq(sessions.clientType, "slack"),
			sql`${sessions.clientMetadata}->>'installationId' = ${installationId}`,
			sql`${sessions.clientMetadata}->>'channelId' = ${channelId}`,
			sql`${sessions.clientMetadata}->>'threadTs' = ${threadTs}`,
		),
		columns: {
			id: true,
			status: true,
		},
	});

	return result ?? null;
}

/**
 * Get session client info by ID.
 * Used by SessionSubscriber to wake async clients.
 */
export async function getSessionClientInfo(
	sessionId: string,
): Promise<{ clientType: ClientSource | null; clientMetadata: unknown } | null> {
	const db = getDb();
	const result = await db.query.sessions.findFirst({
		where: eq(sessions.id, sessionId),
		columns: {
			clientType: true,
			clientMetadata: true,
		},
	});

	if (!result) return null;

	return {
		clientType: result.clientType as ClientSource | null,
		clientMetadata: result.clientMetadata,
	};
}

/**
 * Count running sessions for an organization.
 */
export async function countRunningByOrganization(orgId: string): Promise<number> {
	const db = getDb();
	const [result] = await db
		.select({ count: sql<number>`count(*)` })
		.from(sessions)
		.where(and(eq(sessions.organizationId, orgId), eq(sessions.status, "running")));

	return Number(result?.count ?? 0);
}

/**
 * List all session IDs with status = 'running'.
 * Used by the orphan sweeper to find sessions that may have lost their gateway.
 */
export async function listRunningSessionIds(): Promise<string[]> {
	const db = getDb();
	const rows = await db
		.select({ id: sessions.id })
		.from(sessions)
		.where(eq(sessions.status, "running"));
	return rows.map((r) => r.id);
}

/**
 * Get session counts by status for an organization.
 * Returns counts for running and paused sessions.
 */
export async function getSessionCountsByOrganization(
	orgId: string,
): Promise<{ running: number; paused: number }> {
	const db = getDb();
	const results = await db
		.select({
			status: sessions.status,
			count: sql<number>`count(*)`,
		})
		.from(sessions)
		.where(eq(sessions.organizationId, orgId))
		.groupBy(sessions.status);

	let running = 0;
	let paused = 0;

	for (const row of results) {
		if (row.status === "running") {
			running = Number(row.count);
		} else if (row.status === "paused") {
			paused = Number(row.count);
		}
	}

	return { running, paused };
}

/**
 * Count paused sessions with null pause_reason (should be zero after backfill).
 */
export async function countNullPauseReasonSessions(): Promise<number> {
	const db = getDb();
	const [result] = await db
		.select({ count: sql<number>`count(*)` })
		.from(sessions)
		.where(and(eq(sessions.status, "paused"), isNull(sessions.pauseReason)));

	return Number(result?.count ?? 0);
}

// ============================================
// Blocked Summary (Inbox)
// ============================================

/** Preview session for blocked summary groups. */
export interface BlockedPreviewSessionRow {
	id: string;
	title: string | null;
	initialPrompt: string | null;
	startedAt: Date | null;
	pausedAt: Date | null;
}

/** Blocked sessions grouped by reason. */
export interface BlockedGroupRow {
	reason: string;
	count: number;
	previewSessions: BlockedPreviewSessionRow[];
}

/**
 * Get billing-blocked sessions grouped by reason with top-3 preview sessions.
 */
export async function getBlockedSummary(orgId: string): Promise<BlockedGroupRow[]> {
	const db = getDb();

	const rows = await db.execute<{
		block_reason: string;
		count: number;
		id: string | null;
		title: string | null;
		initial_prompt: string | null;
		started_at: string | null;
		paused_at: string | null;
	}>(sql`
		WITH blocked AS (
			SELECT
				id, title, initial_prompt, started_at, paused_at,
				COALESCE(pause_reason, status) AS block_reason,
				ROW_NUMBER() OVER (
					PARTITION BY COALESCE(pause_reason, status)
					ORDER BY COALESCE(paused_at, started_at) DESC
				) AS rn
			FROM sessions
			WHERE organization_id = ${orgId}
				AND (
					(status = 'paused' AND pause_reason IN ('credit_limit', 'payment_failed', 'overage_cap', 'suspended'))
					OR status = 'suspended'
				)
		),
		counts AS (
			SELECT block_reason, COUNT(*)::int AS count
			FROM blocked
			GROUP BY block_reason
		)
		SELECT c.block_reason, c.count, b.id, b.title, b.initial_prompt, b.started_at, b.paused_at
		FROM counts c
		LEFT JOIN blocked b ON b.block_reason = c.block_reason AND b.rn <= 3
		ORDER BY c.count DESC, b.rn ASC
	`);

	return groupBlockedRows(rows);
}

/** Flat row shape returned by the blocked-summary SQL query. */
export interface BlockedFlatRow {
	block_reason: string;
	count: number;
	id: string | null;
	title: string | null;
	initial_prompt: string | null;
	started_at: string | null;
	paused_at: string | null;
}

/**
 * Group flat SQL rows by block_reason into BlockedGroupRow[].
 * Extracted for testability — pure function, no DB dependency.
 */
export function groupBlockedRows(rows: BlockedFlatRow[]): BlockedGroupRow[] {
	const groupMap = new Map<string, BlockedGroupRow>();
	for (const row of rows) {
		let group = groupMap.get(row.block_reason);
		if (!group) {
			group = { reason: row.block_reason, count: row.count, previewSessions: [] };
			groupMap.set(row.block_reason, group);
		}
		if (row.id) {
			group.previewSessions.push({
				id: row.id,
				title: row.title,
				initialPrompt: row.initial_prompt,
				startedAt: row.started_at ? new Date(row.started_at) : null,
				pausedAt: row.paused_at ? new Date(row.paused_at) : null,
			});
		}
	}
	return [...groupMap.values()];
}

// ============================================
// Session Connections (Integration Tokens)
// ============================================

/** Session connection with integration detail */
export interface SessionConnectionWithIntegration {
	id: string;
	sessionId: string;
	integrationId: string;
	createdAt: Date | null;
	integration: {
		id: string;
		provider: string;
		integrationId: string;
		connectionId: string;
		displayName: string | null;
		status: string | null;
		githubInstallationId: string | null;
	} | null;
}

/**
 * Create session connections (link integrations to a session).
 */
export async function createSessionConnections(
	sessionId: string,
	integrationIds: string[],
): Promise<void> {
	if (integrationIds.length === 0) return;

	const db = getDb();
	await db.insert(sessionConnections).values(
		integrationIds.map((integrationId) => ({
			sessionId,
			integrationId,
		})),
	);
}

/**
 * List session connections with integration details.
 */
export async function listSessionConnections(
	sessionId: string,
): Promise<SessionConnectionWithIntegration[]> {
	const db = getDb();
	const results = await db.query.sessionConnections.findMany({
		where: eq(sessionConnections.sessionId, sessionId),
		with: {
			integration: {
				columns: {
					id: true,
					provider: true,
					integrationId: true,
					connectionId: true,
					displayName: true,
					status: true,
					githubInstallationId: true,
				},
			},
		},
	});

	return results as SessionConnectionWithIntegration[];
}
