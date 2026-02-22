/**
 * Automations oRPC router.
 *
 * Handles automation CRUD, triggers, schedules, and events.
 */

import { GATEWAY_URL } from "@/lib/gateway";
import { ORPCError } from "@orpc/server";
import { automations, configurations, runs, schedules, templates } from "@proliferate/services";
import {
	AutomationConnectionSchema,
	AutomationEventDetailSchema,
	AutomationEventSchema,
	AutomationEventStatusSchema,
	AutomationListItemSchema,
	AutomationRunEventSchema,
	AutomationRunSchema,
	type AutomationRunStatus,
	AutomationRunStatusSchema,
	AutomationSchema,
	AutomationTriggerSchema,
	AutomationWithTriggersSchema,
	CreateAutomationInputSchema,
	CreateAutomationScheduleInputSchema,
	CreateAutomationTriggerInputSchema,
	PendingRunSummarySchema,
	ScheduleSchema,
	type TriggerProviderSchema,
	UpdateAutomationInputSchema,
} from "@proliferate/shared";
import { z } from "zod";
import { orgProcedure } from "./middleware";

export const automationsRouter = {
	/**
	 * List all automations for the current organization.
	 */
	list: orgProcedure
		.output(z.object({ automations: z.array(AutomationListItemSchema) }))
		.handler(async ({ context }) => {
			const automationsList = await automations.listAutomations(context.orgId);
			return { automations: automationsList };
		}),

	/**
	 * Get an automation with its triggers.
	 */
	get: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ automation: AutomationWithTriggersSchema }))
		.handler(async ({ input, context }) => {
			const automation = await automations.getAutomation(input.id, context.orgId);
			if (!automation) {
				throw new ORPCError("NOT_FOUND", { message: "Automation not found" });
			}
			return { automation };
		}),

	/**
	 * Create a new automation.
	 */
	create: orgProcedure
		.input(CreateAutomationInputSchema)
		.output(z.object({ automation: AutomationListItemSchema }))
		.handler(async ({ input, context }) => {
			try {
				let defaultConfigurationId = input.defaultConfigurationId;
				if (!defaultConfigurationId) {
					const orgConfigurations = await configurations.listConfigurations(context.orgId);
					const defaultConfig = orgConfigurations.find((c) => c.status === "default");
					const readyConfig = orgConfigurations.find((c) => c.status === "ready");
					const selectedConfig = defaultConfig ?? readyConfig;
					if (!selectedConfig) {
						throw new ORPCError("BAD_REQUEST", {
							message: "No ready configuration available. Please create a configuration first.",
						});
					}
					defaultConfigurationId = selectedConfig.id;
				}

				const automation = await automations.createAutomation(context.orgId, context.user.id, {
					name: input.name,
					description: input.description,
					agentInstructions: input.agentInstructions,
					defaultConfigurationId,
					allowAgenticRepoSelection: input.allowAgenticRepoSelection,
				});
				return { automation };
			} catch (err) {
				if (err instanceof ORPCError) throw err;
				if (err instanceof Error && err.message === "Configuration not found") {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to create automation",
				});
			}
		}),

	/**
	 * Create an automation from a template (single transaction).
	 */
	createFromTemplate: orgProcedure
		.input(
			z.object({
				templateId: z.string(),
				integrationBindings: z.record(z.string()),
			}),
		)
		.output(z.object({ automation: AutomationListItemSchema }))
		.handler(async ({ input, context }) => {
			// Validate template exists before hitting the service
			const template = templates.getTemplateById(input.templateId);
			if (!template) {
				throw new ORPCError("NOT_FOUND", { message: "Template not found" });
			}

			try {
				const automation = await automations.createFromTemplate(context.orgId, context.user.id, {
					templateId: input.templateId,
					integrationBindings: input.integrationBindings,
				});
				return { automation };
			} catch (err) {
				if (err instanceof Error) {
					if (err.message.includes("not found")) {
						throw new ORPCError("NOT_FOUND", { message: err.message });
					}
					if (
						err.message.includes("not active") ||
						err.message.includes("Missing required") ||
						err.message.includes("is for")
					) {
						throw new ORPCError("BAD_REQUEST", { message: err.message });
					}
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to create automation from template",
				});
			}
		}),

	/**
	 * Update an automation.
	 */
	update: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				...UpdateAutomationInputSchema.shape,
			}),
		)
		.output(z.object({ automation: AutomationSchema }))
		.handler(async ({ input, context }) => {
			const { id, ...updateData } = input;

			try {
				const automation = await automations.updateAutomation(id, context.orgId, {
					name: updateData.name,
					description: updateData.description,
					enabled: updateData.enabled,
					agentInstructions: updateData.agentInstructions,
					defaultConfigurationId: updateData.defaultConfigurationId,
					allowAgenticRepoSelection: updateData.allowAgenticRepoSelection,
					agentType: updateData.agentType,
					modelId: updateData.modelId,
					llmFilterPrompt: updateData.llmFilterPrompt,
					enabledTools: updateData.enabledTools as Record<string, unknown> | undefined,
					llmAnalysisPrompt: updateData.llmAnalysisPrompt,
					notificationDestinationType: updateData.notificationDestinationType,
					notificationChannelId: updateData.notificationChannelId,
					notificationSlackUserId: updateData.notificationSlackUserId,
					notificationSlackInstallationId: updateData.notificationSlackInstallationId,
					configSelectionStrategy: updateData.configSelectionStrategy,
					fallbackConfigurationId: updateData.fallbackConfigurationId,
					allowedConfigurationIds: updateData.allowedConfigurationIds,
				});
				return { automation };
			} catch (err) {
				if (err instanceof Error) {
					if (err.message === "Configuration not found") {
						throw new ORPCError("NOT_FOUND", { message: err.message });
					}
					if (
						err.message.includes("no snapshot") ||
						err.message.includes("agent_decide") ||
						err.message.includes("routing descriptions")
					) {
						throw new ORPCError("BAD_REQUEST", { message: err.message });
					}
				}
				throw new ORPCError("NOT_FOUND", { message: "Automation not found" });
			}
		}),

	/**
	 * Delete an automation.
	 */
	delete: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			await automations.deleteAutomation(input.id, context.orgId);
			return { success: true };
		}),

	/**
	 * List trigger events for an automation.
	 */
	listEvents: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				status: AutomationEventStatusSchema.optional(),
				limit: z.number().int().positive().max(100).optional(),
				offset: z.number().int().nonnegative().optional(),
			}),
		)
		.output(
			z.object({
				events: z.array(AutomationEventSchema),
				total: z.number(),
				limit: z.number(),
				offset: z.number(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const result = await automations.listAutomationEvents(input.id, context.orgId, {
					status: input.status,
					limit: input.limit,
					offset: input.offset,
				});
				return result;
			} catch (err) {
				if (err instanceof Error && err.message === "Automation not found") {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to fetch events",
				});
			}
		}),

	/**
	 * Get a specific trigger event.
	 */
	getEvent: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				eventId: z.string().uuid(),
			}),
		)
		.output(
			z.object({
				event: AutomationEventDetailSchema,
				automation: z.object({
					id: z.string().uuid(),
					name: z.string(),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await automations.getAutomationEvent(input.id, input.eventId, context.orgId);
			if (!result) {
				throw new ORPCError("NOT_FOUND", { message: "Event not found" });
			}
			return result;
		}),

	/**
	 * List triggers for an automation.
	 */
	listTriggers: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ triggers: z.array(AutomationTriggerSchema) }))
		.handler(async ({ input, context }) => {
			try {
				const triggers = await automations.listAutomationTriggers(
					input.id,
					context.orgId,
					GATEWAY_URL,
				);
				return { triggers };
			} catch (err) {
				if (err instanceof Error && err.message === "Automation not found") {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to fetch triggers",
				});
			}
		}),

	/**
	 * Create a trigger for an automation.
	 */
	createTrigger: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				...CreateAutomationTriggerInputSchema.shape,
			}),
		)
		.output(z.object({ trigger: AutomationTriggerSchema }))
		.handler(async ({ input, context }) => {
			const {
				id: automationId,
				provider,
				triggerType,
				integrationId,
				config,
				enabled,
				cronExpression,
			} = input;

			if (!provider) {
				throw new ORPCError("BAD_REQUEST", { message: "Provider is required" });
			}

			try {
				const trigger = await automations.createAutomationTrigger(
					automationId,
					context.orgId,
					context.user.id,
					{
						provider,
						triggerType,
						integrationId,
						config,
						enabled,
						cronExpression,
					},
					GATEWAY_URL,
				);
				return { trigger };
			} catch (err) {
				if (err instanceof Error) {
					if (err.message === "Automation not found") {
						throw new ORPCError("NOT_FOUND", { message: err.message });
					}
					if (err.message === "Integration not found") {
						throw new ORPCError("NOT_FOUND", { message: err.message });
					}
					if (schedules.isCronValidationError(err)) {
						throw new ORPCError("BAD_REQUEST", { message: err.message });
					}
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to create trigger",
				});
			}
		}),

	/**
	 * List schedules for an automation.
	 */
	listSchedules: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ schedules: z.array(ScheduleSchema) }))
		.handler(async ({ input, context }) => {
			// Verify automation belongs to org
			const exists = await automations.automationExists(input.id, context.orgId);
			if (!exists) {
				throw new ORPCError("NOT_FOUND", { message: "Automation not found" });
			}

			const scheduleList = await schedules.listSchedules(input.id);
			return { schedules: scheduleList };
		}),

	/**
	 * Create a schedule for an automation.
	 */
	createSchedule: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				...CreateAutomationScheduleInputSchema.shape,
			}),
		)
		.output(z.object({ schedule: ScheduleSchema }))
		.handler(async ({ input, context }) => {
			const { id: automationId, name, cronExpression, timezone, enabled } = input;

			if (!cronExpression) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Cron expression is required",
				});
			}

			// Verify automation exists
			const exists = await automations.automationExists(automationId, context.orgId);
			if (!exists) {
				throw new ORPCError("NOT_FOUND", { message: "Automation not found" });
			}

			try {
				const schedule = await schedules.createSchedule(
					automationId,
					context.orgId,
					context.user.id,
					{
						name,
						cronExpression,
						timezone,
						enabled,
					},
				);
				return { schedule };
			} catch (err) {
				if (schedules.isCronValidationError(err)) {
					throw new ORPCError("BAD_REQUEST", { message: err.message });
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to create schedule",
				});
			}
		}),

	/**
	 * List connections for an automation.
	 */
	listConnections: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ connections: z.array(AutomationConnectionSchema) }))
		.handler(async ({ input, context }) => {
			try {
				const connectionRows = await automations.listAutomationConnections(input.id, context.orgId);
				// Map to contract schema
				const connections = connectionRows.map((c) => ({
					id: c.id,
					automation_id: c.automationId,
					integration_id: c.integrationId,
					created_at: c.createdAt?.toISOString() ?? null,
					integration: c.integration
						? {
								id: c.integration.id,
								provider: c.integration.provider,
								integration_id: c.integration.integrationId,
								connection_id: c.integration.connectionId,
								display_name: c.integration.displayName,
								status: c.integration.status,
							}
						: null,
				}));
				return { connections };
			} catch (err) {
				if (err instanceof Error && err.message === "Automation not found") {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to fetch connections",
				});
			}
		}),

	/**
	 * Add a connection to an automation.
	 */
	addConnection: orgProcedure
		.input(z.object({ id: z.string().uuid(), integrationId: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await automations.addAutomationConnection(input.id, context.orgId, input.integrationId);
				return { success: true };
			} catch (err) {
				if (err instanceof Error) {
					if (err.message === "Automation not found") {
						throw new ORPCError("NOT_FOUND", { message: err.message });
					}
					if (err.message === "Integration not found") {
						throw new ORPCError("NOT_FOUND", { message: err.message });
					}
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to add connection",
				});
			}
		}),

	/**
	 * Remove a connection from an automation.
	 */
	removeConnection: orgProcedure
		.input(z.object({ id: z.string().uuid(), integrationId: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await automations.removeAutomationConnection(input.id, context.orgId, input.integrationId);
				return { success: true };
			} catch (err) {
				if (err instanceof Error && err.message === "Automation not found") {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to remove connection",
				});
			}
		}),

	// ============================================
	// Action Modes (per-automation overrides)
	// ============================================

	/**
	 * Get action modes for a specific automation.
	 */
	getActionModes: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ modes: z.record(z.enum(["allow", "require_approval", "deny"])) }))
		.handler(async ({ input, context }) => {
			try {
				const modes = await automations.getAutomationActionModes(input.id, context.orgId);
				return { modes };
			} catch (err) {
				if (err instanceof Error && err.message === "Automation not found") {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Set a single action mode entry on an automation.
	 */
	setActionMode: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				key: z.string(),
				mode: z.enum(["allow", "require_approval", "deny"]),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await automations.setAutomationActionMode(input.id, context.orgId, input.key, input.mode);
				return { success: true };
			} catch (err) {
				if (err instanceof Error && err.message === "Automation not found") {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw err;
			}
		}),

	// ============================================
	// Org-level pending runs (attention tray)
	// ============================================

	/**
	 * List runs needing attention across the org (failed, needs_human, timed_out).
	 * Used by the in-session attention tray.
	 */
	listOrgPendingRuns: orgProcedure
		.input(
			z
				.object({
					limit: z.number().int().positive().max(50).optional(),
					maxAgeDays: z.number().int().positive().max(30).optional(),
					unassignedOnly: z.boolean().optional(),
				})
				.optional(),
		)
		.output(z.object({ runs: z.array(PendingRunSummarySchema) }))
		.handler(async ({ input, context }) => {
			const pendingRuns = await runs.listOrgPendingRuns(context.orgId, {
				limit: input?.limit,
				maxAgeDays: input?.maxAgeDays,
				unassignedOnly: input?.unassignedOnly,
			});
			return {
				runs: pendingRuns.map((r) => ({
					id: r.id,
					automation_id: r.automationId,
					automation_name: r.automationName,
					status: r.status as "failed" | "needs_human" | "timed_out",
					status_reason: r.statusReason,
					error_message: r.errorMessage,
					session_id: r.sessionId,
					assigned_to: r.assignedTo,
					queued_at: r.queuedAt.toISOString(),
					completed_at: r.completedAt?.toISOString() ?? null,
				})),
			};
		}),

	// ============================================
	// Runs
	// ============================================

	/**
	 * List runs for an automation.
	 */
	listRuns: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				status: AutomationRunStatusSchema.optional(),
				limit: z.number().int().positive().max(100).optional(),
				offset: z.number().int().nonnegative().optional(),
			}),
		)
		.output(
			z.object({
				runs: z.array(AutomationRunSchema),
				total: z.number(),
			}),
		)
		.handler(async ({ input, context }) => {
			const exists = await automations.automationExists(input.id, context.orgId);
			if (!exists) {
				throw new ORPCError("NOT_FOUND", { message: "Automation not found" });
			}

			const result = await runs.listRunsForAutomation(input.id, context.orgId, {
				status: input.status,
				limit: input.limit,
				offset: input.offset,
			});

			return {
				runs: result.runs.map((run) => mapRunToSchema(run)),
				total: result.total,
			};
		}),

	/**
	 * Assign a run to the current user (claim).
	 */
	assignRun: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				runId: z.string().uuid(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const exists = await automations.automationExists(input.id, context.orgId);
			if (!exists) {
				throw new ORPCError("NOT_FOUND", { message: "Automation not found" });
			}

			try {
				const updated = await runs.assignRunToUser(input.runId, context.orgId, context.user.id);
				if (!updated) {
					throw new ORPCError("NOT_FOUND", { message: "Run not found" });
				}
				return { success: true };
			} catch (err) {
				if (err instanceof runs.RunAlreadyAssignedError) {
					throw new ORPCError("CONFLICT", { message: "Run already claimed" });
				}
				throw err;
			}
		}),

	/**
	 * Unassign a run (unclaim).
	 */
	unassignRun: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				runId: z.string().uuid(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const exists = await automations.automationExists(input.id, context.orgId);
			if (!exists) {
				throw new ORPCError("NOT_FOUND", { message: "Automation not found" });
			}

			const updated = await runs.unassignRun(input.runId, context.orgId);
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Run not found" });
			}
			return { success: true };
		}),

	/**
	 * List runs claimed by the current user (for sidebar).
	 */
	myClaimedRuns: orgProcedure
		.output(z.object({ runs: z.array(AutomationRunSchema) }))
		.handler(async ({ context }) => {
			const claimedRuns = await runs.listRunsAssignedToUser(context.user.id, context.orgId);
			return {
				runs: claimedRuns.map((run) => mapRunToSchema(run)),
			};
		}),

	/**
	 * Manually resolve a run (e.g., close a needs_human run).
	 * Allowed from: needs_human, failed, timed_out.
	 * Target: succeeded or failed.
	 */
	resolveRun: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				runId: z.string().uuid(),
				outcome: z.enum(["succeeded", "failed"]),
				reason: z.string().max(500).optional(),
				comment: z.string().max(2000).optional(),
			}),
		)
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const exists = await automations.automationExists(input.id, context.orgId);
			if (!exists) {
				throw new ORPCError("NOT_FOUND", { message: "Automation not found" });
			}

			try {
				const updated = await runs.resolveRun({
					runId: input.runId,
					automationId: input.id,
					orgId: context.orgId,
					userId: context.user.id,
					outcome: input.outcome,
					reason: input.reason,
					comment: input.comment,
				});
				if (!updated) {
					throw new ORPCError("NOT_FOUND", { message: "Run not found" });
				}
				return { success: true };
			} catch (err) {
				if (err instanceof runs.RunNotResolvableError) {
					throw new ORPCError("CONFLICT", {
						message: err.message,
					});
				}
				throw err;
			}
		}),

	// ============================================
	// Manual run trigger
	// ============================================

	/**
	 * Trigger a manual run for an automation.
	 * Creates a synthetic trigger event and kicks off the run pipeline.
	 */
	triggerManualRun: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ run: z.object({ id: z.string(), status: z.string() }) }))
		.handler(async ({ input, context }) => {
			try {
				const result = await automations.triggerManualRun(input.id, context.orgId, context.user.id);
				return { run: { id: result.runId, status: result.status } };
			} catch (err) {
				if (err instanceof Error && err.message === "Automation not found") {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw err;
			}
		}),

	// ============================================
	// Integration action resolver
	// ============================================

	/**
	 * Returns available integration actions for an automation.
	 * Based on enabled tools, triggers, and connections.
	 */
	getIntegrationActions: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(
			z.object({
				integrations: z.array(
					z.object({
						sourceId: z.string(),
						displayName: z.string(),
						actions: z.array(
							z.object({
								name: z.string(),
								description: z.string(),
								riskLevel: z.enum(["read", "write"]),
							}),
						),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			const integrationActions = await automations.getAutomationIntegrationActions(
				input.id,
				context.orgId,
			);
			return { integrations: integrationActions };
		}),

	// ============================================
	// Single run + events (investigation panel)
	// ============================================

	/**
	 * Get a single run by ID (org-scoped, no automationId required).
	 */
	getRun: orgProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.output(z.object({ run: AutomationRunSchema }))
		.handler(async ({ input, context }) => {
			const run = await runs.findRunForDisplay(input.runId, context.orgId);
			if (!run) {
				throw new ORPCError("NOT_FOUND", { message: "Run not found" });
			}
			return { run: mapRunToSchema(run) };
		}),

	/**
	 * List timeline events for a run (status transitions, milestones).
	 */
	listRunEvents: orgProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.output(z.object({ events: z.array(AutomationRunEventSchema) }))
		.handler(async ({ input, context }) => {
			const events = await runs.listRunEvents(input.runId, context.orgId);
			if (!events) {
				throw new ORPCError("NOT_FOUND", { message: "Run not found" });
			}
			return {
				events: events.map((e) => ({
					id: e.id,
					type: e.type,
					from_status: e.fromStatus ?? null,
					to_status: e.toStatus ?? null,
					data: (e.data as Record<string, unknown>) ?? null,
					created_at: (e.createdAt ?? new Date()).toISOString(),
				})),
			};
		}),

	// ============================================
	// Org-wide activity feed
	// ============================================

	/**
	 * List all runs across all automations in the org, paginated.
	 */
	listOrgRuns: orgProcedure
		.input(
			z
				.object({
					status: AutomationRunStatusSchema.optional(),
					limit: z.number().int().positive().max(100).optional(),
					offset: z.number().int().nonnegative().optional(),
				})
				.optional(),
		)
		.output(z.object({ runs: z.array(AutomationRunSchema), total: z.number() }))
		.handler(async ({ input, context }) => {
			const result = await runs.listOrgRuns(context.orgId, {
				status: input?.status,
				limit: input?.limit,
				offset: input?.offset,
			});
			return {
				runs: result.runs.map((run) => mapRunToSchema(run)),
				total: result.total,
			};
		}),
};

function mapRunToSchema(run: runs.RunListItem) {
	const parsedContext = run.triggerEvent?.parsedContext as Record<string, unknown> | null;
	return {
		id: run.id,
		automation_id: run.automationId,
		status: run.status as AutomationRunStatus,
		status_reason: run.statusReason,
		error_message: run.errorMessage,
		queued_at: run.queuedAt.toISOString(),
		completed_at: run.completedAt?.toISOString() ?? null,
		session_id: run.sessionId,
		assigned_to: run.assignedTo,
		assigned_at: run.assignedAt?.toISOString() ?? null,
		trigger_event: run.triggerEvent
			? {
					id: run.triggerEvent.id,
					parsed_context: parsedContext,
					provider_event_type: run.triggerEvent.providerEventType,
				}
			: null,
		trigger: run.trigger
			? {
					id: run.trigger.id,
					name: run.trigger.name,
					provider: run.trigger.provider as z.infer<typeof TriggerProviderSchema>,
				}
			: null,
		session: run.session
			? {
					id: run.session.id,
					title: run.session.title,
					status: run.session.status,
				}
			: null,
		assignee: run.assignee
			? {
					id: run.assignee.id,
					name: run.assignee.name,
					email: run.assignee.email,
					image: run.assignee.image,
				}
			: null,
		enrichment_json: (run.enrichmentJson as Record<string, unknown>) ?? null,
	};
}
