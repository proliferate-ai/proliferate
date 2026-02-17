/**
 * User action preferences — DB operations.
 *
 * Stores per-user, per-org opt-out preferences for action sources.
 * Absence of a row means "enabled" (default). Only explicit changes are stored.
 */

import { and, eq, getDb, isNull, userActionPreferences } from "../db/client";

// ============================================
// Types
// ============================================

export type UserActionPreferenceRow = typeof userActionPreferences.$inferSelect;

// ============================================
// Queries
// ============================================

/**
 * List all preference rows for a user + org.
 */
export async function listByUserAndOrg(
	userId: string,
	orgId: string,
): Promise<UserActionPreferenceRow[]> {
	const db = getDb();
	return db.query.userActionPreferences.findMany({
		where: and(
			eq(userActionPreferences.userId, userId),
			eq(userActionPreferences.organizationId, orgId),
		),
		orderBy: (t, { asc }) => [asc(t.sourceId), asc(t.actionId)],
	});
}

/**
 * Get the set of source IDs that the user has explicitly disabled (source-level).
 * This is the hot-path query used by the gateway's GET /available pre-filter.
 */
export async function getDisabledSourceIds(userId: string, orgId: string): Promise<Set<string>> {
	const db = getDb();
	const rows = await db
		.select({ sourceId: userActionPreferences.sourceId })
		.from(userActionPreferences)
		.where(
			and(
				eq(userActionPreferences.userId, userId),
				eq(userActionPreferences.organizationId, orgId),
				isNull(userActionPreferences.actionId),
				eq(userActionPreferences.enabled, false),
			),
		);
	return new Set(rows.map((r) => r.sourceId));
}

/**
 * Upsert a single preference (source-level or action-level).
 */
export async function upsert(
	userId: string,
	orgId: string,
	sourceId: string,
	actionId: string | null,
	enabled: boolean,
): Promise<UserActionPreferenceRow> {
	const db = getDb();
	const [row] = await db
		.insert(userActionPreferences)
		.values({
			userId,
			organizationId: orgId,
			sourceId,
			actionId,
			enabled,
		})
		.onConflictDoUpdate({
			target: [
				userActionPreferences.userId,
				userActionPreferences.organizationId,
				userActionPreferences.sourceId,
				userActionPreferences.actionId,
			],
			set: {
				enabled,
				updatedAt: new Date(),
			},
		})
		.returning();
	return row;
}

/**
 * Bulk upsert preferences for a user + org.
 * Used by onboarding and bulk toggle flows.
 * Batch sizes are small (< 20 sources), so individual upserts in a transaction are fine.
 */
export async function bulkUpsert(
	userId: string,
	orgId: string,
	prefs: Array<{ sourceId: string; actionId?: string | null; enabled: boolean }>,
): Promise<void> {
	if (prefs.length === 0) return;

	const db = getDb();
	await db.transaction(async (tx) => {
		for (const p of prefs) {
			await tx
				.insert(userActionPreferences)
				.values({
					userId,
					organizationId: orgId,
					sourceId: p.sourceId,
					actionId: p.actionId ?? null,
					enabled: p.enabled,
				})
				.onConflictDoUpdate({
					target: [
						userActionPreferences.userId,
						userActionPreferences.organizationId,
						userActionPreferences.sourceId,
						userActionPreferences.actionId,
					],
					set: {
						enabled: p.enabled,
						updatedAt: new Date(),
					},
				});
		}
	});
}

/**
 * Delete all preferences for a user + org.
 * Resets to "all enabled" default state.
 */
export async function deleteByUserAndOrg(userId: string, orgId: string): Promise<void> {
	const db = getDb();
	await db
		.delete(userActionPreferences)
		.where(
			and(
				eq(userActionPreferences.userId, userId),
				eq(userActionPreferences.organizationId, orgId),
			),
		);
}
