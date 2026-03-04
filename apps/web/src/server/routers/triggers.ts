/**
 * Triggers oRPC router.
 *
 * Handles trigger CRUD and event management operations.
 */

import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { schedules, triggers } from "@proliferate/services";
import {
	CreateTriggerInputSchema,
	TriggerEventSchema,
	TriggerEventWithRelationsSchema,
	TriggerProvidersResponseSchema,
	TriggerSchema,
	TriggerWithIntegrationSchema,
	UpdateTriggerInputSchema,
} from "@proliferate/shared/contracts/triggers";
import { z } from "zod";
import { orgProcedure, publicProcedure } from "./middleware";

function throwMappedTriggerError(err: unknown, fallbackMessage: string): never {
	if (err instanceof ORPCError) {
		throw err;
	}
	if (err instanceof triggers.TriggerConfigurationNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}
	if (err instanceof triggers.TriggerIntegrationNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}
	if (err instanceof triggers.TriggerEventNotQueueableError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}
	if (err instanceof triggers.TriggerServiceUnavailableError) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: err.message });
	}
	if (schedules.isCronValidationError(err)) {
		throw new ORPCError("BAD_REQUEST", { message: (err as Error).message });
	}
	throw new ORPCError("INTERNAL_SERVER_ERROR", { message: fallbackMessage });
}

export const triggersRouter = {
	/**
	 * List all available trigger providers from trigger-service.
	 */
	providers: publicProcedure
		.input(z.object({}).optional())
		.output(TriggerProvidersResponseSchema)
		.handler(async () => {
			try {
				return (await triggers.listProviders()) as z.infer<typeof TriggerProvidersResponseSchema>;
			} catch (error) {
				throwMappedTriggerError(error, "Failed to fetch trigger providers");
			}
		}),

	/**
	 * List all triggers for the current organization.
	 */
	list: orgProcedure
		.input(z.object({}).optional())
		.output(z.object({ triggers: z.array(TriggerWithIntegrationSchema) }))
		.handler(async ({ context }) => {
			const triggersList = await triggers.listTriggers(context.orgId);
			return { triggers: triggersList };
		}),

	/**
	 * Get a single trigger by ID with recent events and counts.
	 */
	get: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(
			z.object({
				trigger: TriggerWithIntegrationSchema,
				recentEvents: z.array(TriggerEventSchema),
				eventCounts: z.record(z.number()),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await triggers.getTrigger(input.id, context.orgId);
			if (!result) {
				throw new ORPCError("NOT_FOUND", { message: "Trigger not found" });
			}
			return result;
		}),

	/**
	 * Create a new trigger.
	 */
	create: orgProcedure
		.input(CreateTriggerInputSchema)
		.output(
			z.object({
				trigger: TriggerSchema,
				webhookUrl: z.string().nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await triggers.createTrigger({
					organizationId: context.orgId,
					userId: context.user.id,
					name: input.name,
					description: input.description,
					triggerType: input.triggerType,
					provider: input.provider,
					executionMode: input.executionMode,
					defaultConfigurationId: input.defaultConfigurationId,
					allowAgenticRepoSelection: input.allowAgenticRepoSelection,
					agentInstructions: input.agentInstructions,
					pollingCron: input.pollingCron,
					pollingEndpoint: input.pollingEndpoint,
					config: input.config,
					integrationId: input.integrationId,
					gatewayUrl: env.NEXT_PUBLIC_GATEWAY_URL,
				});
			} catch (error) {
				throwMappedTriggerError(error, "Failed to create trigger");
			}
		}),

	/**
	 * Update a trigger.
	 */
	update: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				...UpdateTriggerInputSchema.shape,
			}),
		)
		.output(z.object({ trigger: TriggerSchema }))
		.handler(async ({ input, context }) => {
			const { id, ...updateData } = input;
			try {
				const trigger = await triggers.updateTrigger(id, context.orgId, updateData);
				if (!trigger) {
					throw new ORPCError("NOT_FOUND", { message: "Trigger not found" });
				}
				return { trigger };
			} catch (error) {
				throwMappedTriggerError(error, "Failed to update trigger");
			}
		}),

	/**
	 * Delete a trigger.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ deleted: z.boolean() }))
		.handler(async ({ input, context }) => {
			await triggers.deleteTrigger(input.id, context.orgId);
			return { deleted: true };
		}),

	/**
	 * List trigger events with filters and pagination.
	 */
	listEvents: orgProcedure
		.input(
			z
				.object({
					triggerId: z.string().uuid().optional(),
					status: z.string().optional(),
					limit: z.number().int().positive().max(100).optional(),
					offset: z.number().int().nonnegative().optional(),
				})
				.optional(),
		)
		.output(
			z.object({
				events: z.array(TriggerEventWithRelationsSchema),
				total: z.number(),
				limit: z.number(),
				offset: z.number(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await triggers.listTriggerEvents(context.orgId, {
				triggerId: input?.triggerId,
				status: input?.status,
				limit: input?.limit,
				offset: input?.offset,
			});
			return result;
		}),

	/**
	 * Skip a queued trigger event.
	 */
	skipEvent: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(
			z.object({
				skipped: z.boolean(),
				eventId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const result = await triggers.skipTriggerEvent(input.id, context.orgId);
				if (!result) {
					throw new ORPCError("NOT_FOUND", { message: "Event not found" });
				}
				return result;
			} catch (error) {
				throwMappedTriggerError(error, "Failed to skip trigger event");
			}
		}),
};
