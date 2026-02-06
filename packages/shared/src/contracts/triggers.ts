import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// Schemas
// ============================================

export const TriggerTypeSchema = z.enum(["webhook", "polling"]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const ExecutionModeSchema = z.enum(["auto", "queue"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const TriggerProviderSchema = z.enum([
	"linear",
	"sentry",
	"github",
	"posthog",
	"gmail",
	"webhook",
	"scheduled",
	"custom",
]);
export type TriggerProvider = z.infer<typeof TriggerProviderSchema>;

/**
 * Integration reference included with triggers.
 */
export const TriggerIntegrationSchema = z.object({
	id: z.string().uuid(),
	provider: z.string(),
	integration_id: z.string().nullable(),
	connection_id: z.string().nullable(),
	display_name: z.string().nullable(),
	status: z.string().nullable(),
});

/**
 * Full trigger record schema.
 */
export const TriggerSchema = z.object({
	id: z.string().uuid(),
	organization_id: z.string(),
	automation_id: z.string().uuid(),
	name: z.string().nullable(),
	description: z.string().nullable(),
	trigger_type: z.string(),
	provider: z.string(),
	enabled: z.boolean().nullable(),
	execution_mode: z.string().nullable(),
	allow_agentic_repo_selection: z.boolean().nullable(),
	agent_instructions: z.string().nullable(),
	webhook_url_path: z.string().nullable(),
	webhook_secret: z.string().nullable(),
	polling_cron: z.string().nullable(),
	polling_endpoint: z.string().nullable(),
	polling_state: z.record(z.unknown()).nullable(),
	last_polled_at: z.string().nullable(),
	repeat_job_key: z.string().nullable(),
	config: z.record(z.unknown()).nullable(),
	integration_id: z.string().nullable(),
	created_by: z.string().nullable(),
	created_at: z.string().nullable(),
	updated_at: z.string().nullable(),
});

export type Trigger = z.infer<typeof TriggerSchema>;

/**
 * Trigger with related integration data.
 */
export const TriggerWithIntegrationSchema = TriggerSchema.extend({
	integration: TriggerIntegrationSchema.nullable(),
	pendingEventCount: z.number().optional(),
});

export type TriggerWithIntegration = z.infer<typeof TriggerWithIntegrationSchema>;

/**
 * Input for creating a new trigger.
 */
export const CreateTriggerInputSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	triggerType: TriggerTypeSchema.optional(),
	provider: TriggerProviderSchema,
	executionMode: ExecutionModeSchema.optional(),
	defaultPrebuildId: z.string().uuid().optional(),
	allowAgenticRepoSelection: z.boolean().optional(),
	agentInstructions: z.string().optional(),
	pollingCron: z.string().optional(),
	pollingEndpoint: z.string().optional(),
	config: z.record(z.unknown()).optional(),
	integrationId: z.string().uuid().optional(),
});

export type CreateTriggerInput = z.infer<typeof CreateTriggerInputSchema>;

/**
 * Input for updating a trigger.
 */
export const UpdateTriggerInputSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	enabled: z.boolean().optional(),
	executionMode: ExecutionModeSchema.optional(),
	allowAgenticRepoSelection: z.boolean().optional(),
	agentInstructions: z.string().nullable().optional(),
	pollingCron: z.string().nullable().optional(),
	config: z.record(z.unknown()).optional(),
	integrationId: z.string().uuid().nullable().optional(),
});

export type UpdateTriggerInput = z.infer<typeof UpdateTriggerInputSchema>;

/**
 * Trigger info included with events.
 */
export const TriggerEventTriggerSchema = z.object({
	id: z.string().uuid(),
	name: z.string().nullable(),
	provider: z.string(),
});

/**
 * Session info included with events.
 */
export const TriggerEventSessionSchema = z.object({
	id: z.string().uuid(),
	title: z.string().nullable(),
	status: z.string().nullable(),
});

/**
 * Trigger event record schema.
 */
export const TriggerEventSchema = z.object({
	id: z.string().uuid(),
	trigger_id: z.string().uuid(),
	organization_id: z.string(),
	status: z.string().nullable(),
	raw_payload: z.record(z.unknown()),
	parsed_context: z.record(z.unknown()).nullable(),
	external_event_id: z.string().nullable(),
	provider_event_type: z.string().nullable(),
	dedup_key: z.string().nullable(),
	session_id: z.string().nullable(),
	error_message: z.string().nullable(),
	skip_reason: z.string().nullable(),
	processed_at: z.string().nullable(),
	created_at: z.string().nullable(),
});

export type TriggerEvent = z.infer<typeof TriggerEventSchema>;

/**
 * Trigger event with related data.
 */
export const TriggerEventWithRelationsSchema = TriggerEventSchema.extend({
	trigger: TriggerEventTriggerSchema.nullable(),
	session: TriggerEventSessionSchema.nullable(),
});

export type TriggerEventWithRelations = z.infer<typeof TriggerEventWithRelationsSchema>;

// ============================================
// Contract
// ============================================

export const triggersContract = c.router(
	{
		/**
		 * List all triggers for the current organization.
		 */
		list: {
			method: "GET",
			path: "/triggers",
			responses: {
				200: z.object({ triggers: z.array(TriggerWithIntegrationSchema) }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List all triggers for the organization",
		},

		/**
		 * Create a new trigger.
		 */
		create: {
			method: "POST",
			path: "/triggers",
			body: CreateTriggerInputSchema,
			responses: {
				200: z.object({
					trigger: TriggerSchema,
					webhookUrl: z.string().nullable(),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Create a new trigger",
		},

		/**
		 * Get a single trigger by ID.
		 */
		get: {
			method: "GET",
			path: "/triggers/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			responses: {
				200: z.object({
					trigger: TriggerWithIntegrationSchema,
					recentEvents: z.array(TriggerEventSchema),
					eventCounts: z.record(z.number()),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Get a single trigger by ID",
		},

		/**
		 * Update a trigger.
		 */
		update: {
			method: "PATCH",
			path: "/triggers/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: UpdateTriggerInputSchema,
			responses: {
				200: z.object({ trigger: TriggerSchema }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Update a trigger",
		},

		/**
		 * Delete a trigger.
		 */
		delete: {
			method: "DELETE",
			path: "/triggers/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({ deleted: z.boolean() }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Delete a trigger",
		},

		/**
		 * List trigger events.
		 */
		listEvents: {
			method: "GET",
			path: "/triggers/events",
			query: z.object({
				triggerId: z.string().uuid().optional(),
				status: z.string().optional(),
				limit: z.coerce.number().int().positive().max(100).optional(),
				offset: z.coerce.number().int().nonnegative().optional(),
			}),
			responses: {
				200: z.object({
					events: z.array(TriggerEventWithRelationsSchema),
					total: z.number(),
					limit: z.number(),
					offset: z.number(),
				}),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List trigger events",
		},

		/**
		 * Skip a queued trigger event.
		 */
		skipEvent: {
			method: "POST",
			path: "/triggers/events/:id/skip",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({
					skipped: z.boolean(),
					eventId: z.string().uuid(),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Skip a queued trigger event",
		},
	},
	{
		pathPrefix: "/api",
	},
);
