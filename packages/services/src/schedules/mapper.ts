/**
 * Schedules mapper.
 *
 * Transforms DB rows to API types.
 */

import type { Schedule } from "@proliferate/shared/contracts";
import { toIsoString } from "../db/serialize";
import type { ScheduleRow } from "./db";

/**
 * Transform a DB row to Schedule type.
 */
export function toSchedule(row: ScheduleRow): Schedule {
	return {
		id: row.id,
		organization_id: row.organizationId,
		automation_id: row.automationId,
		name: row.name,
		cron_expression: row.cronExpression,
		timezone: row.timezone ?? "UTC",
		enabled: row.enabled ?? true,
		last_run_at: toIsoString(row.lastRunAt),
		next_run_at: toIsoString(row.nextRunAt),
		created_at: toIsoString(row.createdAt) ?? "",
		updated_at: toIsoString(row.updatedAt) ?? "",
		created_by: row.createdBy,
	};
}

/**
 * Transform multiple DB rows to Schedule types.
 */
export function toSchedules(rows: ScheduleRow[]): Schedule[] {
	return rows.map(toSchedule);
}
