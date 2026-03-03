/**
 * Sessions DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import type { ClientSource } from "@proliferate/shared";
import type {
	SessionMessageDeliveryState,
	SessionMessageDirection,
} from "@proliferate/shared/contracts";
import {
	type InferSelectModel,
	actionInvocations,
	and,
	asc,
	desc,
	eq,
	getDb,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	or,
	type repos,
	sessionAcl,
	sessionCapabilities,
	sessionConnections,
	sessionEvents,
	sessionMessages,
	sessionSkills,
	sessionUserState,
	sessions,
	sql,
	workers,
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

export type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Session row type from Drizzle schema */
export type SessionRow = InferSelectModel<typeof sessions>;

/** Repo row type from Drizzle schema (for relations) */
export type RepoRow = InferSelectModel<typeof repos>;

/** Automation/configuration summary for session list responses */
export type AutomationSummary = { id: string; name: string };
export type ConfigurationSummary = { id: string; name: string };

/** Session with repo relation */
export type SessionWithRepoRow = SessionRow & {
	repo: RepoRow | null;
	automation?: AutomationSummary | null;
	configuration?: ConfigurationSummary | null;
};

/** Enriched session row with unread, worker name, and pending approval count */
export type EnrichedSessionRow = SessionWithRepoRow & {
	workerName: string | null;
	isUnread: boolean;
	pendingApprovalCount: number;
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

	if (filters?.kinds && filters.kinds.length > 0) {
		conditions.push(inArray(sessions.kind, filters.kinds));
	}

	if (filters?.excludeSetup) {
		// Use or(ne, isNull) because NULL <> 'setup' evaluates to NULL in SQL
		conditions.push(or(ne(sessions.sessionType, "setup"), isNull(sessions.sessionType))!);
	}

	if (filters?.excludeAutomation) {
		conditions.push(isNull(sessions.automationId));
	}

	if (filters?.createdBy) {
		conditions.push(eq(sessions.createdBy, filters.createdBy));
	}

	// K6: Exclude soft-deleted sessions
	conditions.push(isNull(sessions.deletedAt));

	// K6: Exclude archived sessions by default
	if (!filters?.includeArchived) {
		conditions.push(isNull(sessions.archivedAt));
	}

	// K2: Visibility + ACL filtering
	if (filters?.userId) {
		// Show sessions where: user is creator, OR visibility is 'org', OR user has explicit ACL
		conditions.push(
			or(
				eq(sessions.createdBy, filters.userId),
				eq(sessions.visibility, "org"),
				sql`EXISTS (SELECT 1 FROM session_acl WHERE session_acl.session_id = ${sessions.id} AND session_acl.user_id = ${filters.userId})`,
			)!,
		);
	}

	const results = await db.query.sessions.findMany({
		where: and(...conditions),
		with: {
			repo: true,
			automation: {
				columns: { id: true, name: true },
			},
			configuration: {
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
 * List sessions for an organization with enrichment data (unread, worker name, pending approvals).
 *
 * Enrichments:
 * 1. Left-join sessionUserState to compute isUnread
 * 2. Left-join workers to get worker name
 * 3. Subquery count of pending action_invocations per session
 * 4. Optional operator status priority sorting
 */
export async function listByOrganizationEnriched(
	orgId: string,
	userId: string,
	filters?: ListSessionsFilters,
): Promise<EnrichedSessionRow[]> {
	const db = getDb();

	// Build where conditions (same as listByOrganization)
	const conditions = [eq(sessions.organizationId, orgId)];

	if (filters?.repoId) {
		conditions.push(eq(sessions.repoId, filters.repoId));
	}

	if (filters?.status) {
		conditions.push(eq(sessions.status, filters.status));
	}

	if (filters?.kinds && filters.kinds.length > 0) {
		const kindConditions = [inArray(sessions.kind, filters.kinds)];
		if (filters.kinds.includes("task")) {
			kindConditions.push(isNull(sessions.kind));
		}
		conditions.push(or(...kindConditions)!);
	}

	if (filters?.excludeSetup) {
		conditions.push(or(ne(sessions.sessionType, "setup"), isNull(sessions.sessionType))!);
	}

	if (filters?.excludeAutomation) {
		conditions.push(isNull(sessions.automationId));
	}

	if (filters?.createdBy) {
		conditions.push(eq(sessions.createdBy, filters.createdBy));
	}

	// Pending approval count subquery
	const pendingApprovalCount = db
		.select({
			sessionId: actionInvocations.sessionId,
			count: sql<number>`count(*)`.as("pending_count"),
		})
		.from(actionInvocations)
		.where(eq(actionInvocations.status, "pending"))
		.groupBy(actionInvocations.sessionId)
		.as("pending_approvals");

	const rows = await db
		.select({
			session: sessions,
			workerName: workers.name,
			lastViewedAt: sessionUserState.lastViewedAt,
			pendingApprovalCount: pendingApprovalCount.count,
		})
		.from(sessions)
		.leftJoin(workers, eq(sessions.workerId, workers.id))
		.leftJoin(
			sessionUserState,
			and(eq(sessionUserState.sessionId, sessions.id), eq(sessionUserState.userId, userId)),
		)
		.leftJoin(pendingApprovalCount, eq(pendingApprovalCount.sessionId, sessions.id))
		.where(and(...conditions))
		.orderBy(
			// Operator status priority: waiting_for_approval/needs_input first, then running, then failed, then others
			sql`CASE
				WHEN ${sessions.operatorStatus} IN ('waiting_for_approval', 'needs_input') THEN 0
				WHEN ${sessions.status} IN ('starting', 'running') THEN 1
				WHEN ${sessions.operatorStatus} = 'errored' THEN 2
				WHEN ${sessions.status} IN ('paused') THEN 3
				ELSE 4
			END`,
			desc(sessions.lastActivityAt),
		)
		.limit(filters?.limit ?? 50);

	// Fetch repos, automations, and configurations for the result set
	const sessionIds = rows.map((r) => r.session.id);
	if (sessionIds.length === 0) return [];

	// Use the relational query to get repos/automations/configurations
	const sessionsWithRelations = await db.query.sessions.findMany({
		where: inArray(sessions.id, sessionIds),
		with: {
			repo: true,
			automation: {
				columns: { id: true, name: true },
			},
			configuration: {
				columns: { id: true, name: true },
			},
		},
	});

	const relationsMap = new Map(sessionsWithRelations.map((s) => [s.id, s]));

	return rows.map((row) => {
		const relations = relationsMap.get(row.session.id);
		const isUnread =
			row.session.lastVisibleUpdateAt != null &&
			(row.lastViewedAt == null || row.session.lastVisibleUpdateAt > row.lastViewedAt);

		return {
			...row.session,
			repo: relations?.repo ?? null,
			automation: relations?.automation ?? null,
			configuration: relations?.configuration ?? null,
			workerName: row.workerName ?? null,
			isUnread,
			pendingApprovalCount: Number(row.pendingApprovalCount ?? 0),
		};
	});
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
			configuration: {
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
			repoId: input.repoId ?? null,
			sessionType: input.sessionType,
			status: input.status,
			sandboxProvider: input.sandboxProvider,
			createdBy: input.createdBy ?? null,
			snapshotId: input.snapshotId ?? null,
			initialPrompt: input.initialPrompt,
			title: input.title,
			titleStatus: input.titleStatus ?? null,
			clientType: input.clientType,
			clientMetadata: input.clientMetadata,
			agentConfig: input.agentConfig,
			automationId: input.automationId ?? null,
			triggerId: input.triggerId ?? null,
			triggerEventId: input.triggerEventId ?? null,
			...(input.visibility && { visibility: input.visibility }),
			...("kind" in input ? { kind: input.kind } : {}),
			continuedFromSessionId: input.continuedFromSessionId ?? null,
			rerunOfSessionId: input.rerunOfSessionId ?? null,
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
			repoId: input.repoId ?? null,
			sessionType: input.sessionType,
			status: input.status,
			sandboxProvider: input.sandboxProvider,
			createdBy: input.createdBy ?? null,
			snapshotId: input.snapshotId ?? null,
			initialPrompt: input.initialPrompt,
			title: input.title,
			titleStatus: input.titleStatus ?? null,
			clientType: input.clientType,
			clientMetadata: input.clientMetadata,
			agentConfig: input.agentConfig,
			automationId: input.automationId ?? null,
			triggerId: input.triggerId ?? null,
			triggerEventId: input.triggerEventId ?? null,
			...(input.visibility && { visibility: input.visibility }),
			...("kind" in input ? { kind: input.kind } : {}),
			continuedFromSessionId: input.continuedFromSessionId ?? null,
			rerunOfSessionId: input.rerunOfSessionId ?? null,
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
	if (input.titleStatus !== undefined) updates.titleStatus = input.titleStatus;
	if (input.initialPromptSentAt !== undefined)
		updates.initialPromptSentAt = input.initialPromptSentAt
			? new Date(input.initialPromptSentAt)
			: null;
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
	if (input.titleStatus !== undefined) updates.titleStatus = input.titleStatus;
	if (input.initialPromptSentAt !== undefined)
		updates.initialPromptSentAt = input.initialPromptSentAt
			? new Date(input.initialPromptSentAt)
			: null;
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
		visibility: "org",
		kind: "setup",
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
			visibility: "org",
			kind: "setup",
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
// Billing-Related Session Queries
// ============================================

/**
 * Find running sessions for an organization (billing/enforcement use).
 */
export async function findRunningByOrganization(
	orgId: string,
	columns: { id: true; sandboxId: true; sandboxProvider: true },
): Promise<{ id: string; sandboxId: string | null; sandboxProvider: string | null }[]>;
export async function findRunningByOrganization(
	orgId: string,
	columns: { id: true },
): Promise<{ id: string }[]>;
export async function findRunningByOrganization(
	orgId: string,
	columns: Record<string, true>,
): Promise<Record<string, unknown>[]> {
	const db = getDb();
	return db.query.sessions.findMany({
		where: and(eq(sessions.organizationId, orgId), eq(sessions.status, "running")),
		columns,
	});
}

/**
 * Find a running session by ID (re-verification during lock-safe operations).
 */
export async function findRunningById(
	sessionId: string,
): Promise<{ id: string; sandboxId: string | null } | null> {
	const db = getDb();
	const result = await db.query.sessions.findFirst({
		where: and(eq(sessions.id, sessionId), eq(sessions.status, "running")),
		columns: { id: true, sandboxId: true },
	});
	return result ?? null;
}

/**
 * Pause a single session (set status, reason, timestamp, clear task).
 */
export async function pauseSession(
	sessionId: string,
	reason: string,
	additionalWhere?: "running",
): Promise<void> {
	const db = getDb();
	const conditions = [eq(sessions.id, sessionId)];
	if (additionalWhere === "running") {
		conditions.push(eq(sessions.status, "running"));
	}
	await db
		.update(sessions)
		.set({
			status: "paused",
			pauseReason: reason,
			pausedAt: new Date(),
			latestTask: null,
		})
		.where(and(...conditions));
}

/**
 * Find a session by ID for metering finalization.
 */
export async function findForMetering(sessionId: string): Promise<{
	id: string;
	organizationId: string;
	meteredThroughAt: Date | null;
	startedAt: Date;
	status: string;
} | null> {
	const db = getDb();
	const result = await db.query.sessions.findFirst({
		where: eq(sessions.id, sessionId),
		columns: {
			id: true,
			organizationId: true,
			meteredThroughAt: true,
			startedAt: true,
			status: true,
		},
	});
	return (
		(result as
			| {
					id: string;
					organizationId: string;
					meteredThroughAt: Date | null;
					startedAt: Date;
					status: string;
			  }
			| undefined) ?? null
	);
}

/**
 * Find all running sessions with metering fields.
 */
export async function findAllRunningForMetering(): Promise<
	{
		id: string;
		organizationId: string;
		sandboxId: string | null;
		sandboxProvider: string | null;
		meteredThroughAt: Date | null;
		startedAt: Date;
		status: string;
		lastSeenAliveAt: Date | null;
		aliveCheckFailures: number | null;
	}[]
> {
	const db = getDb();
	return db.query.sessions.findMany({
		where: eq(sessions.status, "running"),
		columns: {
			id: true,
			organizationId: true,
			sandboxId: true,
			sandboxProvider: true,
			meteredThroughAt: true,
			startedAt: true,
			status: true,
			lastSeenAliveAt: true,
			aliveCheckFailures: true,
		},
	}) as Promise<
		{
			id: string;
			organizationId: string;
			sandboxId: string | null;
			sandboxProvider: string | null;
			meteredThroughAt: Date | null;
			startedAt: Date;
			status: string;
			lastSeenAliveAt: Date | null;
			aliveCheckFailures: number | null;
		}[]
	>;
}

/**
 * Update alive check fields for a session.
 */
export async function updateAliveCheck(
	sessionId: string,
	fields: { lastSeenAliveAt?: Date; aliveCheckFailures?: number },
): Promise<void> {
	const db = getDb();
	await db.update(sessions).set(fields).where(eq(sessions.id, sessionId));
}

/**
 * Advance metered_through_at for a session.
 */
export async function updateMeteredThroughAt(
	sessionId: string,
	meteredThroughAt: Date,
): Promise<void> {
	const db = getDb();
	await db.update(sessions).set({ meteredThroughAt }).where(eq(sessions.id, sessionId));
}

// ============================================
// Snapshot-Related Session Queries
// ============================================

/**
 * Count sessions with a snapshot for an organization.
 */
export async function countSnapshotsByOrganization(orgId: string): Promise<number> {
	const db = getDb();
	const [result] = await db
		.select({ count: sql<number>`count(*)` })
		.from(sessions)
		.where(and(eq(sessions.organizationId, orgId), isNotNull(sessions.snapshotId)));
	return Number(result?.count ?? 0);
}

/**
 * Find sessions with expired snapshots for an organization.
 */
export async function findExpiredSnapshots(
	orgId: string,
	cutoffDate: Date,
): Promise<
	{ id: string; snapshotId: string | null; sandboxProvider: string | null; pausedAt: Date | null }[]
> {
	const db = getDb();
	return db.query.sessions.findMany({
		where: and(
			eq(sessions.organizationId, orgId),
			isNotNull(sessions.snapshotId),
			lt(sessions.pausedAt, cutoffDate),
		),
		columns: {
			id: true,
			snapshotId: true,
			sandboxProvider: true,
			pausedAt: true,
		},
		orderBy: [asc(sessions.pausedAt)],
	}) as Promise<
		{
			id: string;
			snapshotId: string | null;
			sandboxProvider: string | null;
			pausedAt: Date | null;
		}[]
	>;
}

/**
 * Find all sessions with snapshots for an organization (oldest first, limited).
 */
export async function findSnapshotsByOrganization(
	orgId: string,
	limit: number,
): Promise<
	{ id: string; snapshotId: string | null; sandboxProvider: string | null; pausedAt: Date | null }[]
> {
	const db = getDb();
	return db.query.sessions.findMany({
		where: and(eq(sessions.organizationId, orgId), isNotNull(sessions.snapshotId)),
		columns: {
			id: true,
			snapshotId: true,
			sandboxProvider: true,
			pausedAt: true,
		},
		orderBy: [asc(sessions.pausedAt)],
		limit,
	}) as Promise<
		{
			id: string;
			snapshotId: string | null;
			sandboxProvider: string | null;
			pausedAt: Date | null;
		}[]
	>;
}

/**
 * Find all expired snapshots across all orgs (global cleanup).
 */
export async function findAllExpiredSnapshots(
	cutoffDate: Date,
	limit: number,
): Promise<
	{ id: string; snapshotId: string | null; sandboxProvider: string | null; pausedAt: Date | null }[]
> {
	const db = getDb();
	return db.query.sessions.findMany({
		where: and(isNotNull(sessions.snapshotId), lt(sessions.pausedAt, cutoffDate)),
		columns: {
			id: true,
			snapshotId: true,
			sandboxProvider: true,
			pausedAt: true,
		},
		orderBy: [asc(sessions.pausedAt)],
		limit,
	}) as Promise<
		{
			id: string;
			snapshotId: string | null;
			sandboxProvider: string | null;
			pausedAt: Date | null;
		}[]
	>;
}

/**
 * Clear snapshot reference for a session.
 */
export async function clearSnapshotId(sessionId: string): Promise<void> {
	const db = getDb();
	await db.update(sessions).set({ snapshotId: null }).where(eq(sessions.id, sessionId));
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

// ============================================
// V1 Session Support Tables
// ============================================

export type SessionCapabilityRow = InferSelectModel<typeof sessionCapabilities>;
export type SessionSkillRow = InferSelectModel<typeof sessionSkills>;
export type SessionMessageRow = InferSelectModel<typeof sessionMessages>;
export type SessionUserStateRow = InferSelectModel<typeof sessionUserState>;

export interface UpsertSessionCapabilityInput {
	sessionId: string;
	capabilityKey: string;
	mode: "allow" | "require_approval" | "deny";
	scope?: unknown;
	origin?: string;
}

export async function upsertSessionCapability(
	input: UpsertSessionCapabilityInput,
): Promise<SessionCapabilityRow> {
	const db = getDb();
	const now = new Date();

	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(sessionCapabilities)
			.values({
				sessionId: input.sessionId,
				capabilityKey: input.capabilityKey,
				mode: input.mode,
				scope: input.scope ?? null,
				origin: input.origin ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [sessionCapabilities.sessionId, sessionCapabilities.capabilityKey],
				set: {
					mode: input.mode,
					...(input.scope !== undefined && { scope: input.scope }),
					...(input.origin !== undefined && { origin: input.origin }),
					updatedAt: now,
				},
			})
			.returning();

		await tx
			.update(sessions)
			.set({ capabilitiesVersion: sql`${sessions.capabilitiesVersion} + 1` })
			.where(eq(sessions.id, input.sessionId));

		return row;
	});
}

export async function listSessionCapabilities(sessionId: string): Promise<SessionCapabilityRow[]> {
	const db = getDb();
	return db.select().from(sessionCapabilities).where(eq(sessionCapabilities.sessionId, sessionId));
}

export interface UpsertSessionSkillInput {
	sessionId: string;
	skillKey: string;
	configJson?: unknown;
	origin?: string;
}

export async function upsertSessionSkill(input: UpsertSessionSkillInput): Promise<SessionSkillRow> {
	const db = getDb();
	const now = new Date();

	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(sessionSkills)
			.values({
				sessionId: input.sessionId,
				skillKey: input.skillKey,
				configJson: input.configJson ?? null,
				origin: input.origin ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [sessionSkills.sessionId, sessionSkills.skillKey],
				set: {
					...(input.configJson !== undefined && { configJson: input.configJson }),
					...(input.origin !== undefined && { origin: input.origin }),
					updatedAt: now,
				},
			})
			.returning();

		await tx
			.update(sessions)
			.set({ capabilitiesVersion: sql`${sessions.capabilitiesVersion} + 1` })
			.where(eq(sessions.id, input.sessionId));

		return row;
	});
}

export interface EnqueueSessionMessageInput {
	sessionId: string;
	direction: SessionMessageDirection;
	messageType: string;
	payloadJson: unknown;
	dedupeKey?: string;
	deliverAfter?: Date;
	senderUserId?: string;
	senderSessionId?: string;
}

export interface FindTerminalFollowupMessageByDedupeInput {
	organizationId: string;
	sourceSessionId: string;
	dedupeKey: string;
	mode: "continuation" | "rerun";
}

export async function findTerminalFollowupMessageByDedupe(
	input: FindTerminalFollowupMessageByDedupeInput,
): Promise<{ deliverySessionId: string; sessionMessage: SessionMessageRow } | undefined> {
	const db = getDb();
	const lineageFilter =
		input.mode === "continuation"
			? eq(sessions.continuedFromSessionId, input.sourceSessionId)
			: eq(sessions.rerunOfSessionId, input.sourceSessionId);

	const [row] = await db
		.select({
			deliverySessionId: sessions.id,
			sessionMessage: sessionMessages,
		})
		.from(sessionMessages)
		.innerJoin(sessions, eq(sessionMessages.sessionId, sessions.id))
		.where(
			and(
				eq(sessions.organizationId, input.organizationId),
				eq(sessionMessages.dedupeKey, input.dedupeKey),
				eq(sessionMessages.direction, "user_to_task"),
				lineageFilter,
			),
		)
		.orderBy(asc(sessionMessages.queuedAt), asc(sessionMessages.id))
		.limit(1);

	if (!row) {
		return undefined;
	}

	return row;
}

export async function enqueueSessionMessage(
	input: EnqueueSessionMessageInput,
): Promise<SessionMessageRow> {
	const db = getDb();
	const values = {
		sessionId: input.sessionId,
		direction: input.direction,
		messageType: input.messageType,
		payloadJson: input.payloadJson,
		dedupeKey: input.dedupeKey ?? null,
		deliverAfter: input.deliverAfter ?? null,
		senderUserId: input.senderUserId ?? null,
		senderSessionId: input.senderSessionId ?? null,
	};

	const rows = input.dedupeKey
		? await db
				.insert(sessionMessages)
				.values(values)
				.onConflictDoNothing({
					target: [sessionMessages.sessionId, sessionMessages.dedupeKey],
					where: isNotNull(sessionMessages.dedupeKey),
				})
				.returning()
		: await db.insert(sessionMessages).values(values).returning();

	const inserted = rows[0];
	if (inserted) {
		return inserted;
	}

	if (!input.dedupeKey) {
		throw new Error("Failed to enqueue session message");
	}

	const [existing] = await db
		.select()
		.from(sessionMessages)
		.where(
			and(
				eq(sessionMessages.sessionId, input.sessionId),
				eq(sessionMessages.dedupeKey, input.dedupeKey),
			),
		)
		.limit(1);

	if (!existing) {
		throw new Error("Failed to resolve deduped session message");
	}

	return existing;
}

export async function listQueuedSessionMessages(sessionId: string): Promise<SessionMessageRow[]> {
	const db = getDb();
	const now = new Date();
	return db
		.select()
		.from(sessionMessages)
		.where(
			and(
				eq(sessionMessages.sessionId, sessionId),
				eq(sessionMessages.deliveryState, "queued"),
				or(isNull(sessionMessages.deliverAfter), lte(sessionMessages.deliverAfter, now)),
			),
		)
		.orderBy(sessionMessages.queuedAt);
}

export async function updateSessionMessageDeliveryState(
	id: string,
	deliveryState: SessionMessageDeliveryState,
	fields?: {
		deliveredAt?: Date | null;
		consumedAt?: Date | null;
		failedAt?: Date | null;
		failureReason?: string | null;
	},
): Promise<SessionMessageRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(sessionMessages)
		.set({
			deliveryState,
			deliveredAt: fields?.deliveredAt,
			consumedAt: fields?.consumedAt,
			failedAt: fields?.failedAt,
			failureReason: fields?.failureReason,
		})
		.where(eq(sessionMessages.id, id))
		.returning();
	return row;
}

export interface UpsertSessionUserStateInput {
	sessionId: string;
	userId: string;
	lastViewedAt?: Date | null;
	archivedAt?: Date | null;
}

export async function upsertSessionUserState(
	input: UpsertSessionUserStateInput,
): Promise<SessionUserStateRow> {
	const db = getDb();
	const now = new Date();
	const [row] = await db
		.insert(sessionUserState)
		.values({
			sessionId: input.sessionId,
			userId: input.userId,
			lastViewedAt: input.lastViewedAt ?? null,
			archivedAt: input.archivedAt ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [sessionUserState.sessionId, sessionUserState.userId],
			set: {
				...(input.lastViewedAt !== undefined && { lastViewedAt: input.lastViewedAt }),
				...(input.archivedAt !== undefined && { archivedAt: input.archivedAt }),
				updatedAt: now,
			},
		})
		.returning();
	return row;
}

export interface PersistSessionOutcomeInput {
	sessionId: string;
	outcomeJson: unknown;
	outcomeVersion?: number;
}

export async function persistSessionOutcome(input: PersistSessionOutcomeInput): Promise<{
	outcomeJson: unknown;
	outcomeVersion: number | null;
	outcomePersistedAt: Date | null;
}> {
	const db = getDb();
	const now = new Date();
	const [row] = await db
		.update(sessions)
		.set({
			outcomeJson: input.outcomeJson,
			outcomeVersion: input.outcomeVersion ?? 1,
			outcomePersistedAt: now,
		})
		.where(eq(sessions.id, input.sessionId))
		.returning({
			outcomeJson: sessions.outcomeJson,
			outcomeVersion: sessions.outcomeVersion,
			outcomePersistedAt: sessions.outcomePersistedAt,
		});
	if (!row) {
		throw new Error(`Session not found for outcome persistence: ${input.sessionId}`);
	}
	return row;
}

export async function findSessionById(
	sessionId: string,
	organizationId: string,
): Promise<SessionRow | undefined> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(sessions)
		.where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, organizationId)))
		.limit(1);
	return row;
}

