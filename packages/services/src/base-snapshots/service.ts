/**
 * Base snapshots service.
 *
 * Business logic for base snapshot lifecycle.
 */

import * as baseSnapshotsDb from "./db";

export type { BaseSnapshotRow } from "./db";

/**
 * Get the ready base snapshot ID for the current version+provider+app.
 * Returns null if no ready snapshot exists.
 */
export async function getReadySnapshotId(
	versionKey: string,
	provider: string,
	modalAppName: string,
): Promise<string | null> {
	const row = await baseSnapshotsDb.findReady(versionKey, provider, modalAppName);
	return row?.snapshotId ?? null;
}

/**
 * Check if a base snapshot build is needed.
 * Returns true if no row exists or only a failed row exists.
 */
export async function isBuildNeeded(
	versionKey: string,
	provider: string,
	modalAppName: string,
): Promise<boolean> {
	const existing = await baseSnapshotsDb.findByVersionKey(versionKey, provider, modalAppName);
	if (!existing) return true;
	if (existing.status === "failed") return true;
	return false;
}

/**
 * Start tracking a base snapshot build (idempotent).
 * Returns the record ID and whether it was already ready.
 */
export async function startBuild(input: {
	versionKey: string;
	provider: string;
	modalAppName: string;
}): Promise<{ id: string; alreadyReady: boolean }> {
	const existing = await baseSnapshotsDb.findByVersionKey(
		input.versionKey,
		input.provider,
		input.modalAppName,
	);

	if (existing?.status === "ready" && existing.snapshotId) {
		return { id: existing.id, alreadyReady: true };
	}

	if (existing?.status === "failed") {
		await baseSnapshotsDb.resetToBuilding(existing.id);
		return { id: existing.id, alreadyReady: false };
	}

	if (existing?.status === "building") {
		return { id: existing.id, alreadyReady: false };
	}

	const row = await baseSnapshotsDb.insertBuilding(input);
	return { id: row.id, alreadyReady: false };
}

/**
 * Mark a base snapshot build as complete.
 */
export async function completeBuild(id: string, snapshotId: string): Promise<void> {
	await baseSnapshotsDb.markReady(id, snapshotId);
}

/**
 * Mark a base snapshot build as failed.
 */
export async function failBuild(id: string, error: string): Promise<void> {
	await baseSnapshotsDb.markFailed(id, error);
}
