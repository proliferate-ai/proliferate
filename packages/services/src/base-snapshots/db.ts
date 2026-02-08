/**
 * Base snapshots DB operations.
 *
 * Raw Drizzle queries — no business logic.
 */

import { and, eq, getDb, sandboxBaseSnapshots } from "../db/client";
import type { InferSelectModel } from "../db/client";

export type BaseSnapshotRow = InferSelectModel<typeof sandboxBaseSnapshots>;

/**
 * Find a ready base snapshot for the given version+provider+app.
 */
export async function findReady(
	versionKey: string,
	provider: string,
	modalAppName: string,
): Promise<BaseSnapshotRow | null> {
	const db = getDb();
	const result = await db.query.sandboxBaseSnapshots.findFirst({
		where: and(
			eq(sandboxBaseSnapshots.versionKey, versionKey),
			eq(sandboxBaseSnapshots.provider, provider),
			eq(sandboxBaseSnapshots.modalAppName, modalAppName),
			eq(sandboxBaseSnapshots.status, "ready"),
		),
	});
	return result ?? null;
}

/**
 * Find any base snapshot (any status) for a given version+provider+app.
 */
export async function findByVersionKey(
	versionKey: string,
	provider: string,
	modalAppName: string,
): Promise<BaseSnapshotRow | null> {
	const db = getDb();
	const result = await db.query.sandboxBaseSnapshots.findFirst({
		where: and(
			eq(sandboxBaseSnapshots.versionKey, versionKey),
			eq(sandboxBaseSnapshots.provider, provider),
			eq(sandboxBaseSnapshots.modalAppName, modalAppName),
		),
	});
	return result ?? null;
}

/**
 * Insert a new base snapshot record in "building" status.
 * Uses ON CONFLICT DO NOTHING so concurrent workers don't race.
 */
export async function insertBuilding(input: {
	versionKey: string;
	provider: string;
	modalAppName: string;
}): Promise<BaseSnapshotRow> {
	const db = getDb();
	await db
		.insert(sandboxBaseSnapshots)
		.values({
			versionKey: input.versionKey,
			provider: input.provider,
			modalAppName: input.modalAppName,
			status: "building",
		})
		.onConflictDoNothing();

	const row = await findByVersionKey(input.versionKey, input.provider, input.modalAppName);
	if (!row) {
		throw new Error("Failed to insert or find base snapshot record");
	}
	return row;
}

/**
 * Mark a base snapshot as ready with the snapshot ID.
 */
export async function markReady(id: string, snapshotId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sandboxBaseSnapshots)
		.set({
			snapshotId,
			status: "ready",
			builtAt: new Date(),
			error: null,
			updatedAt: new Date(),
		})
		.where(eq(sandboxBaseSnapshots.id, id));
}

/**
 * Mark a base snapshot as failed.
 */
export async function markFailed(id: string, error: string): Promise<void> {
	const db = getDb();
	await db
		.update(sandboxBaseSnapshots)
		.set({
			status: "failed",
			error,
			updatedAt: new Date(),
		})
		.where(eq(sandboxBaseSnapshots.id, id));
}

/**
 * Reset a failed snapshot back to building (for retry).
 */
export async function resetToBuilding(id: string): Promise<void> {
	const db = getDb();
	await db
		.update(sandboxBaseSnapshots)
		.set({
			status: "building",
			error: null,
			updatedAt: new Date(),
		})
		.where(and(eq(sandboxBaseSnapshots.id, id), eq(sandboxBaseSnapshots.status, "failed")));
}
