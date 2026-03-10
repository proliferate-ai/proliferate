/**
 * Baselines DB operations.
 *
 * Raw Drizzle queries for repo_baselines and repo_baseline_targets.
 */

import type { RepoBaselineStatus } from "@proliferate/shared/contracts/baselines";
import {
	type InferSelectModel,
	and,
	desc,
	eq,
	getDb,
	inArray,
	ne,
	repoBaselineTargets,
	repoBaselines,
	sessions,
	sql,
} from "../db/client";

export type RepoBaselineRow = InferSelectModel<typeof repoBaselines>;
export type RepoBaselineTargetRow = InferSelectModel<typeof repoBaselineTargets>;

// ============================================
// Baseline Queries
// ============================================

/**
 * Get the active (status=ready) baseline for a repo.
 * The partial unique index guarantees at most one ready baseline per repo.
 */
export async function findActiveBaseline(
	repoId: string,
	orgId: string,
): Promise<RepoBaselineRow | null> {
	const db = getDb();
	const row = await db.query.repoBaselines.findFirst({
		where: and(
			eq(repoBaselines.repoId, repoId),
			eq(repoBaselines.organizationId, orgId),
			eq(repoBaselines.status, "ready"),
		),
	});
	return row ?? null;
}

/**
 * Get a baseline by ID.
 */
export async function findBaselineById(id: string, orgId: string): Promise<RepoBaselineRow | null> {
	const db = getDb();
	const row = await db.query.repoBaselines.findFirst({
		where: and(eq(repoBaselines.id, id), eq(repoBaselines.organizationId, orgId)),
	});
	return row ?? null;
}

/**
 * List all baselines for a repo, ordered by most recent first.
 */
export async function listByRepo(repoId: string, orgId: string): Promise<RepoBaselineRow[]> {
	const db = getDb();
	return db.query.repoBaselines.findMany({
		where: and(eq(repoBaselines.repoId, repoId), eq(repoBaselines.organizationId, orgId)),
		orderBy: [desc(repoBaselines.createdAt)],
	});
}

/**
 * List baselines for multiple repos (for the repo list page).
 * Returns the active baseline per repo.
 */
export async function listActiveBaselinesByRepoIds(
	repoIds: string[],
	orgId: string,
): Promise<RepoBaselineRow[]> {
	if (repoIds.length === 0) return [];
	const db = getDb();
	return db.query.repoBaselines.findMany({
		where: and(
			inArray(repoBaselines.repoId, repoIds),
			eq(repoBaselines.organizationId, orgId),
			eq(repoBaselines.status, "ready"),
		),
	});
}

/**
 * Create a new baseline.
 */
export async function createBaseline(input: {
	repoId: string;
	organizationId: string;
	status?: RepoBaselineStatus;
	version?: string;
	createdBy?: string;
	setupSessionId?: string;
}): Promise<RepoBaselineRow> {
	const db = getDb();
	const [row] = await db
		.insert(repoBaselines)
		.values({
			repoId: input.repoId,
			organizationId: input.organizationId,
			status: input.status ?? "validating",
			version: input.version ?? null,
			createdBy: input.createdBy ?? null,
			setupSessionId: input.setupSessionId ?? null,
		})
		.returning();
	return row;
}

/**
 * Transition baseline status with guard.
 * Returns the updated row or null if the transition was invalid (CAS failure).
 */
export async function transitionBaselineStatus(input: {
	id: string;
	orgId: string;
	fromStatus: RepoBaselineStatus;
	toStatus: RepoBaselineStatus;
	fields?: {
		version?: string;
		snapshotId?: string;
		sandboxProvider?: string;
		setupSessionId?: string;
		installCommands?: unknown;
		runCommands?: unknown;
		testCommands?: unknown;
		serviceCommands?: unknown;
		errorMessage?: string | null;
	};
}): Promise<RepoBaselineRow | null> {
	const db = getDb();
	const now = new Date();
	const [row] = await db
		.update(repoBaselines)
		.set({
			status: input.toStatus,
			updatedAt: now,
			...(input.fields?.version !== undefined && { version: input.fields.version }),
			...(input.fields?.snapshotId !== undefined && { snapshotId: input.fields.snapshotId }),
			...(input.fields?.sandboxProvider !== undefined && {
				sandboxProvider: input.fields.sandboxProvider,
			}),
			...(input.fields?.setupSessionId !== undefined && {
				setupSessionId: input.fields.setupSessionId,
			}),
			...(input.fields?.installCommands !== undefined && {
				installCommands: input.fields.installCommands,
			}),
			...(input.fields?.runCommands !== undefined && { runCommands: input.fields.runCommands }),
			...(input.fields?.testCommands !== undefined && {
				testCommands: input.fields.testCommands,
			}),
			...(input.fields?.serviceCommands !== undefined && {
				serviceCommands: input.fields.serviceCommands,
			}),
			...(input.fields?.errorMessage !== undefined && {
				errorMessage: input.fields.errorMessage,
			}),
		})
		.where(
			and(
				eq(repoBaselines.id, input.id),
				eq(repoBaselines.organizationId, input.orgId),
				eq(repoBaselines.status, input.fromStatus),
			),
		)
		.returning();
	return row ?? null;
}

