/**
 * Automations service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomBytes, randomUUID } from "crypto";
import { addScheduledJob, createScheduledQueue } from "@proliferate/queue";
import type {
	Automation,
	AutomationEvent,
	AutomationEventDetail,
	AutomationListItem,
	AutomationTrigger,
	AutomationWithTriggers,
} from "@proliferate/shared/contracts";
import * as configurationsDb from "../configurations/db";
import { getServicesLogger } from "../logger";
import { createRunFromTriggerEvent } from "../runs/service";
import { validateCronExpression } from "../schedules/service";
import * as automationsDb from "./db";
import {
	toAutomation,
	toAutomationEvent,
	toAutomationEventDetail,
	toAutomationListItems,
	toAutomationTriggerFromRow,
	toAutomationWithTriggers,
	toNewAutomationListItem,
} from "./mapper";

let scheduledQueue: ReturnType<typeof createScheduledQueue> | null = null;

function getScheduledQueue() {
	if (!scheduledQueue) {
		scheduledQueue = createScheduledQueue();
	}
	return scheduledQueue;
}

// ============================================
// Types
// ============================================

export interface CreateAutomationInput {
	name?: string;
	description?: string;
	agentInstructions?: string;
	defaultConfigurationId?: string;
	allowAgenticRepoSelection?: boolean;
}

export interface UpdateAutomationInput {
	name?: string;
	description?: string | null;
	enabled?: boolean;
	agentInstructions?: string | null;
	defaultConfigurationId?: string | null;
	allowAgenticRepoSelection?: boolean;
	agentType?: string;
	modelId?: string;
	llmFilterPrompt?: string | null;
	enabledTools?: Record<string, unknown> | null;
	llmAnalysisPrompt?: string | null;
	notificationDestinationType?: string | null;
	notificationChannelId?: string | null;
	notificationSlackUserId?: string | null;
	notificationSlackInstallationId?: string | null;
	configSelectionStrategy?: string | null;
	fallbackConfigurationId?: string | null;
	allowedConfigurationIds?: string[] | null;
}

// ============================================
// Service functions
// ============================================

/**
 * List all automations for an organization.
 */
export async function listAutomations(orgId: string): Promise<AutomationListItem[]> {
	const rows = await automationsDb.listByOrganization(orgId);
	return toAutomationListItems(rows);
}

/**
 * Get a single automation by ID with triggers.
 */
export async function getAutomation(
	id: string,
	orgId: string,
): Promise<AutomationWithTriggers | null> {
	const row = await automationsDb.findById(id, orgId);
	if (!row) return null;
	return toAutomationWithTriggers(row);
}

/**
 * Create a new automation.
 */
export async function createAutomation(
	orgId: string,
	userId: string,
	input: CreateAutomationInput,
): Promise<AutomationListItem> {
	// Validate configuration if provided
	if (input.defaultConfigurationId) {
		const configuration = await automationsDb.validateConfiguration(
			input.defaultConfigurationId,
			orgId,
		);
		if (!configuration) {
			throw new Error("Configuration not found");
		}
	}

	const row = await automationsDb.create({
		organizationId: orgId,
		name: input.name || "Untitled Automation",
		description: input.description,
		agentInstructions: input.agentInstructions,
		defaultConfigurationId: input.defaultConfigurationId,
		allowAgenticRepoSelection: input.allowAgenticRepoSelection,
		createdBy: userId,
	});

	return toNewAutomationListItem(row);
}

/**
 * Update an automation.
 */
