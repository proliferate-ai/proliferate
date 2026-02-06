/**
 * Schedules DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import type { InferSelectModel } from "@proliferate/db";
import { and, eq, getDb, schedules } from "../db/client";
import type { CreateScheduleDbInput, UpdateScheduleDbInput } from "../types/schedules";

// Type alias for Drizzle model
export type ScheduleRow = InferSelectModel<typeof schedules>;

// ============================================
// Queries
// ============================================

/**
 * Get a schedule by ID.
 */
export async function findById(id: string, orgId: string): Promise<ScheduleRow | null> {
	const db = getDb();
	const result = await db.query.schedules.findFirst({
		where: and(eq(schedules.id, id), eq(schedules.organizationId, orgId)),
	});
	return result ?? null;
}

/**
 * List schedules for an automation.
 */
export async function listByAutomation(automationId: string): Promise<ScheduleRow[]> {
	const db = getDb();
	const results = await db.query.schedules.findMany({
		where: eq(schedules.automationId, automationId),
	});
	return results;
}

/**
 * Create a new schedule.
 */
export async function create(input: CreateScheduleDbInput): Promise<ScheduleRow> {
	const db = getDb();
	const [result] = await db
		.insert(schedules)
		.values({
			automationId: input.automationId,
			organizationId: input.organizationId,
			name: input.name || null,
			cronExpression: input.cronExpression,
			timezone: input.timezone || "UTC",
			enabled: input.enabled ?? true,
			createdBy: input.createdBy,
		})
		.returning();

	return result;
}

/**
 * Update a schedule.
 */
export async function update(
	id: string,
	orgId: string,
	input: UpdateScheduleDbInput,
): Promise<ScheduleRow> {
	const db = getDb();
	const updates: Partial<typeof schedules.$inferInsert> = {
		updatedAt: new Date(),
	};

	if (input.name !== undefined) updates.name = input.name;
	if (input.cronExpression !== undefined) updates.cronExpression = input.cronExpression;
	if (input.timezone !== undefined) updates.timezone = input.timezone;
	if (input.enabled !== undefined) updates.enabled = input.enabled;

	const [result] = await db
		.update(schedules)
		.set(updates)
		.where(and(eq(schedules.id, id), eq(schedules.organizationId, orgId)))
		.returning();

	return result;
}

/**
 * Delete a schedule.
 */
export async function deleteById(id: string, orgId: string): Promise<void> {
	const db = getDb();
	await db.delete(schedules).where(and(eq(schedules.id, id), eq(schedules.organizationId, orgId)));
}