/**
 * Mark an existing ready baseline as stale (for supersede policy).
 */
export async function markReadyBaselineStale(
	repoId: string,
	orgId: string,
	excludeBaselineId: string,
): Promise<void> {
	const db = getDb();
	await db
		.update(repoBaselines)
		.set({ status: "stale", updatedAt: new Date() })
		.where(
			and(
				eq(repoBaselines.repoId, repoId),
				eq(repoBaselines.organizationId, orgId),
				eq(repoBaselines.status, "ready"),
				ne(repoBaselines.id, excludeBaselineId),
			),
		);
}

// ============================================
// Target Queries
// ============================================

/**
 * List targets for a baseline.
 */
export async function listTargetsByBaseline(baselineId: string): Promise<RepoBaselineTargetRow[]> {
	const db = getDb();
	return db.query.repoBaselineTargets.findMany({
		where: eq(repoBaselineTargets.repoBaselineId, baselineId),
	});
}

/**
 * Get a target by ID.
 */
export async function findTargetById(id: string): Promise<RepoBaselineTargetRow | null> {
	const db = getDb();
	const row = await db.query.repoBaselineTargets.findFirst({
		where: eq(repoBaselineTargets.id, id),
	});
	return row ?? null;
}

/**
 * Get a target by name within a baseline.
 */
export async function findTargetByName(
	baselineId: string,
	name: string,
): Promise<RepoBaselineTargetRow | null> {
	const db = getDb();
	const row = await db.query.repoBaselineTargets.findFirst({
		where: and(
			eq(repoBaselineTargets.repoBaselineId, baselineId),
			eq(repoBaselineTargets.name, name),
		),
	});
	return row ?? null;
}

/**
 * Create a target for a baseline.
 */
export async function createTarget(input: {
	repoBaselineId: string;
	name: string;
	description?: string;
	configJson?: unknown;
}): Promise<RepoBaselineTargetRow> {
	const db = getDb();
	const [row] = await db
		.insert(repoBaselineTargets)
		.values({
			repoBaselineId: input.repoBaselineId,
			name: input.name,
			description: input.description ?? null,
			configJson: input.configJson ?? null,
		})
		.returning();
	return row;
}

// ============================================
// Setup Session Uniqueness
// ============================================

/**
 * Find the non-terminal setup session for a repo.
 * Used to enforce the setup session uniqueness invariant.
 */
export async function findNonTerminalSetupSession(
	repoId: string,
	orgId: string,
): Promise<{ id: string } | null> {
	const db = getDb();
	const row = await db.query.sessions.findFirst({
		where: and(
			eq(sessions.repoId, repoId),
			eq(sessions.organizationId, orgId),
			eq(sessions.kind, "setup"),
			sql`${sessions.terminalState} IS NULL`,
		),
		columns: { id: true },
	});
	return row ?? null;
}

/**
 * Count targets for a baseline.
 */
export async function countTargetsByBaseline(baselineId: string): Promise<number> {
	const db = getDb();
	const [result] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(repoBaselineTargets)
		.where(eq(repoBaselineTargets.repoBaselineId, baselineId));
	return result?.count ?? 0;
}

/**
 * Find the most recent setup session for a repo (any status).
 */
export async function findLatestSetupSession(
	repoId: string,
	orgId: string,
): Promise<{
	id: string;
	sandboxState: string;
	agentState: string;
	terminalState: string | null;
	startedAt: Date | null;
} | null> {
	const db = getDb();
	const row = await db.query.sessions.findFirst({
		where: and(
			eq(sessions.repoId, repoId),
			eq(sessions.organizationId, orgId),
			eq(sessions.kind, "setup"),
		),
		columns: {
			id: true,
			sandboxState: true,
			agentState: true,
			terminalState: true,
			startedAt: true,
		},
		orderBy: [desc(sessions.startedAt)],
	});
	return row ?? null;
}