export async function listChildSessionsByRun(
	parentSessionId: string,
	workerRunId: string,
	organizationId: string,
): Promise<SessionRow[]> {
	const db = getDb();
	return db
		.select()
		.from(sessions)
		.where(
			and(
				eq(sessions.parentSessionId, parentSessionId),
				eq(sessions.workerRunId, workerRunId),
				eq(sessions.organizationId, organizationId),
				eq(sessions.kind, "task"),
			),
		)
		.orderBy(asc(sessions.startedAt));
}

/**
 * List ALL child sessions for a manager, across all runs.
 * Used by the manager harness list_children tool so it can see and interact
 * with children from previous runs that are still running.
 */
export async function listAllChildSessions(
	parentSessionId: string,
	organizationId: string,
): Promise<SessionRow[]> {
	const db = getDb();
	return db
		.select()
		.from(sessions)
		.where(
			and(
				eq(sessions.parentSessionId, parentSessionId),
				eq(sessions.organizationId, organizationId),
				eq(sessions.kind, "task"),
			),
		)
		.orderBy(desc(sessions.startedAt));
}

export async function findLatestTerminalFollowupSession(input: {
	organizationId: string;
	sourceSessionId: string;
	mode: "continuation" | "rerun";
}): Promise<SessionRow | undefined> {
	const db = getDb();
	return db.query.sessions.findFirst({
		where: and(
			eq(sessions.organizationId, input.organizationId),
			eq(sessions.kind, "task"),
			isNull(sessions.workerId),
			isNull(sessions.workerRunId),
			input.mode === "continuation"
				? eq(sessions.continuedFromSessionId, input.sourceSessionId)
				: eq(sessions.rerunOfSessionId, input.sourceSessionId),
		),
		orderBy: (table, { desc: d }) => [d(table.startedAt), d(table.id)],
	});
}

