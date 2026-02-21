/**
 * Triggers oRPC router.
 *
 * Handles trigger CRUD and event management operations.
 */

import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { triggers } from "@proliferate/services";
import {
	CreateTriggerInputSchema,
	TriggerEventSchema,
	TriggerEventWithRelationsSchema,
	TriggerSchema,
	TriggerWithIntegrationSchema,
	UpdateTriggerInputSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { orgProcedure, publicProcedure } from "./middleware";

const TriggerProviderMetadataSchema = z.object({
	name: z.string(),
	description: z.string(),
	icon: z.string(),
});

const TriggerProviderInfoSchema = z.object({
	id: z.string(),
	provider: z.string(),
	triggerType: z.enum(["webhook", "polling"]).optional(),
	metadata: TriggerProviderMetadataSchema,
	configSchema: z.unknown(),
});

const TriggerProvidersResponseSchema = z.object({
	providers: z.record(TriggerProviderInfoSchema),
});

export const triggersRouter = {
	/**
	 * List all available trigger providers from trigger-service.
	 */
	providers: publicProcedure
		.input(z.object({}).optional())
		.output(TriggerProvidersResponseSchema)
		.handler(async () => {
			if (!env.TRIGGER_SERVICE_URL) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Trigger service not configured",
				});
			}

			const baseUrl = env.TRIGGER_SERVICE_URL.replace(/\/$/, "");
			const response = await fetch(`${baseUrl}/providers`, {
				headers: { "Content-Type": "application/json" },
				cache: "no-store",
				signal: AbortSignal.timeout(30_000),
			});

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: text || "Failed to fetch trigger providers",
				});
			}

			return (await response.json()) as z.infer<typeof TriggerProvidersResponseSchema>;
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
				const result = await triggers.createTrigger({
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
				return result;
			} catch (error) {
				if (error instanceof Error) {
					if (error.message === "Configuration not found") {
						throw new ORPCError("NOT_FOUND", { message: "Configuration not found" });
					}
					if (error.message === "Integration not found") {
						throw new ORPCError("NOT_FOUND", { message: "Integration not found" });
					}
					if (
						error.message === "Scheduled triggers require pollingCron" ||
						error.message.includes("Invalid cron expression")
					) {
						throw new ORPCError("BAD_REQUEST", { message: error.message });
					}
				}
				throw error;
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
				if (
					error instanceof Error &&
					(error.message === "Scheduled triggers require pollingCron" ||
						error.message.includes("Invalid cron expression"))
				) {
					throw new ORPCError("BAD_REQUEST", { message: error.message });
				}
				throw error;
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
				if (error instanceof Error && error.message.startsWith("Event is already")) {
					throw new ORPCError("BAD_REQUEST", { message: error.message });
				}
				throw error;
			}
		}),
};
