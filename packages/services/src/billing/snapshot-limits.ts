/**
 * Snapshot quota management.
 *
 * Snapshots are FREE within quota (no credits).
 * Count limits apply per plan, and a global retention cap
 * (SNAPSHOT_RETENTION_DAYS, default 14) ensures stale snapshots
 * are evicted opportunistically.
 *
 * Delete contract: DB snapshot references are ONLY cleared after
 * confirmed provider-side deletion. If no deleteSnapshotFn is provided,
 * the DB ref is preserved for later cleanup.
 */

import { env } from "@proliferate/environment/server";
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

export interface SnapshotCapacityResult {
	/** Whether there is room for a new snapshot */
	allowed: boolean;
	/** Snapshot that was evicted to make room (if any) */
	deletedSnapshotId: string | null;
}

// ============================================
// Retention
// ============================================

/**
 * Effective retention days: the stricter of plan config and global env cap.
 */
function getRetentionDays(plan?: BillingPlan): number {
	const globalCap = env.SNAPSHOT_RETENTION_DAYS;
	if (!plan) return globalCap;
	const planRetention = PLAN_CONFIGS[plan].snapshotRetentionDays;
	return Math.min(planRetention, globalCap);
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
 * Ensure org can create a snapshot by evicting at most ONE stale snapshot.
 *
 * Eviction priority:
 * 1. Oldest snapshot past the retention cap (min of plan and SNAPSHOT_RETENTION_DAYS).
 * 2. Oldest snapshot by pausedAt (regardless of age).
 *
 * Fail-closed: if eviction fails or no candidate is found, returns `{ allowed: false }`.
 * Callers should check `result.allowed` before proceeding with snapshot creation.
 *
 * DB refs are only cleared after confirmed provider deletion via deleteSnapshotFn.
 * If deleteSnapshotFn is not provided, the DB ref is preserved (no silent orphaning).
 */
export async function ensureSnapshotCapacity(
	orgId: string,
	plan: BillingPlan = "dev",
	deleteSnapshotFn?: (provider: string, snapshotId: string) => Promise<void>,
): Promise<SnapshotCapacityResult> {
	const { allowed, current, max } = await canCreateSnapshot(orgId, plan);

	if (allowed) {
		return { allowed: true, deletedSnapshotId: null };
	}

	const logger = getServicesLogger().child({ module: "snapshot-limits", orgId });
	logger.info({ current, max }, "At snapshot limit, attempting eviction");

	// Pass 1: try expired snapshots (past retention cap), oldest first
	const retentionDays = getRetentionDays(plan);
	const expired = await getExpiredSnapshots(orgId, retentionDays);

	for (const candidate of expired) {
		if (!candidate.snapshotId) continue;
		const result = await evictSnapshot(candidate, deleteSnapshotFn, logger);
		if (result) return { allowed: true, deletedSnapshotId: result.deletedSnapshotId };
	}

	// Pass 2: fall back to all snapshots by pausedAt (oldest first)
	const db = getDb();
	const allSnapshots = (await db.query.sessions.findMany({
		where: and(eq(sessions.organizationId, orgId), isNotNull(sessions.snapshotId)),
		columns: {
			id: true,
			snapshotId: true,
			sandboxProvider: true,
			pausedAt: true,
		},
		orderBy: [asc(sessions.pausedAt)],
		limit: 3, // Cap work in hot path
	})) as SessionWithSnapshot[];

	for (const candidate of allSnapshots) {
		if (!candidate.snapshotId) continue;
		const result = await evictSnapshot(candidate, deleteSnapshotFn, logger);
		if (result) return { allowed: true, deletedSnapshotId: result.deletedSnapshotId };
	}

	// Could not free capacity — fail-closed
	logger.warn({ current, max }, "Failed to evict snapshot, quota exceeded");
	return { allowed: false, deletedSnapshotId: null };
}

// ============================================
// Retention Cleanup
// ============================================

/**
 * Get snapshots that have exceeded a retention period.
 *
 * @param retentionDays - Override retention period.
 *   Defaults to global SNAPSHOT_RETENTION_DAYS env var.
 */
export async function getExpiredSnapshots(
	orgId: string,
	retentionDays?: number,
): Promise<SessionWithSnapshot[]> {
	const days = retentionDays ?? env.SNAPSHOT_RETENTION_DAYS;
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - days);

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
		orderBy: [asc(sessions.pausedAt)],
	})) as SessionWithSnapshot[];

	return results ?? [];
}

/**
 * Clean up expired snapshots for an organization (batch, for worker use).
 *
 * Uses the stricter of the plan retention and the global SNAPSHOT_RETENTION_DAYS cap.
 */