export async function updateAutomation(
	id: string,
	orgId: string,
	input: UpdateAutomationInput,
): Promise<Automation> {
	// Validate configuration if provided
	if (input.defaultConfigurationId) {
		const configuration = await automationsDb.validateConfiguration(
			input.defaultConfigurationId,
			orgId,
		);
		if (!configuration) {
			throw new Error("Configuration not found");
		}
	}

	// Validate DM notification requires a Slack user
	if (input.notificationDestinationType === "slack_dm_user" && !input.notificationSlackUserId) {
		throw new Error("DM notification destination requires a Slack user");
	}

	// Validate agent_decide constraints
	if (input.configSelectionStrategy === "agent_decide") {
		const allowedIds = input.allowedConfigurationIds;
		if (!allowedIds || allowedIds.length === 0) {
			throw new Error("agent_decide strategy requires at least one allowlisted configuration");
		}

		// Verify all allowlisted configs have routing descriptions
		const candidates = await configurationsDb.getConfigurationCandidates(allowedIds, orgId);
		const missingDescription = candidates.filter(
			(c) => !c.routingDescription || c.routingDescription.trim().length === 0,
		);
		if (missingDescription.length > 0) {
			const names = missingDescription.map((c) => c.name).join(", ");
			throw new Error(
				`All allowlisted configurations must have routing descriptions. Missing: ${names}`,
			);
		}
	}

	const row = await automationsDb.update(id, orgId, {
		name: input.name,
		description: input.description,
		enabled: input.enabled,
		agentInstructions: input.agentInstructions,
		defaultConfigurationId: input.defaultConfigurationId,
		allowAgenticRepoSelection: input.allowAgenticRepoSelection,
		agentType: input.agentType,
		modelId: input.modelId,
		llmFilterPrompt: input.llmFilterPrompt,
		enabledTools: input.enabledTools,
		llmAnalysisPrompt: input.llmAnalysisPrompt,
		notificationDestinationType: input.notificationDestinationType,
		notificationChannelId: input.notificationChannelId,
		notificationSlackUserId: input.notificationSlackUserId,
		notificationSlackInstallationId: input.notificationSlackInstallationId,
		configSelectionStrategy: input.configSelectionStrategy,
		fallbackConfigurationId: input.fallbackConfigurationId,
		allowedConfigurationIds: input.allowedConfigurationIds,
	});

	return toAutomation(row);
}

/**
 * Delete an automation.
 */
export async function deleteAutomation(id: string, orgId: string): Promise<boolean> {
	await automationsDb.deleteById(id, orgId);
	return true;
}

/**
 * Check if an automation exists.
 */
export async function automationExists(id: string, orgId: string): Promise<boolean> {
	return automationsDb.exists(id, orgId);
}

// ============================================
// Action Modes (per-automation overrides)
// ============================================

export type { ActionMode, ActionModesMap } from "./db";

/**
 * Get action_modes for an automation.
 */
export async function getAutomationActionModes(
	id: string,
	orgId: string,
): Promise<automationsDb.ActionModesMap> {
	const exists = await automationsDb.exists(id, orgId);
	if (!exists) throw new Error("Automation not found");
	return automationsDb.getActionModes(id, orgId);
}

/**
 * Set a single action mode on an automation.
 */
export async function setAutomationActionMode(
	id: string,
	orgId: string,
	key: string,
	mode: automationsDb.ActionMode,
): Promise<void> {
	const exists = await automationsDb.exists(id, orgId);
	if (!exists) throw new Error("Automation not found");
	await automationsDb.setActionMode(id, orgId, key, mode);
}

/**
 * Get automation name for display.
 */
export async function getAutomationName(
	id: string,
	orgId: string,
): Promise<{ id: string; name: string } | null> {
	return automationsDb.getAutomationName(id, orgId);
}

// ============================================
// Trigger & Event operations for automations
// ============================================

export interface ListEventsOptions {
	status?: string;
	limit?: number;
	offset?: number;
}

export interface ListEventsResult {
	events: AutomationEvent[];
	total: number;
	limit: number;
	offset: number;
}

/**
 * List trigger events for an automation.
 */
export async function listAutomationEvents(
	automationId: string,
	orgId: string,
	options: ListEventsOptions = {},
): Promise<ListEventsResult> {
	// Verify automation belongs to org
	const exists = await automationsDb.exists(automationId, orgId);
	if (!exists) {
		throw new Error("Automation not found");
	}

	const limit = Math.min(options.limit ?? 50, 100);
	const offset = options.offset ?? 0;

	// Get trigger IDs for this automation
	const triggerIds = await automationsDb.getTriggerIdsForAutomation(automationId);

	if (triggerIds.length === 0) {
		return { events: [], total: 0, limit, offset };
	}

	const result = await automationsDb.listEventsForTriggers(triggerIds, {
		status: options.status,
		limit,
		offset,
	});

	return {
		events: result.events.map(toAutomationEvent),
		total: result.total,
		limit,
		offset,
	};
}

export interface GetEventResult {
	event: AutomationEventDetail;
	automation: { id: string; name: string };
}

/**
 * Get a specific trigger event for an automation.
 */
export async function getAutomationEvent(
	automationId: string,
	eventId: string,
	orgId: string,
): Promise<GetEventResult | null> {
	// Verify automation belongs to org and get its name
	const automationData = await automationsDb.getAutomationName(automationId, orgId);
	if (!automationData) {
		return null;
	}

	// Get the event
	const event = await automationsDb.findEventById(eventId, orgId);
	if (!event) {
		return null;
	}

	// Verify the event belongs to the automation
	const triggerData = Array.isArray(event.trigger) ? event.trigger[0] : event.trigger;
	const triggerAutomation = triggerData?.automation
		? Array.isArray(triggerData.automation)
			? triggerData.automation[0]
			: triggerData.automation
		: null;

	if (triggerAutomation?.id !== automationId) {
		return null;
	}

	return {
		event: toAutomationEventDetail(event),
		automation: automationData,
	};
}

