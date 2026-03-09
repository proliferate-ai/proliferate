/**
 * Automations oRPC router.
 *
 * Handles automation CRUD, triggers, schedules, and events.
 */

import { GATEWAY_INTERNAL_URL, GATEWAY_URL } from "@/lib/infra/gateway";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { getProviderActions } from "@proliferate/providers/providers/registry";
import {
	automations,
	integrations,
	orgs,
	runs,
	schedules,
	workerJobs,
	workers,
} from "@proliferate/services";
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
	CoworkerCapabilityInputSchema,
	CreateAutomationInputSchema,
	CreateAutomationScheduleInputSchema,
	CreateAutomationTriggerInputSchema,
	PendingRunSummarySchema,
	UpdateAutomationInputSchema,
} from "@proliferate/shared/contracts/automations";
import { ScheduleSchema } from "@proliferate/shared/contracts/schedules";
import type { TriggerProviderSchema } from "@proliferate/shared/contracts/triggers";
import { z } from "zod";
import { orgProcedure } from "./middleware";

async function assertRunResolvePermission(userId: string, orgId: string): Promise<void> {
	const role = await orgs.getUserRole(userId, orgId);
	if (role !== "owner" && role !== "admin") {
		throw new ORPCError("FORBIDDEN", {
			message: "Only admins and owners can resolve runs",
		});
	}
}

function throwAutomationORPCError(err: unknown, fallbackMessage: string): never {
	if (err instanceof ORPCError) {
		throw err;
	}
	if (err instanceof automations.AutomationNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}
	if (err instanceof automations.AutomationIntegrationNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}
	if (err instanceof automations.AutomationValidationError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}
	if (
		err instanceof automations.TemplateIntegrationInactiveError ||
		err instanceof automations.TemplateIntegrationBindingMismatchError
	) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}
	if (
		err instanceof automations.TemplateNotFoundError ||
		err instanceof automations.TemplateIntegrationNotFoundError
	) {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}
	if (schedules.isCronValidationError(err)) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}
	if (err instanceof runs.RunAlreadyAssignedError || err instanceof runs.RunNotResolvableError) {
		throw new ORPCError("CONFLICT", { message: err.message });
	}
	if (err instanceof workers.WorkerNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: "Worker not found" });
	}
	if (
		err instanceof workers.WorkerResumeRequiredError ||
		err instanceof workers.WorkerNotActiveError
	) {
		throw new ORPCError("CONFLICT", { message: err.message });
	}
	if (err instanceof workerJobs.WorkerJobNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: err.message });
	}
	if (err instanceof workerJobs.WorkerJobValidationError) {
		throw new ORPCError("BAD_REQUEST", { message: err.message });
	}

	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message: fallbackMessage,
	});
}

type AutomationUpdatePayload = z.infer<typeof UpdateAutomationInputSchema>;