export async function getSessionOutcome(sessionId: string): Promise<{
	outcomeJson: unknown;
	outcomeVersion: number | null;
	outcomePersistedAt: Date | null;
} | null> {
	const db = getDb();
	const [row] = await db
		.select({
			outcomeJson: sessions.outcomeJson,
			outcomeVersion: sessions.outcomeVersion,
			outcomePersistedAt: sessions.outcomePersistedAt,
		})
		.from(sessions)
		.where(eq(sessions.id, sessionId))
		.limit(1);

	if (!row) {
		return null;
	}

	return row;
}

export async function listDeliverableSessionMessages(
	sessionId: string,
	now = new Date(),
): Promise<SessionMessageRow[]> {
	const db = getDb();
	return db
		.select()
		.from(sessionMessages)
		.where(
			and(
				eq(sessionMessages.sessionId, sessionId),
				eq(sessionMessages.deliveryState, "queued"),
				or(isNull(sessionMessages.deliverAfter), lte(sessionMessages.deliverAfter, now)),
			),
		)
		.orderBy(asc(sessionMessages.queuedAt), asc(sessionMessages.id));
}

/**
 * Atomically claims queued + deliverable messages for delivery.
 *
 * Delivery order is deterministic: queuedAt ASC, id ASC.
 */
export async function claimDeliverableSessionMessages(
	sessionId: string,
	limit = 50,
): Promise<SessionMessageRow[]> {
	const db = getDb();
	return db.transaction(async (tx) => {
		const selectedRows = await tx
			.select({
				id: sessionMessages.id,
			})
			.from(sessionMessages)
			.where(
				and(
					eq(sessionMessages.sessionId, sessionId),
					eq(sessionMessages.deliveryState, "queued"),
					or(isNull(sessionMessages.deliverAfter), lte(sessionMessages.deliverAfter, new Date())),
				),
			)
			.orderBy(asc(sessionMessages.queuedAt), asc(sessionMessages.id))
			.limit(limit)
			.for("update", { skipLocked: true });

		if (selectedRows.length === 0) {
			return [];
		}

		const selectedIds = selectedRows.map((row) => row.id);
		const orderById = new Map<string, number>(selectedIds.map((id, index) => [id, index]));

		const updatedRows = await tx
			.update(sessionMessages)
			.set({
				deliveryState: "delivered",
				deliveredAt: new Date(),
			})
			.where(inArray(sessionMessages.id, selectedIds))
			.returning();

		updatedRows.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
		return updatedRows;
	});
}