/**
 * List triggers for an automation.
 */
export async function listAutomationTriggers(
	automationId: string,
	orgId: string,
	gatewayUrl: string | undefined,
): Promise<AutomationTrigger[]> {
	// Verify automation belongs to org
	const exists = await automationsDb.exists(automationId, orgId);
	if (!exists) {
		throw new Error("Automation not found");
	}

	const triggers = await automationsDb.listTriggersForAutomation(automationId);
	return triggers.map((t) => toAutomationTriggerFromRow(t, gatewayUrl));
}

/**
 * List connections for an automation.
 */
export async function listAutomationConnections(
	automationId: string,
	orgId: string,
): Promise<automationsDb.AutomationConnectionWithIntegration[]> {
	const exists = await automationsDb.exists(automationId, orgId);
	if (!exists) {
		throw new Error("Automation not found");
	}

	return automationsDb.listAutomationConnections(automationId);
}

/**
 * Add a connection to an automation.
 */
export async function addAutomationConnection(
	automationId: string,
	orgId: string,
	integrationId: string,
): Promise<void> {
	const exists = await automationsDb.exists(automationId, orgId);
	if (!exists) {
		throw new Error("Automation not found");
	}

	const integration = await automationsDb.validateIntegration(integrationId, orgId);
	if (!integration) {
		throw new Error("Integration not found");
	}

	await automationsDb.createAutomationConnection({ automationId, integrationId });
}

/**
 * Remove a connection from an automation.
 */
export async function removeAutomationConnection(
	automationId: string,
	orgId: string,
	integrationId: string,
): Promise<void> {
	const exists = await automationsDb.exists(automationId, orgId);
	if (!exists) {
		throw new Error("Automation not found");
	}

	await automationsDb.deleteAutomationConnection(automationId, integrationId);
}

export interface CreateTriggerInput {
	provider: string;
	triggerType?: string;
	integrationId?: string | null;
	config?: Record<string, unknown>;
	enabled?: boolean;
	cronExpression?: string | null;
}

// ============================================
// Webhook trigger types (for automation webhook endpoint)
// ============================================

export interface WebhookTriggerResult {
	id: string;
	organizationId: string;
	provider: string;
	webhookSecret: string | null;
	config: Record<string, unknown> | null;
	automation: {
		id: string;
		name: string;
		enabled: boolean;
		defaultConfigurationId: string | null;
		agentInstructions: string | null;
		modelId: string | null;
	} | null;
}

export interface WebhookTriggerInfoResult {
	id: string;
	enabled: boolean;
	automation: { id: string; name: string; enabled: boolean } | null;
}

export interface CreateTriggerEventInput {
	triggerId: string;
	organizationId: string;
	externalEventId: string;
	providerEventType: string;
	rawPayload: unknown;
	parsedContext: unknown;
	dedupKey: string;
}

export interface TriggerEventResult {
	id: string;
	triggerId: string;
	organizationId: string;
}

/**
 * Create a trigger for an automation.
 * Also auto-adds the trigger's connection to the automation's connections.
 */
