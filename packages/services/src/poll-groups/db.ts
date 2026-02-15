/**
 * Poll Groups DB operations.
 *
 * Manages trigger_poll_groups — shared polling schedules
 * that consolidate per-trigger BullMQ jobs into per-connection-group jobs.
 * Fetch events once per group, fan out in-memory to matching triggers.
 */

import { and, eq, getDb, isNull, triggerPollGroups, triggers } from "../db/client";
import type { InferSelectModel } from "../db/client";

export type PollGroupRow = InferSelectModel<typeof triggerPollGroups>;

// ============================================
// Queries
// ============================================

/**
 * Upsert a poll group for a given (provider, integrationId, orgId, cronExpression).
 * Returns the existing or newly created row.
 */
export async function upsert(input: {
	organizationId: string;
	provider: string;
	integrationId: string | null;
	cronExpression: string;
}): Promise<PollGroupRow> {
	const db = getDb();

	const conditions = [
		eq(triggerPollGroups.organizationId, input.organizationId),
		eq(triggerPollGroups.provider, input.provider),
		eq(triggerPollGroups.cronExpression, input.cronExpression),
		input.integrationId
			? eq(triggerPollGroups.integrationId, input.integrationId)
			: isNull(triggerPollGroups.integrationId),
	];

	const existing = await db.query.triggerPollGroups.findFirst({
		where: and(...conditions),
	});

	if (existing) return existing;

	const [created] = await db
		.insert(triggerPollGroups)
		.values({
			organizationId: input.organizationId,
			provider: input.provider,
			integrationId: input.integrationId,
			cronExpression: input.cronExpression,
		})
		.returning();

	return created;
}

/**
 * Find a poll group by ID.
 */
export async function findById(id: string): Promise<PollGroupRow | null> {
	const db = getDb();
	const result = await db.query.triggerPollGroups.findFirst({
		where: eq(triggerPollGroups.id, id),
	});
	return result ?? null;
}

/**
 * Find all enabled poll groups.
 */
export async function findAllEnabled(): Promise<PollGroupRow[]> {
	const db = getDb();
	return db.query.triggerPollGroups.findMany({
		where: eq(triggerPollGroups.enabled, true),
	});
}

/**
 * Find active polling triggers that belong to a poll group
 * (same provider, integrationId, and orgId).
 */
export async function findTriggersForGroup(group: PollGroupRow) {
	const db = getDb();

	const conditions = [
		eq(triggers.organizationId, group.organizationId),
		eq(triggers.provider, group.provider),
		eq(triggers.triggerType, "polling"),
		eq(triggers.enabled, true),
		group.integrationId
			? eq(triggers.integrationId, group.integrationId)
			: isNull(triggers.integrationId),
	];

	return db.query.triggers.findMany({
		where: and(...conditions),
		with: {
			integration: {
				columns: {
					id: true,
					provider: true,
					integrationId: true,
					connectionId: true,
					displayName: true,
					status: true,
				},
			},
		},
	});
}

/**
 * Update cursor and lastPolledAt for a poll group.
 */
export async function updateCursor(
	id: string,
	cursor: Record<string, unknown> | null,
): Promise<void> {
	const db = getDb();
	await db
		.update(triggerPollGroups)
		.set({
			cursor,
			lastPolledAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(triggerPollGroups.id, id));
}

/**
 * Check if a poll group still has any active polling triggers.
 * If not, delete it. Returns true if deleted.
 */
export async function removeIfEmpty(id: string): Promise<boolean> {
	const group = await findById(id);
	if (!group) return false;

	const activeTriggers = await findTriggersForGroup(group);
	if (activeTriggers.length === 0) {
		const db = getDb();
		await db.delete(triggerPollGroups).where(eq(triggerPollGroups.id, id));
		return true;
	}

	return false;
}

/**
 * Delete a poll group by ID.
 */
export async function deleteById(id: string): Promise<void> {
	const db = getDb();
	await db.delete(triggerPollGroups).where(eq(triggerPollGroups.id, id));
}

/**
 * Find a poll group matching a trigger's parameters.
 * Used to find which group a trigger belongs to.
 */
export async function findByTriggerParams(input: {
	organizationId: string;
	provider: string;
	integrationId: string | null;
	cronExpression: string;
}): Promise<PollGroupRow | null> {
	const db = getDb();

	const conditions = [
		eq(triggerPollGroups.organizationId, input.organizationId),
		eq(triggerPollGroups.provider, input.provider),
		eq(triggerPollGroups.cronExpression, input.cronExpression),
		input.integrationId
			? eq(triggerPollGroups.integrationId, input.integrationId)
			: isNull(triggerPollGroups.integrationId),
	];

	const result = await db.query.triggerPollGroups.findFirst({
		where: and(...conditions),
	});

	return result ?? null;
}