export async function transitionSessionMessageDeliveryState(input: {
	id: string;
	fromStates: SessionMessageDeliveryState[];
	toState: SessionMessageDeliveryState;
	fields?: {
		deliveredAt?: Date | null;
		consumedAt?: Date | null;
		failedAt?: Date | null;
		failureReason?: string | null;
	};
}): Promise<SessionMessageRow | undefined> {
	if (input.fromStates.length === 0) {
		throw new Error("fromStates must include at least one state");
	}

	const db = getDb();
	const [row] = await db
		.update(sessionMessages)
		.set({
			deliveryState: input.toState,
			deliveredAt: input.fields?.deliveredAt,
			consumedAt: input.fields?.consumedAt,
			failedAt: input.fields?.failedAt,
			failureReason: input.fields?.failureReason,
		})
		.where(
			and(
				eq(sessionMessages.id, input.id),
				inArray(sessionMessages.deliveryState, input.fromStates),
			),
		)
		.returning();
	return row;
}

// ============================================
// Manager Session Creation
// ============================================

export interface CreateManagerSessionInput {
	organizationId: string;
	createdBy: string;
	repoId?: string | null;
	repoBaselineId?: string | null;
	repoBaselineTargetId?: string | null;
	configurationId?: string | null;
	visibility?: "private" | "shared" | "org";
	title?: string | null;
}