export async function createAutomationTrigger(
	automationId: string,
	orgId: string,
	userId: string,
	input: CreateTriggerInput,
	gatewayUrl: string | undefined,
): Promise<AutomationTrigger> {
	// Verify automation exists and get its name
	const automationData = await automationsDb.getAutomationName(automationId, orgId);
	if (!automationData) {
		throw new Error("Automation not found");
	}

	// Validate integration if provided
	if (input.integrationId) {
		const integration = await automationsDb.validateIntegration(input.integrationId, orgId);
		if (!integration) {
			throw new Error("Integration not found");
		}
	}

	if (input.provider === "scheduled") {
		if (!input.cronExpression || input.cronExpression.trim().length === 0) {
			throw new Error("Scheduled triggers require cronExpression");
		}
		if (!validateCronExpression(input.cronExpression)) {
			throw new Error("Invalid cron expression. Expected 5 or 6 fields.");
		}
	}

	// Generate webhook path and secret
	const webhookUrlPath = `/webhooks/t_${randomUUID().slice(0, 12)}`;
	const webhookSecret = randomBytes(32).toString("hex");

	const trigger = await automationsDb.createTriggerForAutomation({
		automationId,
		organizationId: orgId,
		name: `${automationData.name} - ${input.provider}`,
		provider: input.provider,
		triggerType: input.triggerType ?? "webhook",
		enabled: input.enabled ?? true,
		config: (input.config ?? {}) as automationsDb.Json,
		integrationId: input.integrationId ?? null,
		webhookUrlPath,
		webhookSecret,
		pollingCron: input.cronExpression ?? null,
		createdBy: userId,
	});

	// Auto-add the trigger's connection to automation_connections if it has one
	if (input.integrationId) {
		try {
			await automationsDb.createAutomationConnection({
				automationId,
				integrationId: input.integrationId,
			});
		} catch {
			// Ignore duplicate constraint errors - connection may already exist
		}
	}

	if (
		input.provider === "scheduled" &&
		(input.enabled ?? true) &&
		typeof input.cronExpression === "string" &&
		input.cronExpression.trim().length > 0
	) {
		try {
			await addScheduledJob(getScheduledQueue(), trigger.id, input.cronExpression);
		} catch (err) {
			getServicesLogger()
				.child({ module: "automations" })
				.error({ err, triggerId: trigger.id }, "Failed to schedule cron trigger");
		}
	}

	return toAutomationTriggerFromRow(trigger, gatewayUrl);
}

// ============================================
// Webhook trigger operations (for automation webhook endpoint)
// ============================================

/**
 * Find an enabled webhook trigger for an automation.
 * Used by the automation webhook POST handler.
 */
export async function findWebhookTrigger(
	automationId: string,
): Promise<WebhookTriggerResult | null> {
	const row = await automationsDb.findWebhookTriggerForAutomation(automationId);
	if (!row) return null;

	return {
		id: row.id,
		organizationId: row.organizationId,
		provider: row.provider,
		webhookSecret: row.webhookSecret,
		config: row.config as Record<string, unknown> | null,
		automation: row.automation
			? {
					id: row.automation.id,
					name: row.automation.name,
					enabled: row.automation.enabled ?? false,
					defaultConfigurationId: row.automation.defaultConfigurationId,
					agentInstructions: row.automation.agentInstructions,
					modelId: row.automation.modelId,
				}
			: null,
	};
}

/**
 * Find an enabled provider trigger for an automation.
 * Used by provider-specific webhook handlers.
 */
export async function findTriggerForAutomationByProvider(
	automationId: string,
	provider: string,
): Promise<WebhookTriggerResult | null> {
	const row = await automationsDb.findTriggerForAutomationByProvider(automationId, provider);
	if (!row) return null;

	return {
		id: row.id,
		organizationId: row.organizationId,
		provider: row.provider,
		webhookSecret: row.webhookSecret,
		config: row.config as Record<string, unknown> | null,
		automation: row.automation
			? {
					id: row.automation.id,
					name: row.automation.name,
					enabled: row.automation.enabled ?? false,
					defaultConfigurationId: row.automation.defaultConfigurationId,
					agentInstructions: row.automation.agentInstructions,
					modelId: row.automation.modelId,
				}
			: null,
	};
}

/**
 * Get webhook trigger info for an automation.
 * Used by the automation webhook GET handler.
 */
export async function getWebhookTriggerInfo(
	automationId: string,
): Promise<WebhookTriggerInfoResult | null> {
	const row = await automationsDb.findWebhookTriggerInfo(automationId);
	if (!row) return null;

	return {
		id: row.id,
		enabled: row.enabled ?? false,
		automation: row.automation
			? {
					id: row.automation.id,
					name: row.automation.name,
					enabled: row.automation.enabled ?? false,
				}
			: null,
	};
}

/**
 * Check if a duplicate trigger event exists within the dedup window.
 */
export async function isDuplicateTriggerEvent(
	triggerId: string,
	dedupKey: string,
	dedupWindowMs = 5 * 60 * 1000,
): Promise<boolean> {
	const sinceTime = new Date(Date.now() - dedupWindowMs).toISOString();
	const existing = await automationsDb.findDuplicateTriggerEvent(triggerId, dedupKey, sinceTime);
	return existing !== null;
}

/**
 * Create a trigger event from a webhook payload.
 */
