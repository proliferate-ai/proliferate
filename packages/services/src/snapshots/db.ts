/**
 * Snapshots DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	type InferSelectModel,
	and,
	configurations,
	desc,
	eq,
	getDb,
	snapshotRepos,
	snapshots,
} from "../db/client";

// ============================================
// Types
// ============================================

export type SnapshotRow = InferSelectModel<typeof snapshots>;
export type SnapshotRepoRow = InferSelectModel<typeof snapshotRepos>;

export interface SnapshotWithReposRow extends SnapshotRow {
	snapshotRepos: Array<{
		repoId: string;
		commitSha: string | null;
	}>;
}

// ============================================
// Queries
// ============================================

/**
 * Create a new snapshot record (status=building).
 */
export async function create(input: {
	id: string;
	configurationId: string;
	sandboxProvider: string;
}): Promise<SnapshotRow> {
	const db = getDb();
	const [row] = await db
		.insert(snapshots)
		.values({
			id: input.id,
			configurationId: input.configurationId,
			sandboxProvider: input.sandboxProvider,
			status: "building",
		})
		.returning();
	return row;
}

/**
 * Find a snapshot by ID.
 */
export async function findById(id: string): Promise<SnapshotRow | null> {
	const db = getDb();
	const row = await db.query.snapshots.findFirst({
		where: eq(snapshots.id, id),
	});
	return row ?? null;
}

/**
 * Find a snapshot by ID with repo commits.
 */
export async function findByIdWithRepos(id: string): Promise<SnapshotWithReposRow | null> {
	const db = getDb();
	const row = await db.query.snapshots.findFirst({
		where: eq(snapshots.id, id),
		with: {
			snapshotRepos: {
				columns: {
					repoId: true,
					commitSha: true,
				},
			},
		},
	});
	return (row as SnapshotWithReposRow) ?? null;
}

/**
 * List snapshots for a configuration, newest first.
 */
export async function listByConfiguration(configurationId: string): Promise<SnapshotRow[]> {
	const db = getDb();
	return db.query.snapshots.findMany({
		where: eq(snapshots.configurationId, configurationId),
		orderBy: [desc(snapshots.createdAt)],
	});
}

/**
 * Mark a snapshot as ready and set active_snapshot_id on the parent configuration.
 * Also inserts snapshot_repos entries for commit tracking.
 */
export async function markReady(input: {
	snapshotId: string;
	providerSnapshotId: string;
	repoCommits?: Array<{ repoId: string; commitSha: string }>;
}): Promise<void> {
	const db = getDb();

	// Update snapshot status
	const [snapshot] = await db
		.update(snapshots)
		.set({
			status: "ready",
			providerSnapshotId: input.providerSnapshotId,
			updatedAt: new Date(),
		})
		.where(eq(snapshots.id, input.snapshotId))
		.returning({ configurationId: snapshots.configurationId });

	if (!snapshot) return;

	// Insert snapshot_repos if provided
	if (input.repoCommits && input.repoCommits.length > 0) {
		await db.insert(snapshotRepos).values(
			input.repoCommits.map((rc) => ({
				snapshotId: input.snapshotId,
				repoId: rc.repoId,
				commitSha: rc.commitSha,
			})),
		);
	}

	// Set active_snapshot_id on configuration
	await db
		.update(configurations)
		.set({
			activeSnapshotId: input.snapshotId,
		})
		.where(eq(configurations.id, snapshot.configurationId));
}

/**
 * Mark a snapshot as failed.
 */
export async function markFailed(snapshotId: string, error: string): Promise<void> {
	const db = getDb();
	await db
		.update(snapshots)
		.set({
			status: "failed",
			error,
			updatedAt: new Date(),
		})
		.where(eq(snapshots.id, snapshotId));
}

/**
 * Get the active snapshot for a configuration (via active_snapshot_id).
 * Returns null if no active snapshot set.
 */
export async function getActiveSnapshot(configurationId: string): Promise<SnapshotRow | null> {
	const db = getDb();
	const configuration = await db.query.configurations.findFirst({
		where: eq(configurations.id, configurationId),
		columns: { activeSnapshotId: true },
	});

	if (!configuration?.activeSnapshotId) return null;

	const row = await db.query.snapshots.findFirst({
		where: and(eq(snapshots.id, configuration.activeSnapshotId), eq(snapshots.status, "ready")),
	});

	return row ?? null;
}
