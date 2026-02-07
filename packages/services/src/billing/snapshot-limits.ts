/**
 * Snapshot quota management.
 *
 * Snapshots are FREE within quota (no credits).
 * Only count and retention limits apply per plan.
 */

import { type BillingPlan, PLAN_CONFIGS } from "@proliferate/shared/billing";
import { and, asc, eq, getDb, isNotNull, lt, sessions, sql } from "../db/client";
import { getServicesLogger } from "../logger";

// ============================================
// Types
// ============================================

interface SessionWithSnapshot {
	id: string;
	snapshotId: string | null;
	sandboxProvider: string | null;
	pausedAt: Date | null;
}

// ============================================
// Quota Checking
// ============================================

/**
 * Get current snapshot count for an organization.
 */
export async function getSnapshotCount(orgId: string): Promise<number> {
	const db = getDb();
	const [result] = await db
		.select({ count: sql<number>`count(*)` })
		.from(sessions)
		.where(and(eq(sessions.organizationId, orgId), isNotNull(sessions.snapshotId)));

	return Number(result?.count ?? 0);
}

/**
 * Check if org can create a new snapshot.
 */
export async function canCreateSnapshot(
	orgId: string,
	plan: BillingPlan = "dev",
): Promise<{ allowed: boolean; current: number; max: number }> {
	const limits = PLAN_CONFIGS[plan];
	const count = await getSnapshotCount(orgId);

	return {
		allowed: count < limits.maxSnapshots,
		current: count,
		max: limits.maxSnapshots,
	};
}

/**
 * Ensure org can create a snapshot by deleting oldest if at limit.
 * Returns the snapshot that was deleted (if any).
 *
 * NO CREDIT CHARGE - snapshots are free within quota.
 */
export async function ensureSnapshotCapacity(
	orgId: string,
	plan: BillingPlan = "dev",
	deleteSnapshotFn?: (provider: string, snapshotId: string) => Promise<void>,
): Promise<{ deletedSnapshotId: string | null }> {
	const { allowed, current, max } = await canCreateSnapshot(orgId, plan);

	if (allowed) {
		return { deletedSnapshotId: null };
	}

	const logger = getServicesLogger().child({ module: "snapshot-limits", orgId });
	logger.info({ current, max }, "At snapshot limit, deleting oldest");

	const db = getDb();
	const oldest = (await db.query.sessions.findFirst({
		where: and(eq(sessions.organizationId, orgId), isNotNull(sessions.snapshotId)),
		columns: {
			id: true,
			snapshotId: true,
			sandboxProvider: true,
			pausedAt: true,
		},
		orderBy: [asc(sessions.pausedAt)],
	})) as SessionWithSnapshot | null;

	if (!oldest?.snapshotId) {
		logger.warn("No snapshots found to delete");
		return { deletedSnapshotId: null };
	}

	// Delete from provider if function provided
	if (deleteSnapshotFn && oldest.sandboxProvider) {
		try {
			await deleteSnapshotFn(oldest.sandboxProvider, oldest.snapshotId);
		} catch (err) {
			logger.error({ err }, "Failed to delete snapshot from provider");
		}
	}

	// Clear snapshot reference in session
	await db.update(sessions).set({ snapshotId: null }).where(eq(sessions.id, oldest.id));

	logger.info({ snapshotId: oldest.snapshotId, sessionId: oldest.id }, "Deleted snapshot");

	return { deletedSnapshotId: oldest.snapshotId };
}

// ============================================
// Retention Cleanup
// ============================================

/**
 * Get snapshots that have exceeded their retention period.
 */
export async function getExpiredSnapshots(
	orgId: string,
	plan: BillingPlan = "dev",
): Promise<SessionWithSnapshot[]> {
	const limits = PLAN_CONFIGS[plan];
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - limits.snapshotRetentionDays);

	const db = getDb();
	const results = (await db.query.sessions.findMany({
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
	})) as SessionWithSnapshot[];

	return results ?? [];
}

/**
 * Clean up expired snapshots for an organization.
 */
export async function cleanupExpiredSnapshots(
	orgId: string,
	plan: BillingPlan = "dev",
	deleteSnapshotFn?: (provider: string, snapshotId: string) => Promise<void>,
): Promise<{ deletedCount: number }> {
	const expired = await getExpiredSnapshots(orgId, plan);

	let deletedCount = 0;
	for (const session of expired) {
		if (!session.snapshotId) continue;

		// Delete from provider
		if (deleteSnapshotFn && session.sandboxProvider) {
			try {
				await deleteSnapshotFn(session.sandboxProvider, session.snapshotId);
			} catch (err) {
				getServicesLogger().child({ module: "snapshot-limits", orgId }).error({ err }, "Failed to delete expired snapshot");
				continue;
			}
		}

		// Clear reference
		const db = getDb();
		await db.update(sessions).set({ snapshotId: null }).where(eq(sessions.id, session.id));
		deletedCount++;
	}

	if (deletedCount > 0) {
		getServicesLogger().child({ module: "snapshot-limits", orgId }).info({ deletedCount }, "Cleaned up expired snapshots");
	}

	return { deletedCount };
}