function toAutomationUpdateInput(
	input: AutomationUpdatePayload,
): automations.UpdateAutomationInput {
	return {
		...input,
		enabledTools: input.enabledTools as Record<string, unknown> | undefined,
	};
}

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
				const automation = await automations.createAutomationForOrg(
					context.orgId,
					context.user.id,
					input,
				);
				return { automation };
			} catch (err) {
				throwAutomationORPCError(err, "Failed to create automation");
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
		.output(
			z.object({
				worker: z.object({
					id: z.string().uuid(),
					name: z.string(),
					status: z.string(),
					description: z.string().nullable(),
					systemPrompt: z.string().nullable(),
					modelId: z.string().nullable(),
					managerSessionId: z.string().uuid(),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const worker = await workers.createWorkerFromTemplate({
					organizationId: context.orgId,
					createdBy: context.user.id,
					templateId: input.templateId,
					integrationBindings: input.integrationBindings,
				});
				return {
					worker: {
						id: worker.id,
						name: worker.name,
						status: worker.status,
						description: worker.description,
						systemPrompt: worker.systemPrompt,
						modelId: worker.modelId,
						managerSessionId: worker.managerSessionId,
					},
				};
			} catch (err) {
				throwAutomationORPCError(err, "Failed to create worker from template");
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
				const automation = await automations.updateAutomation(
					id,
					context.orgId,
					toAutomationUpdateInput(updateData),
				);
				return { automation };
			} catch (err) {
				throwAutomationORPCError(err, "Failed to update automation");
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
				throwAutomationORPCError(err, "Failed to fetch events");
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
				throwAutomationORPCError(err, "Failed to fetch triggers");
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
				throwAutomationORPCError(err, "Failed to create trigger");
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
				throwAutomationORPCError(err, "Failed to fetch connections");
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
				throwAutomationORPCError(err, "Failed to add connection");
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
				throwAutomationORPCError(err, "Failed to remove connection");
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
				throwAutomationORPCError(err, "Failed to fetch action modes");
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
				throwAutomationORPCError(err, "Failed to set action mode");
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
				const updated = await runs.assignRunToUser(
					input.runId,
					context.orgId,
					context.user.id,
					input.id,
				);
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

			const updated = await runs.unassignRun(input.runId, context.orgId, input.id);
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
			await assertRunResolvePermission(context.user.id, context.orgId);

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
				throwAutomationORPCError(err, "Failed to trigger manual run");
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

	/**
	 * Returns available provider actions for the org's connected integrations.
	 * Used in the create coworker dialog (no session required).
	 */
	getOrgAvailableActions: orgProcedure
		.output(
			z.object({
				integrations: z.array(
					z.object({
						integrationId: z.string(),
						integration: z.string(),
						displayName: z.string(),
						actions: z.array(
							z.object({
								name: z.string(),
								description: z.string(),
								riskLevel: z.enum(["read", "write", "danger"]),
							}),
						),
					}),
				),
			}),
		)
		.handler(async ({ context }) => {
			// Connector tools are session-scoped (bound at runtime), not org-scoped,
			// so they're intentionally excluded from this org-level action selector.
			const activeIntegrations = await integrations.listActiveIntegrationsForOrganization(
				context.orgId,
			);

			const result = activeIntegrations.flatMap((entry) => {
				const module = getProviderActions(entry.integrationId);
				if (!module) return [];
				return [
					{
						integrationId: entry.id,
						integration: entry.integrationId,
						displayName: entry.displayName ?? entry.integrationId,
						actions: module.actions.map((a) => ({
							name: a.id,
							description: a.description,
							riskLevel: a.riskLevel,
						})),
					},
				];
			});

			return { integrations: result };
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

	// ============================================
	// Workers (Coworker UI)
	// ============================================

	/**
	 * Create a new worker (coworker) with its manager session.
	 *
	 * Uses a 3-step process to handle the circular FK between workers and sessions:
	 * 1. Create a placeholder session (kind=null)
	 * 2. Create the worker referencing that session
	 * 3. Promote the session to kind='manager' with the worker ID
	 */
	createWorker: orgProcedure
		.input(
			z.object({
				name: z.string().min(1).max(200).optional(),
				description: z.string().max(1000).optional(),
				systemPrompt: z.string().max(5000).optional(),
				modelId: z.string().optional(),
				repoId: z.string().uuid().optional(),
				configurationId: z.string().uuid().optional(),
				capabilities: z.array(CoworkerCapabilityInputSchema).max(100).optional(),
			}),
		)
		.output(
			z.object({
				worker: z.object({
					id: z.string().uuid(),
					name: z.string(),
					status: z.string(),
					description: z.string().nullable(),
					systemPrompt: z.string().nullable(),
					modelId: z.string().nullable(),
					managerSessionId: z.string().uuid(),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			const worker = await workers.createWorkerWithManagerSession({
				organizationId: context.orgId,
				createdBy: context.user.id,
				name: input?.name,
				description: input?.description,
				systemPrompt: input?.systemPrompt,
				modelId: input?.modelId,
				repoId: input?.repoId,
				configurationId: input?.configurationId,
				capabilities: input?.capabilities,
			});
			return {
				worker: {
					id: worker.id,
					name: worker.name,
					status: worker.status,
					description: worker.description,
					systemPrompt: worker.systemPrompt,
					modelId: worker.modelId,
					managerSessionId: worker.managerSessionId,
				},
			};
		}),

	/**
	 * List all workers for the org with aggregate counts.
	 */
	listWorkers: orgProcedure
		.output(
			z.object({
				workers: z.array(
					z.object({
						id: z.string().uuid(),
						name: z.string(),
						status: z.string(),
						description: z.string().nullable(),
						systemPrompt: z.string().nullable(),
						modelId: z.string().nullable(),
						managerSessionId: z.string().uuid(),
						lastErrorCode: z.string().nullable(),
						pausedAt: z.coerce.date().nullable(),
						createdAt: z.coerce.date(),
						updatedAt: z.coerce.date(),
						activeTaskCount: z.number(),
						pendingApprovalCount: z.number(),
					}),
				),
			}),
		)
		.handler(async ({ context }) => {
			const workersList = await workers.listWorkersForOrg(context.orgId);
			return {
				workers: workersList.map((w) => ({
					id: w.id,
					name: w.name,
					status: w.status,
					description: w.description,
					systemPrompt: w.systemPrompt,
					modelId: w.modelId,
					managerSessionId: w.managerSessionId,
					lastErrorCode: w.lastErrorCode,
					pausedAt: w.pausedAt,
					createdAt: w.createdAt,
					updatedAt: w.updatedAt,
					activeTaskCount: w.activeTaskCount,
					pendingApprovalCount: w.pendingApprovalCount,
				})),
			};
		}),

	/**
	 * Get a single worker by ID with org check.
	 */
	getWorker: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(
			z.object({
				worker: z.object({
					id: z.string().uuid(),
					name: z.string(),
					status: z.string(),
					description: z.string().nullable(),
					systemPrompt: z.string().nullable(),
					modelId: z.string().nullable(),
					managerSessionId: z.string().uuid(),
					lastErrorCode: z.string().nullable(),
					pausedAt: z.coerce.date().nullable(),
					createdBy: z.string().nullable(),
					computeProfile: z.string().nullable(),
					pausedBy: z.string().nullable(),
					createdAt: z.coerce.date(),
					updatedAt: z.coerce.date(),
					activeTaskCount: z.number(),
					pendingApprovalCount: z.number(),
					capabilities: z.array(CoworkerCapabilityInputSchema),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			let worker: Awaited<ReturnType<typeof workers.getWorkerForOrgWithCounts>>;
			let capabilities: Awaited<ReturnType<typeof workers.listWorkerCapabilitiesForOrg>>;
			try {
				worker = await workers.getWorkerForOrgWithCounts(input.id, context.orgId);
				capabilities = await workers.listWorkerCapabilitiesForOrg(input.id, context.orgId);
			} catch (err) {
				if (err instanceof workers.WorkerNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: "Worker not found" });
				}
				throw err;
			}
			return {
				worker: {
					id: worker.id,
					name: worker.name,
					status: worker.status,
					description: worker.description,
					systemPrompt: worker.systemPrompt,
					modelId: worker.modelId,
					managerSessionId: worker.managerSessionId,
					lastErrorCode: worker.lastErrorCode,
					pausedAt: worker.pausedAt,
					createdBy: worker.createdBy,
					computeProfile: worker.computeProfile,
					pausedBy: worker.pausedBy,
					createdAt: worker.createdAt,
					updatedAt: worker.updatedAt,
					activeTaskCount: worker.activeTaskCount,
					pendingApprovalCount: worker.pendingApprovalCount,
					capabilities: capabilities.map((capability) => ({
						capabilityKey: capability.capabilityKey,
						mode: capability.mode,
						...(capability.origin ? { origin: capability.origin } : {}),
					})),
				},
			};
		}),

	/**
	 * List worker runs with events, paginated.
	 */
	listWorkerRuns: orgProcedure
		.input(
			z.object({
				workerId: z.string().uuid(),
				limit: z.number().int().positive().max(100).optional(),
			}),
		)
		.output(
			z.object({
				runs: z.array(
					z.object({
						id: z.string().uuid(),
						workerId: z.string().uuid(),
						status: z.string(),
						summary: z.string().nullable(),
						wakeEventId: z.string().uuid(),
						createdAt: z.coerce.date(),
						startedAt: z.coerce.date().nullable(),
						completedAt: z.coerce.date().nullable(),
						events: z.array(
							z.object({
								id: z.string().uuid(),
								eventIndex: z.number(),
								eventType: z.string(),
								summaryText: z.string().nullable(),
								payloadJson: z.unknown().nullable(),
								sessionId: z.string().uuid().nullable(),
								actionInvocationId: z.string().uuid().nullable(),
								createdAt: z.coerce.date(),
							}),
						),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const runsList = await workers.listWorkerRunsForOrg(
					input.workerId,
					context.orgId,
					input.limit,
				);
				return { runs: runsList };
			} catch (err) {
				if (err instanceof workers.WorkerNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: "Worker not found" });
				}
				throw err;
			}
		}),

	/**
	 * List task sessions for a worker.
	 */
	listWorkerSessions: orgProcedure
		.input(
			z.object({
				workerId: z.string().uuid(),
				limit: z.number().int().positive().max(100).optional(),
			}),
		)
		.output(
			z.object({
				sessions: z.array(
					z.object({
						id: z.string().uuid(),
						title: z.string().nullable(),
						status: z.string().nullable(),
						repoId: z.string().uuid().nullable(),
						branchName: z.string().nullable(),
						operatorStatus: z.string(),
						updatedAt: z.coerce.date().nullable(),
						startedAt: z.coerce.date().nullable(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const sessionsList = await workers.listWorkerSessionsForOrg(
					input.workerId,
					context.orgId,
					input.limit,
				);
				return { sessions: sessionsList };
			} catch (err) {
				if (err instanceof workers.WorkerNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: "Worker not found" });
				}
				throw err;
			}
		}),

	/**
	 * List queued session messages for a worker's manager session.
	 */
	listPendingDirectives: orgProcedure
		.input(z.object({ workerId: z.string().uuid() }))
		.output(
			z.object({
				directives: z.array(
					z.object({
						id: z.string().uuid(),
						messageType: z.string(),
						payloadJson: z.unknown(),
						queuedAt: z.coerce.date(),
						senderUserId: z.string().nullable(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const directives = await workers.listPendingDirectivesForOrg(input.workerId, context.orgId);
				return { directives };
			} catch (err) {
				if (err instanceof workers.WorkerNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: "Worker not found" });
				}
				throw err;
			}
		}),

	/**
	 * Send a directive/message to a worker's manager session.
	 */
	sendDirective: orgProcedure
		.input(
			z.object({
				workerId: z.string().uuid(),
				content: z.string().min(1).max(10000),
			}),
		)
		.output(
			z.object({
				success: z.boolean(),
				messageId: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const { messageId } = await workers.sendDirectiveToWorker({
					workerId: input.workerId,
					organizationId: context.orgId,
					senderUserId: context.user.id,
					content: input.content,
					gatewayUrl: GATEWAY_INTERNAL_URL,
					serviceToken: env.SERVICE_TO_SERVICE_AUTH_TOKEN,
				});
				return { success: true, messageId };
			} catch (err) {
				if (err instanceof workers.WorkerNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: "Worker not found" });
				}
				throw err;
			}
		}),

	/**
	 * Pause a worker.
	 */
	pauseWorker: orgProcedure
		.input(z.object({ workerId: z.string().uuid() }))
		.output(
			z.object({
				worker: z.object({
					id: z.string().uuid(),
					name: z.string(),
					status: z.string(),
					description: z.string().nullable(),
					systemPrompt: z.string().nullable(),
					modelId: z.string().nullable(),
					managerSessionId: z.string().uuid(),
					lastErrorCode: z.string().nullable(),
					pausedAt: z.coerce.date().nullable(),
					createdBy: z.string().nullable(),
					computeProfile: z.string().nullable(),
					pausedBy: z.string().nullable(),
					createdAt: z.coerce.date(),
					updatedAt: z.coerce.date(),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const worker = await workers.pauseWorkerForOrg(
					input.workerId,
					context.orgId,
					context.user.id,
				);
				return { worker };
			} catch (err) {
				if (err instanceof workers.WorkerNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Resume a worker.
	 */
	resumeWorker: orgProcedure
		.input(z.object({ workerId: z.string().uuid() }))
		.output(
			z.object({
				worker: z.object({
					id: z.string().uuid(),
					name: z.string(),
					status: z.string(),
					description: z.string().nullable(),
					systemPrompt: z.string().nullable(),
					modelId: z.string().nullable(),
					managerSessionId: z.string().uuid(),
					lastErrorCode: z.string().nullable(),
					pausedAt: z.coerce.date().nullable(),
					createdBy: z.string().nullable(),
					computeProfile: z.string().nullable(),
					pausedBy: z.string().nullable(),
					createdAt: z.coerce.date(),
					updatedAt: z.coerce.date(),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const worker = await workers.resumeWorkerForOrg(input.workerId, context.orgId);
				return { worker };
			} catch (err) {
				if (err instanceof workers.WorkerNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Trigger a manual wake for a worker.
	 */
	runWorkerNow: orgProcedure
		.input(z.object({ workerId: z.string().uuid() }))
		.output(z.object({ wakeEventId: z.string() }))
		.handler(async ({ input, context }) => {
			try {
				return await workers.runWorkerNow({
					workerId: input.workerId,
					organizationId: context.orgId,
					gatewayUrl: GATEWAY_INTERNAL_URL,
					serviceToken: env.SERVICE_TO_SERVICE_AUTH_TOKEN,
				});
			} catch (err) {
				if (err instanceof workers.WorkerNotFoundError) {
					throw new ORPCError("NOT_FOUND", { message: err.message });
				}
				if (err instanceof workers.WorkerResumeRequiredError) {
					throw new ORPCError("CONFLICT", { message: err.message });
				}
				if (err instanceof workers.WorkerNotActiveError) {
					throw new ORPCError("CONFLICT", { message: err.message });
				}
				throw err;
			}
		}),

	/**
	 * Update worker fields.
	 */
	updateWorker: orgProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				name: z.string().optional(),
				description: z.string().nullable().optional(),
				systemPrompt: z.string().max(5000).nullable().optional(),
				modelId: z.string().optional(),
				repoId: z.string().uuid().nullable().optional(),
				configurationId: z.string().uuid().nullable().optional(),
				capabilities: z.array(CoworkerCapabilityInputSchema).max(100).optional(),
			}),
		)
		.output(
			z.object({
				worker: z.object({
					id: z.string().uuid(),
					name: z.string(),
					status: z.string(),
					description: z.string().nullable(),
					systemPrompt: z.string().nullable(),
					modelId: z.string().nullable(),
					managerSessionId: z.string().uuid(),
					lastErrorCode: z.string().nullable(),
					pausedAt: z.coerce.date().nullable(),
					createdBy: z.string().nullable(),
					computeProfile: z.string().nullable(),
					pausedBy: z.string().nullable(),
					createdAt: z.coerce.date(),
					updatedAt: z.coerce.date(),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, repoId, configurationId, capabilities, ...fields } = input;
			const updated = await workers.updateWorkerForOrg({
				workerId: id,
				organizationId: context.orgId,
				fields,
				repoId,
				configurationId,
				capabilities,
			});
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Worker not found" });
			}
			return { worker: updated };
		}),

	/**
	 * Delete a worker.
	 */
	deleteWorker: orgProcedure
		.input(z.object({ id: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			const deleted = await workers.deleteWorker(input.id, context.orgId);
			if (!deleted) {
				throw new ORPCError("NOT_FOUND", { message: "Worker not found" });
			}
			return { success: true };
		}),

	// ============================================
	// Worker Jobs (Scheduled Check-Ins)
	// ============================================

	/**
	 * List all jobs for a worker.
	 */
	listWorkerJobs: orgProcedure
		.input(z.object({ workerId: z.string().uuid() }))
		.output(
			z.object({
				jobs: z.array(
					z.object({
						id: z.string().uuid(),
						workerId: z.string().uuid(),
						name: z.string(),
						description: z.string().nullable(),
						checkInPrompt: z.string(),
						cronExpression: z.string(),
						enabled: z.boolean(),
						lastTickAt: z.coerce.date().nullable(),
						nextTickAt: z.coerce.date().nullable(),
						createdAt: z.coerce.date(),
						updatedAt: z.coerce.date(),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const jobs = await workerJobs.listJobsForWorker(input.workerId, context.orgId);
				return { jobs };
			} catch (err) {
				throwAutomationORPCError(err, "Failed to list worker jobs");
			}
		}),

	/**
	 * Get a single worker job by ID.
	 */
	getWorkerJob: orgProcedure
		.input(z.object({ jobId: z.string().uuid() }))
		.output(
			z.object({
				job: z.object({
					id: z.string().uuid(),
					workerId: z.string().uuid(),
					name: z.string(),
					description: z.string().nullable(),
					checkInPrompt: z.string(),
					cronExpression: z.string(),
					enabled: z.boolean(),
					lastTickAt: z.coerce.date().nullable(),
					nextTickAt: z.coerce.date().nullable(),
					createdAt: z.coerce.date(),
					updatedAt: z.coerce.date(),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				// findJobById throws WorkerJobNotFoundError if not found
				const job = await workerJobs.findJobById(input.jobId, context.orgId);
				return { job };
			} catch (err) {
				throwAutomationORPCError(err, "Failed to get worker job");
			}
		}),

	/**
	 * Create a new scheduled job for a worker.
	 */
	createWorkerJob: orgProcedure
		.input(
			z.object({
				workerId: z.string().uuid(),
				name: z.string().min(1).max(200),
				checkInPrompt: z.string().min(1).max(5000),
				cronExpression: z.string().min(1),
				description: z.string().max(2000).optional(),
				enabled: z.boolean().optional(),
			}),
		)
		.output(
			z.object({
				job: z.object({
					id: z.string().uuid(),
					workerId: z.string().uuid(),
					name: z.string(),
					description: z.string().nullable(),
					checkInPrompt: z.string(),
					cronExpression: z.string(),
					enabled: z.boolean(),
					lastTickAt: z.coerce.date().nullable(),
					nextTickAt: z.coerce.date().nullable(),
					createdAt: z.coerce.date(),
					updatedAt: z.coerce.date(),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const job = await workerJobs.createWorkerJob({
					workerId: input.workerId,
					organizationId: context.orgId,
					name: input.name,
					checkInPrompt: input.checkInPrompt,
					cronExpression: input.cronExpression,
					description: input.description,
					enabled: input.enabled,
				});
				return { job };
			} catch (err) {
				throwAutomationORPCError(err, "Failed to create worker job");
			}
		}),

	/**
	 * Update an existing worker job.
	 */
	updateWorkerJob: orgProcedure
		.input(
			z.object({
				jobId: z.string().uuid(),
				name: z.string().min(1).max(200).optional(),
				checkInPrompt: z.string().min(1).max(5000).optional(),
				cronExpression: z.string().min(1).optional(),
				description: z.string().max(2000).nullable().optional(),
				enabled: z.boolean().optional(),
			}),
		)
		.output(
			z.object({
				job: z.object({
					id: z.string().uuid(),
					workerId: z.string().uuid(),
					name: z.string(),
					description: z.string().nullable(),
					checkInPrompt: z.string(),
					cronExpression: z.string(),
					enabled: z.boolean(),
					lastTickAt: z.coerce.date().nullable(),
					nextTickAt: z.coerce.date().nullable(),
					createdAt: z.coerce.date(),
					updatedAt: z.coerce.date(),
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			const { jobId, ...fields } = input;
			try {
				const job = await workerJobs.updateWorkerJob({
					jobId,
					organizationId: context.orgId,
					fields,
				});
				return { job };
			} catch (err) {
				throwAutomationORPCError(err, "Failed to update worker job");
			}
		}),

	/**
	 * Delete a worker job.
	 */
	deleteWorkerJob: orgProcedure
		.input(z.object({ jobId: z.string().uuid() }))
		.output(z.object({ success: z.boolean() }))
		.handler(async ({ input, context }) => {
			try {
				await workerJobs.deleteWorkerJob(input.jobId, context.orgId);
				return { success: true };
			} catch (err) {
				throwAutomationORPCError(err, "Failed to delete worker job");
			}
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