/**
 * Create a placeholder session for a new manager.
 *
 * Inserts with kind=NULL to avoid the `sessions_manager_shape_check` constraint
 * (which requires worker_id IS NOT NULL for manager sessions). The caller must
 * call `promoteToManagerSession()` after the worker row exists.
 */
export async function createManagerSessionPlaceholder(
	input: CreateManagerSessionInput,
	tx?: DbTransaction,
): Promise<SessionRow> {
	const db = tx ?? getDb();
	const [row] = await db
		.insert(sessions)
		.values({
			organizationId: input.organizationId,
			createdBy: input.createdBy,
			sessionType: "coding",
			kind: null,
			status: "starting",
			runtimeStatus: "starting",
			operatorStatus: "active",
			visibility: input.visibility ?? "org",
			repoId: input.repoId ?? null,
			repoBaselineId: input.repoBaselineId ?? null,
			repoBaselineTargetId: input.repoBaselineTargetId ?? null,
			configurationId: input.configurationId ?? null,
			title: input.title ?? null,
		})
		.returning();

	return row;
}

/**
 * Promote a placeholder session to kind='manager' and link it to a worker.
 *
 * Must be called after the worker row is created so the FK and check constraint are satisfied.
 */
export async function promoteToManagerSession(
	sessionId: string,
	workerId: string,
	tx?: DbTransaction,
): Promise<SessionRow> {
	const db = tx ?? getDb();
	const [row] = await db
		.update(sessions)
		.set({ kind: "manager", workerId })
		.where(eq(sessions.id, sessionId))
		.returning();

	if (!row) {
		throw new Error(`Session ${sessionId} not found during promotion to manager`);
	}

	return row;
}

