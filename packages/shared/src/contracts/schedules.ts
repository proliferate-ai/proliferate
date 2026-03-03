import { z } from "zod";

// ============================================
// Schemas
// ============================================

export const ScheduleSchema = z.object({
	id: z.string().uuid(),
	organization_id: z.string(),
	automation_id: z.string().uuid(),
	name: z.string().nullable(),
	cron_expression: z.string(),
	timezone: z.string().nullable(),
	enabled: z.boolean().nullable(),
	last_run_at: z.string().nullable(),
	next_run_at: z.string().nullable(),
	created_at: z.string().nullable(),
	updated_at: z.string().nullable(),
	created_by: z.string().nullable(),
});

export type Schedule = z.infer<typeof ScheduleSchema>;

export const UpdateScheduleInputSchema = z.object({
	name: z.string().optional(),
	cronExpression: z.string().optional(),
	timezone: z.string().optional(),
	enabled: z.boolean().optional(),
});

export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInputSchema>;
