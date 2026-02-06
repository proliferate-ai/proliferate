/**
 * Schedules service.
 *
 * Business logic that orchestrates DB operations.
 */

import type { Schedule } from "@proliferate/shared/contracts";
import type { CreateScheduleInput, UpdateScheduleInput } from "../types/schedules";
import * as schedulesDb from "./db";
import { toSchedule, toSchedules } from "./mapper";

// ============================================
// Validation helpers
// ============================================

/**
 * Validate cron expression (basic validation: 5-6 fields).
 */
export function validateCronExpression(cronExpression: string): boolean {
	const cronParts = cronExpression.trim().split(/\s+/);
	return cronParts.length >= 5 && cronParts.length <= 6;
}

// ============================================
// Service functions
// ============================================

/**
 * Get a schedule by ID.
 */
export async function getSchedule(id: string, orgId: string): Promise<Schedule | null> {
	const row = await schedulesDb.findById(id, orgId);
	if (!row) return null;
	return toSchedule(row);
}

/**
 * List schedules for an automation.
 */
export async function listSchedules(automationId: string): Promise<Schedule[]> {
	const rows = await schedulesDb.listByAutomation(automationId);
	return toSchedules(rows);
}

/**
 * Create a new schedule.
 */
export async function createSchedule(
	automationId: string,
	orgId: string,
	userId: string,
	input: CreateScheduleInput,
): Promise<Schedule> {
	// Validate cron expression
	if (!validateCronExpression(input.cronExpression)) {
		throw new Error("Invalid cron expression. Expected 5 or 6 fields.");
	}

	const row = await schedulesDb.create({
		automationId,
		organizationId: orgId,
		name: input.name,
		cronExpression: input.cronExpression,
		timezone: input.timezone,
		enabled: input.enabled,
		createdBy: userId,
	});

	return toSchedule(row);
}

/**
 * Update a schedule.
 */
export async function updateSchedule(
	id: string,
	orgId: string,
	input: UpdateScheduleInput,
): Promise<Schedule> {
	// Validate cron expression if provided
	if (input.cronExpression && !validateCronExpression(input.cronExpression)) {
		throw new Error("Invalid cron expression. Expected 5 or 6 fields.");
	}

	const row = await schedulesDb.update(id, orgId, {
		name: input.name,
		cronExpression: input.cronExpression,
		timezone: input.timezone,
		enabled: input.enabled,
	});

	return toSchedule(row);
}

/**
 * Delete a schedule.
 */
export async function deleteSchedule(id: string, orgId: string): Promise<boolean> {
	await schedulesDb.deleteById(id, orgId);
	return true;
}