/**
 * Update a manager session's repo/configuration linkage.
 *
 * Used when a worker's repo is changed via the settings UI — propagates
 * the change to the manager session so child tasks inherit the correct repo.
 */
export async function updateManagerSessionLinkage(
	sessionId: string,
	organizationId: string,
	linkage: { repoId?: string | null; configurationId?: string | null },
): Promise<void> {
	const db = getDb();
	const updates: Record<string, string | null> = {};
	if (linkage.repoId !== undefined) updates.repoId = linkage.repoId;
	if (linkage.configurationId !== undefined) updates.configurationId = linkage.configurationId;
	if (Object.keys(updates).length === 0) return;
	await db
		.update(sessions)
		.set(updates)
		.where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, organizationId)));
}

// ============================================
// Task Session Creation
// ============================================

export interface CreateTaskSessionInput {
	id?: string;
	organizationId: string;
	createdBy: string;
	repoId?: string | null;
	repoBaselineId?: string | null;
	repoBaselineTargetId?: string | null;
	workerId?: string | null;
	workerRunId?: string | null;
	parentSessionId?: string | null;
	continuedFromSessionId?: string | null;
	rerunOfSessionId?: string | null;
	configurationId?: string | null;
	visibility?: "private" | "shared" | "org";
	initialPrompt?: string | null;
	title?: string | null;
	sandboxProvider?: "modal" | "e2b";
}

