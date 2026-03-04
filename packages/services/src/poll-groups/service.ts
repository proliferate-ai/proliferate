/**
 * Trigger Poll Groups service.
 *
 * Thin service wrappers over DB operations for the poll group fan-out pattern.
 */

import * as pollGroupsDb from "./db";

export type { TriggerPollGroupRow, DeletedPollGroup } from "./db";

/**
 * Find or create a poll group for the given org+provider+integration.
 */
export async function findOrCreateGroup(
	orgId: string,
	provider: string,
	integrationId: string | null,
	cronExpression: string,
) {
	return pollGroupsDb.findOrCreateGroup(orgId, provider, integrationId, cronExpression);
}

/**
 * List all enabled poll groups for scheduling.
 */
export async function listEnabledGroups() {
	return pollGroupsDb.listEnabledGroups();
}

/**
 * Find a poll group by ID.
 */
export async function findGroupById(groupId: string) {
	return pollGroupsDb.findGroupById(groupId);
}

/**
 * Find all active polling triggers that belong to a poll group.
 */
export async function findTriggersForGroup(
	orgId: string,
	provider: string,
	integrationId: string | null,
) {
	return pollGroupsDb.findTriggersForGroup(orgId, provider, integrationId);
}

/**
 * Update the cursor and last-polled timestamp for a poll group.
 */
export async function updateGroupCursor(groupId: string, cursor: unknown, lastPolledAt: Date) {
	return pollGroupsDb.updateGroupCursor(groupId, cursor, lastPolledAt);
}

/**
 * Delete orphaned poll groups with no matching active triggers.
 */
export async function deleteOrphanedGroups() {
	return pollGroupsDb.deleteOrphanedGroups();
}
