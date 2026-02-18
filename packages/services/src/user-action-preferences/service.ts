/**
 * User action preferences — service layer.
 *
 * Thin wrapper over DB operations, consumed by oRPC routes and gateway.
 */

import * as db from "./db";

export type { UserActionPreferenceRow } from "./db";

// ============================================
// Reads
// ============================================

/**
 * List all preferences for a user in an org.
 */
export async function listPreferences(userId: string, orgId: string) {
	return db.listByUserAndOrg(userId, orgId);
}

/**
 * Get the set of source IDs the user has explicitly disabled.
 * Hot path — used by gateway pre-filter.
 */
export async function getDisabledSourceIds(userId: string, orgId: string): Promise<Set<string>> {
	return db.getDisabledSourceIds(userId, orgId);
}

// ============================================
// Writes
// ============================================

/**
 * Enable or disable an entire action source for a user.
 */
export async function setSourceEnabled(
	userId: string,
	orgId: string,
	sourceId: string,
	enabled: boolean,
) {
	return db.upsert(userId, orgId, sourceId, null, enabled);
}

/**
 * Enable or disable a specific action within a source for a user.
 */
export async function setActionEnabled(
	userId: string,
	orgId: string,
	sourceId: string,
	actionId: string,
	enabled: boolean,
) {
	return db.upsert(userId, orgId, sourceId, actionId, enabled);
}

/**
 * Bulk set preferences (for onboarding / batch toggle).
 */
export async function bulkSetPreferences(
	userId: string,
	orgId: string,
	prefs: Array<{ sourceId: string; actionId?: string | null; enabled: boolean }>,
) {
	return db.bulkUpsert(userId, orgId, prefs);
}

/**
 * Reset all preferences for a user in an org (back to "all enabled" default).
 */
export async function resetPreferences(userId: string, orgId: string) {
	return db.deleteByUserAndOrg(userId, orgId);
}