export async function createTaskSession(input: CreateTaskSessionInput): Promise<SessionRow> {
	// Configured task sessions require full repo linkage for baseline diffing,
	// UNLESS they're spawned by a manager (parentSessionId set) — those only
	// need configurationId for snapshot/repo resolution, not baseline tracking.
	if (
		input.configurationId &&
		!input.parentSessionId &&
		(!input.repoId || !input.repoBaselineId || !input.repoBaselineTargetId)
	) {
		throw new Error("Configured task session requires repo + baseline + baseline target linkage");
	}

	const db = getDb();
	const [row] = await db
		.insert(sessions)
		.values({
			id: input.id,
			organizationId: input.organizationId,
			createdBy: input.createdBy,
			sessionType: "coding",
			kind: "task",
			status: "starting",
			runtimeStatus: "starting",
			operatorStatus: "active",
			visibility: input.visibility ?? "private",
			repoId: input.repoId ?? null,
			repoBaselineId: input.repoBaselineId ?? null,
			repoBaselineTargetId: input.repoBaselineTargetId ?? null,
			workerId: input.workerId ?? null,
			workerRunId: input.workerRunId ?? null,
			parentSessionId: input.parentSessionId ?? null,
			continuedFromSessionId: input.continuedFromSessionId ?? null,
			rerunOfSessionId: input.rerunOfSessionId ?? null,
			configurationId: input.configurationId ?? null,
			initialPrompt: input.initialPrompt ?? null,
			title: input.title ?? null,
			...(input.sandboxProvider ? { sandboxProvider: input.sandboxProvider } : {}),
		})
		.returning();

	return row;
}

