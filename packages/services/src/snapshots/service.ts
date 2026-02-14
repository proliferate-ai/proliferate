/**
 * Snapshots service.
 *
 * Business logic for first-class snapshot entities.
 */

import { randomUUID } from "crypto";
import * as snapshotsDb from "./db";

// ============================================
// Types
// ============================================

export interface CreateSnapshotInput {
	prebuildId: string;
	sandboxProvider: string;
}

export interface MarkSnapshotReadyInput {
	snapshotId: string;
	providerSnapshotId: string;
	hasDeps: boolean;
	repoCommits?: Array<{ repoId: string; commitSha: string }>;
}

// ============================================
// Service functions
// ============================================

/**
 * Create a new snapshot in building state.
 */
export async function createSnapshot(input: CreateSnapshotInput) {
	const id = randomUUID();
	const row = await snapshotsDb.create({
		id,
		prebuildId: input.prebuildId,
		sandboxProvider: input.sandboxProvider,
	});
	return row;
}

/**
 * Mark a snapshot as ready, record repo commits, and set as active on the prebuild.
 */
export async function markSnapshotReady(input: MarkSnapshotReadyInput): Promise<void> {
	await snapshotsDb.markReady(input);
}

/**
 * Mark a snapshot as failed with an error message.
 */
export async function markSnapshotFailed(snapshotId: string, error: string): Promise<void> {
	await snapshotsDb.markFailed(snapshotId, error);
}

/**
 * Get a snapshot by ID.
 */
export async function getSnapshot(id: string) {
	return snapshotsDb.findById(id);
}

/**
 * Get a snapshot by ID with its repo commit data.
 */
export async function getSnapshotWithRepos(id: string) {
	return snapshotsDb.findByIdWithRepos(id);
}

/**
 * List all snapshots for a prebuild.
 */
export async function listSnapshots(prebuildId: string) {
	return snapshotsDb.listByPrebuild(prebuildId);
}

/**
 * Get the active (ready) snapshot for a prebuild.
 * Returns null if no active snapshot is set.
 */
export async function getActiveSnapshot(prebuildId: string) {
	return snapshotsDb.getActiveSnapshot(prebuildId);
}
