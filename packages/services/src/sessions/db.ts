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

/** Session with repo relation */
export type SessionWithRepoRow = SessionRow & {
	repo: RepoRow | null;
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

	const results = await db.query.sessions.findMany({
		where: and(...conditions),
		with: {
			repo: true,
		},
		orderBy: [desc(sessions.startedAt)],
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
			prebuildId: input.prebuildId,
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
 * Update session prebuild_id.
 */
export async function updatePrebuildId(sessionId: string, prebuildId: string): Promise<void> {
	const db = getDb();
	await db.update(sessions).set({ prebuildId }).where(eq(sessions.id, sessionId));
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
		})
		.where(eq(sessions.id, sessionId));
}

/**
 * Create a setup session for a managed prebuild.
 */
export async function createSetupSession(input: CreateSetupSessionInput): Promise<void> {
	const db = getDb();
	await db.insert(sessions).values({
		id: input.id,
		prebuildId: input.prebuildId,
		organizationId: input.organizationId,
		sessionType: "setup",
		status: "starting",
		initialPrompt: input.initialPrompt,
		source: "managed-prebuild",
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