export async function cleanupExpiredSnapshots(
	orgId: string,
	plan: BillingPlan = "dev",
	deleteSnapshotFn?: (provider: string, snapshotId: string) => Promise<void>,
): Promise<{ deletedCount: number }> {
	const retentionDays = getRetentionDays(plan);
	const expired = await getExpiredSnapshots(orgId, retentionDays);

	let deletedCount = 0;
	const logger = getServicesLogger().child({ module: "snapshot-limits", orgId });

	for (const session of expired) {
		if (!session.snapshotId) continue;

		const result = await evictSnapshot(session, deleteSnapshotFn, logger);
		if (result) deletedCount++;
	}

	if (deletedCount > 0) {
		logger.info({ deletedCount, retentionDays }, "Cleaned up expired snapshots");
	}

	return { deletedCount };
}

/**
 * Clean up ALL expired snapshots across all orgs.
 *
 * Uses the global SNAPSHOT_RETENTION_DAYS cap (the binding constraint in practice,
 * since getRetentionDays returns min(planRetention, globalCap)).
 *
 * Designed for background worker use — bounded, idempotent, safe to run daily.
 */
export async function cleanupAllExpiredSnapshots(): Promise<{ deletedCount: number }> {
	const globalCap = env.SNAPSHOT_RETENTION_DAYS;
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - globalCap);

	const db = getDb();
	const expired = (await db.query.sessions.findMany({
		where: and(isNotNull(sessions.snapshotId), lt(sessions.pausedAt, cutoffDate)),
		columns: {
			id: true,
			snapshotId: true,
			sandboxProvider: true,
			pausedAt: true,
		},
		orderBy: [asc(sessions.pausedAt)],
		limit: 500, // Bound work per cycle
	})) as SessionWithSnapshot[];

	if (!expired.length) {
		return { deletedCount: 0 };
	}

	const logger = getServicesLogger().child({ module: "snapshot-cleanup" });
	let deletedCount = 0;

	for (const session of expired) {
		if (!session.snapshotId) continue;
		const result = await evictSnapshot(session, deleteSnapshotFromProvider, logger);
		if (result) deletedCount++;
	}

	if (deletedCount > 0) {
		logger.info({ deletedCount, retentionDays: globalCap }, "Global snapshot cleanup complete");
	}

	return { deletedCount };
}

// ============================================
// Provider-Side Cleanup
// ============================================

/**
 * Best-effort provider-side snapshot deletion.
 *
 * Currently a no-op: sandbox providers (Modal, E2B) do not expose snapshot
 * delete APIs. Provider-side resources auto-expire:
 * - Modal memory snapshots: 7-day TTL
 * - Modal filesystem snapshots: managed by Modal platform
 * - E2B: managed by E2B platform
 *
 * Resolving successfully allows eviction to proceed and clear the DB ref.
 * When providers add delete APIs, wire them here.
 */
export async function deleteSnapshotFromProvider(
	_provider: string,
	_snapshotId: string,
): Promise<void> {
	// No-op — provider-side resources auto-expire.
	// DB ref will be cleared by the caller (evictSnapshot).
}

// ============================================
// Internal Helpers
// ============================================

/**
 * Evict a single snapshot: delete from provider, then clear DB reference.
 *
 * Contract:
 * - If deleteSnapshotFn is provided and succeeds → clear DB ref.
 * - If deleteSnapshotFn is provided and fails → keep DB ref, return null.
 * - If deleteSnapshotFn is NOT provided → clear DB ref only if no provider
 *   is recorded (nothing to clean up). Otherwise keep DB ref.
 */
async function evictSnapshot(
	session: SessionWithSnapshot,
	deleteSnapshotFn: ((provider: string, snapshotId: string) => Promise<void>) | undefined,
	logger: {
		info: (...args: unknown[]) => void;
		warn: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	},
): Promise<{ deletedSnapshotId: string } | null> {
	if (!session.snapshotId) return null;

	if (session.sandboxProvider) {
		if (!deleteSnapshotFn) {
			// Can't confirm provider deletion — preserve DB ref for later cleanup
			logger.warn(
				{
					snapshotId: session.snapshotId,
					sessionId: session.id,
					provider: session.sandboxProvider,
				},
				"Skipping eviction: no deleteSnapshotFn provided, preserving DB ref",
			);
			return null;
		}

		try {
			await deleteSnapshotFn(session.sandboxProvider, session.snapshotId);
		} catch (err) {
			logger.error(
				{ err, snapshotId: session.snapshotId, sessionId: session.id },
				"Failed to delete snapshot from provider, keeping DB reference",
			);
			return null;
		}
	}

	// Clear snapshot reference in session
	const db = getDb();
	const snapshotId = session.snapshotId;
	await db.update(sessions).set({ snapshotId: null }).where(eq(sessions.id, session.id));

	logger.info({ snapshotId, sessionId: session.id }, "Evicted snapshot");
	return { deletedSnapshotId: snapshotId };
}
