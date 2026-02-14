/**
 * Snapshots DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	type InferSelectModel,
	and,
	desc,
	eq,
	getDb,
	prebuilds,
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
	prebuildId: string;
	sandboxProvider: string;
}): Promise<SnapshotRow> {
	const db = getDb();
	const [row] = await db
		.insert(snapshots)
		.values({
			id: input.id,
			prebuildId: input.prebuildId,
			sandboxProvider: input.sandboxProvider,
			status: "building",
			hasDeps: false,
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
 * List snapshots for a prebuild, newest first.
 */
export async function listByPrebuild(prebuildId: string): Promise<SnapshotRow[]> {
	const db = getDb();
	return db.query.snapshots.findMany({
		where: eq(snapshots.prebuildId, prebuildId),
		orderBy: [desc(snapshots.createdAt)],
	});
}

/**
 * Mark a snapshot as ready and set active_snapshot_id on the parent prebuild.
 * Also inserts snapshot_repos entries for commit tracking.
 */
export async function markReady(input: {
	snapshotId: string;
	providerSnapshotId: string;
	hasDeps: boolean;
	repoCommits?: Array<{ repoId: string; commitSha: string }>;
}): Promise<void> {
	const db = getDb();

	// Update snapshot status
	const [snapshot] = await db
		.update(snapshots)
		.set({
			status: "ready",
			providerSnapshotId: input.providerSnapshotId,
			hasDeps: input.hasDeps,
			updatedAt: new Date(),
		})
		.where(eq(snapshots.id, input.snapshotId))
		.returning({ prebuildId: snapshots.prebuildId });

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

	// Set active_snapshot_id on prebuild
	await db
		.update(prebuilds)
		.set({
			activeSnapshotId: input.snapshotId,
		})
		.where(eq(prebuilds.id, snapshot.prebuildId));
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
 * Get the active snapshot for a prebuild (via active_snapshot_id).
 * Returns null if no active snapshot set.
 */
export async function getActiveSnapshot(prebuildId: string): Promise<SnapshotRow | null> {
	const db = getDb();
	const prebuild = await db.query.prebuilds.findFirst({
		where: eq(prebuilds.id, prebuildId),
		columns: { activeSnapshotId: true },
	});

	if (!prebuild?.activeSnapshotId) return null;

	const row = await db.query.snapshots.findFirst({
		where: and(eq(snapshots.id, prebuild.activeSnapshotId), eq(snapshots.status, "ready")),
	});

	return row ?? null;
}