export async function createTriggerEvent(
	input: CreateTriggerEventInput,
): Promise<TriggerEventResult> {
	const row = await automationsDb.createTriggerEvent({
		triggerId: input.triggerId,
		organizationId: input.organizationId,
		externalEventId: input.externalEventId,
		providerEventType: input.providerEventType,
		rawPayload: input.rawPayload as automationsDb.Json,
		parsedContext: input.parsedContext as automationsDb.Json,
		dedupKey: input.dedupKey,
		status: "queued",
	});

	return {
		id: row.id,
		triggerId: row.triggerId,
		organizationId: row.organizationId,
	};
}

// ============================================
// Manual run trigger
// ============================================

/**
 * Trigger a manual run for an automation.
 *
 * Creates a synthetic trigger event and kicks off the run pipeline
 * (enrich → execute) so users can test automations from the UI.
 */
export async function triggerManualRun(
	automationId: string,
	orgId: string,
	userId: string,
): Promise<{ runId: string; status: string }> {
	const exists = await automationsDb.exists(automationId, orgId);
	if (!exists) throw new Error("Automation not found");

	// Find or create a dedicated manual trigger (isolated from real triggers).
	// Uses provider "webhook" with a config flag to stay within the valid TriggerProvider enum.
	let trigger = await automationsDb.findManualTrigger(automationId);
	if (!trigger) {
		trigger = await automationsDb.createTriggerForAutomation({
			automationId,
			organizationId: orgId,
			name: "Manual trigger",
			provider: "webhook",
			triggerType: "webhook",
			enabled: false,
			config: { _manual: true },
			integrationId: null,
			webhookUrlPath: `manual-${automationId}`,
			webhookSecret: randomBytes(16).toString("hex"),
			pollingCron: null,
			createdBy: userId,
		});
	}

	const { run } = await createRunFromTriggerEvent({
		triggerId: trigger.id,
		organizationId: orgId,
		automationId,
		externalEventId: `manual-${Date.now()}`,
		providerEventType: "manual_trigger",
		rawPayload: { type: "manual_trigger", triggered_by: userId },
		parsedContext: {
			title: "Manual test run",
			description: "Manually triggered from the UI",
		},
		dedupKey: null,
	});

	return { runId: run.id, status: run.status };
}

// ============================================
// Integration action resolver
// ============================================

interface ActionMeta {
	name: string;
	description: string;
	riskLevel: "read" | "write";
}

export interface IntegrationActions {
	sourceId: string;
	displayName: string;
	actions: ActionMeta[];
}

const LINEAR_ACTIONS: ActionMeta[] = [
	{ name: "list_issues", description: "List issues", riskLevel: "read" },
	{ name: "get_issue", description: "Get a specific issue", riskLevel: "read" },
	{ name: "create_issue", description: "Create a new issue", riskLevel: "write" },
	{ name: "update_issue", description: "Update an existing issue", riskLevel: "write" },
	{ name: "add_comment", description: "Add a comment to an issue", riskLevel: "write" },
];

const SENTRY_ACTIONS: ActionMeta[] = [
	{ name: "list_issues", description: "List issues", riskLevel: "read" },
	{ name: "get_issue", description: "Get details of a specific issue", riskLevel: "read" },
	{
		name: "list_issue_events",
		description: "List events for a specific issue",
		riskLevel: "read",
	},
	{ name: "get_event", description: "Get details of a specific event", riskLevel: "read" },
	{ name: "update_issue", description: "Update an issue", riskLevel: "write" },
];

/**
 * Returns the integration actions available for an automation based on its
 * enabled tools, triggers, and connections.
 *
 * Native adapters (Linear, Sentry) return stable action lists.
 * MCP connector support is planned via automation_connections.
 */
export async function getAutomationIntegrationActions(
	automationId: string,
	orgId: string,
): Promise<IntegrationActions[]> {
	const automation = await automationsDb.findById(automationId, orgId);
	if (!automation) throw new Error("Automation not found");

	const enabledTools = (automation.enabledTools ?? {}) as Record<
		string,
		{ enabled?: boolean } | undefined
	>;
	const triggerProviders = automation.triggers.map((t) => t.provider);

	const result: IntegrationActions[] = [];

	// Linear: show if tool enabled or trigger exists
	if (enabledTools.create_linear_issue?.enabled || triggerProviders.includes("linear")) {
		result.push({ sourceId: "linear", displayName: "Linear", actions: LINEAR_ACTIONS });
	}

	// Sentry: show if trigger exists
	if (triggerProviders.includes("sentry")) {
		result.push({ sourceId: "sentry", displayName: "Sentry", actions: SENTRY_ACTIONS });
	}

	// TODO: MCP connectors — query automation_connections → org_connectors,
	// call listConnectorTools for each, and include their actions here.

	return result;
}
