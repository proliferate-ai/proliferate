/**
 * Schedules oRPC router.
 *
 * Handles schedule CRUD operations.
 */

import { ORPCError } from "@orpc/server";
import { schedules } from "@proliferate/services";
import { ScheduleSchema, UpdateScheduleInputSchema } from "@proliferate/shared";
import { z } from "zod";
import { orgProcedure } from "./middleware";

export const schedulesRouter = {
	/**
	 * Get a schedule by ID.
	 */
	get: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ schedule: ScheduleSchema }))
		.handler(async ({ input, context }) => {
			const schedule = await schedules.getSchedule(input.id, context.orgId);
			if (!schedule) {
				throw new ORPCError("NOT_FOUND", { message: "Schedule not found" });
			}
			return { schedule };
		}),

	/**
	 * Update a schedule.
	 */
	update: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				...UpdateScheduleInputSchema.shape,
			}),
		)
		.output(z.object({ schedule: ScheduleSchema }))
		.handler(async ({ input, context }) => {
			const { id, ...updateData } = input;

			try {
				const schedule = await schedules.updateSchedule(id, context.orgId, {
					name: updateData.name,
					cronExpression: updateData.cronExpression,
					timezone: updateData.timezone,
					enabled: updateData.enabled,
				});
				return { schedule };
			} catch (err) {
				if (schedules.isCronValidationError(err)) {
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				}
				throw new ORPCError("NOT_FOUND", { message: "Schedule not found" });
			}
		}),

	/**
	 * Delete a schedule.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await schedules.deleteSchedule(input.id, context.orgId);
			return { success: true };
		}),
};
