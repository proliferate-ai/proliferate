/**
 * Trigger Poll Groups DB operations.
 *
 * Raw Drizzle queries for the poll group fan-out pattern.
 * Groups polling triggers by (org + provider + integration) for efficient
 * batch polling — one API call per group, then in-memory fan-out to all triggers.
 */

import { and, eq, getDb, sql, triggerPollGroups, triggers } from "../db/client";
import type { InferSelectModel } from "../db/client";

export type TriggerPollGroupRow = InferSelectModel<typeof triggerPollGroups>;

// ============================================
// CRUD
// ============================================

/**
 * Find or create a poll group for the given org+provider+integration.
 * Uses INSERT ... ON CONFLICT for atomic upsert.
 */
export async function findOrCreateGroup(
	orgId: string,
	provider: string,
	integrationId: string | null,
	cronExpression: string,
): Promise<TriggerPollGroupRow> {
	const db = getDb();

	// Try to find existing group first
	const conditions = [
		eq(triggerPollGroups.organizationId, orgId),
		eq(triggerPollGroups.provider, provider),
	];
	if (integrationId) {
		conditions.push(eq(triggerPollGroups.integrationId, integrationId));
	} else {
		conditions.push(sql`${triggerPollGroups.integrationId} IS NULL`);
	}

	const existing = await db
		.select()
		.from(triggerPollGroups)
		.where(and(...conditions))
		.limit(1);

	if (existing.length > 0) {
		return existing[0];
	}

	const [row] = await db
		.insert(triggerPollGroups)
		.values({
			organizationId: orgId,
			provider,
			integrationId: integrationId ?? undefined,
			cronExpression,
			enabled: true,
		})
		.returning();

	return row;
}

/**
 * List all enabled poll groups for scheduling.
 */
export async function listEnabledGroups(): Promise<TriggerPollGroupRow[]> {
	const db = getDb();
	return db.select().from(triggerPollGroups).where(eq(triggerPollGroups.enabled, true));
}

/**
 * Find a poll group by ID.
 */
export async function findGroupById(groupId: string): Promise<TriggerPollGroupRow | null> {
	const db = getDb();
	const rows = await db
		.select()
		.from(triggerPollGroups)
		.where(eq(triggerPollGroups.id, groupId))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Find all active polling triggers that belong to a poll group.
 * Matches by org + provider + integrationId.
 */
export async function findTriggersForGroup(
	orgId: string,
	provider: string,
	integrationId: string | null,
): Promise<Array<InferSelectModel<typeof triggers>>> {
	const db = getDb();

	const conditions = [
		eq(triggers.organizationId, orgId),
		eq(triggers.provider, provider),
		eq(triggers.triggerType, "polling"),
		eq(triggers.enabled, true),
	];

	if (integrationId) {
		conditions.push(eq(triggers.integrationId, integrationId));
	} else {
		conditions.push(sql`${triggers.integrationId} IS NULL`);
	}

	return db
		.select()
		.from(triggers)
		.where(and(...conditions));
}

/**
 * Update the cursor and last-polled timestamp for a poll group.
 */
export async function updateGroupCursor(
	groupId: string,
	cursor: unknown,
	lastPolledAt: Date,
): Promise<void> {
	const db = getDb();
	await db
		.update(triggerPollGroups)
		.set({
			cursor: cursor as Record<string, unknown>,
			lastPolledAt,
			updatedAt: new Date(),
		})
		.where(eq(triggerPollGroups.id, groupId));
}

/**
 * Delete orphaned poll groups — groups with no matching active triggers.
 * Called after trigger deletion to clean up empty groups.
 */
export async function deleteOrphanedGroups(): Promise<number> {
	const db = getDb();
	const result = await db.execute<{ id: string }>(sql`
		DELETE FROM trigger_poll_groups
		WHERE id NOT IN (
			SELECT DISTINCT tpg.id
			FROM trigger_poll_groups tpg
			INNER JOIN triggers t ON (
				t.organization_id = tpg.organization_id
				AND t.provider = tpg.provider
				AND (
					(t.integration_id IS NULL AND tpg.integration_id IS NULL)
					OR t.integration_id = tpg.integration_id
				)
				AND t.trigger_type = 'polling'
				AND t.enabled = true
			)
		)
		RETURNING id
	`);
	return [...result].length;
}