// ============================================
// K3: Session visible update
// ============================================

export async function updateLastVisibleUpdateAt(sessionId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ lastVisibleUpdateAt: new Date() })
		.where(eq(sessions.id, sessionId));
}

// ============================================
// K4: Operator status projection
// ============================================

export async function updateOperatorStatus(
	sessionId: string,
	operatorStatus: string,
): Promise<void> {
	const db = getDb();
	await db.update(sessions).set({ operatorStatus }).where(eq(sessions.id, sessionId));
}

// ============================================
// K5: Session events
// ============================================

export interface CreateSessionEventInput {
	sessionId: string;
	eventType: string;
	actorUserId?: string | null;
	payloadJson?: unknown;
}

export async function createSessionEvent(input: CreateSessionEventInput): Promise<void> {
	const db = getDb();
	await db.insert(sessionEvents).values({
		sessionId: input.sessionId,
		eventType: input.eventType,
		actorUserId: input.actorUserId ?? null,
		payloadJson: input.payloadJson ?? null,
	});
}

export async function listSessionEvents(sessionId: string): Promise<
	Array<{
		id: string;
		sessionId: string;
		eventType: string;
		actorUserId: string | null;
		payloadJson: unknown;
		createdAt: Date;
	}>
> {
	const db = getDb();
	return db
		.select()
		.from(sessionEvents)
		.where(eq(sessionEvents.sessionId, sessionId))
		.orderBy(asc(sessionEvents.createdAt));
}

// ============================================
// K2: Session ACL
// ============================================

export async function getSessionAclRole(sessionId: string, userId: string): Promise<string | null> {
	const db = getDb();
	const [row] = await db
		.select({ role: sessionAcl.role })
		.from(sessionAcl)
		.where(and(eq(sessionAcl.sessionId, sessionId), eq(sessionAcl.userId, userId)))
		.limit(1);
	return row?.role ?? null;
}

export async function grantSessionAcl(input: {
	sessionId: string;
	userId: string;
	role: string;
	grantedBy?: string | null;
}): Promise<void> {
	const db = getDb();
	await db
		.insert(sessionAcl)
		.values({
			sessionId: input.sessionId,
			userId: input.userId,
			role: input.role,
			grantedBy: input.grantedBy ?? null,
		})
		.onConflictDoUpdate({
			target: [sessionAcl.sessionId, sessionAcl.userId],
			set: { role: input.role, grantedBy: input.grantedBy ?? null },
		});
}

export async function updateSessionVisibility(
	sessionId: string,
	visibility: "private" | "shared" | "org",
): Promise<void> {
	const db = getDb();
	await db.update(sessions).set({ visibility }).where(eq(sessions.id, sessionId));
}

// ============================================
// K6: Archive and delete
// ============================================

export async function archiveSession(sessionId: string, userId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ archivedAt: new Date(), archivedBy: userId })
		.where(eq(sessions.id, sessionId));
}

export async function unarchiveSession(sessionId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ archivedAt: null, archivedBy: null })
		.where(eq(sessions.id, sessionId));
}

export async function softDeleteSession(sessionId: string, userId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ deletedAt: new Date(), deletedBy: userId })
		.where(eq(sessions.id, sessionId));
}

export async function archiveSessionForUser(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	await upsertSessionUserState({
		sessionId: input.sessionId,
		userId: input.userId,
		archivedAt: new Date(),
	});
}

export async function unarchiveSessionForUser(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	await upsertSessionUserState({
		sessionId: input.sessionId,
		userId: input.userId,
		archivedAt: null,
	});
}
