import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

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

// ============================================
// Contract
// ============================================

export const schedulesContract = c.router(
	{
		get: {
			method: "GET",
			path: "/schedules/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			responses: {
				200: z.object({ schedule: ScheduleSchema }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get a schedule by ID",
		},

		update: {
			method: "PATCH",
			path: "/schedules/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: UpdateScheduleInputSchema,
			responses: {
				200: z.object({ schedule: ScheduleSchema }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Update a schedule",
		},

		delete: {
			method: "DELETE",
			path: "/schedules/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({ success: z.boolean() }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Delete a schedule",
		},
	},
	{
		pathPrefix: "/api",
	},
);
