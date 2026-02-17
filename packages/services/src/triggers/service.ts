/**
 * Triggers service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomBytes, randomUUID } from "crypto";
import { createPollGroupQueue, removePollGroupJob, schedulePollGroupJob } from "@proliferate/queue";
import type { Trigger, TriggerEvent, TriggerWithIntegration } from "@proliferate/shared";
import { getServicesLogger } from "../logger";
import * as pollGroupsDb from "../poll-groups/db";
import * as triggersDb from "./db";
import {
	toTrigger,
	toTriggerEvents,
	toTriggerEventsWithRelations,
	toTriggerWithIntegration,
	toTriggersWithIntegration,
} from "./mapper";

let pollGroupQueue: ReturnType<typeof createPollGroupQueue> | null = null;

function getPollGroupQueue() {
	if (!pollGroupQueue) {
		pollGroupQueue = createPollGroupQueue();
	}
	return pollGroupQueue;
}

// ============================================
// Types
// ============================================

export interface CreateTriggerInput {
	organizationId: string;
	userId: string;
	name: string;
	description?: string;
	triggerType?: "webhook" | "polling";
	provider: string;
	executionMode?: "auto" | "queue";
	defaultConfigurationId?: string;
	allowAgenticRepoSelection?: boolean;
	agentInstructions?: string;
	pollingCron?: string;
	pollingEndpoint?: string;
	config?: Record<string, unknown>;
	integrationId?: string;
	gatewayUrl?: string;
}

export interface CreateTriggerResult {
	trigger: Trigger;
	webhookUrl: string | null;
}

export interface GetTriggerResult {
	trigger: TriggerWithIntegration;
	recentEvents: TriggerEvent[];
	eventCounts: Record<string, number>;
}

export interface UpdateTriggerInput {
	name?: string;
	description?: string;
	enabled?: boolean;
	executionMode?: "auto" | "queue";
	allowAgenticRepoSelection?: boolean;
	agentInstructions?: string | null;
	pollingCron?: string | null;
	config?: Record<string, unknown>;
	integrationId?: string | null;
}

export interface ListEventsOptions {
	triggerId?: string;
	status?: string;
	limit?: number;
	offset?: number;
}

export interface ListEventsResult {
	events: Array<
		TriggerEvent & {
			trigger: { id: string; name: string | null; provider: string } | null;
			session: { id: string; title: string | null; status: string | null } | null;
		}
	>;
	total: number;
	limit: number;
	offset: number;
}

export interface SkipEventResult {
	skipped: boolean;
	eventId: string;
}

// ============================================
// Service functions
// ============================================

/**
 * List all triggers for an organization with pending event counts.
 */
export async function listTriggers(orgId: string): Promise<TriggerWithIntegration[]> {
	const rows = await triggersDb.listByOrganization(orgId);
	const triggerIds = rows.map((r) => r.id);
	const pendingCounts = await triggersDb.getPendingEventCounts(triggerIds);
	return toTriggersWithIntegration(rows, pendingCounts);
}

/**
 * Get a single trigger by ID with recent events and counts.
 */
export async function getTrigger(id: string, orgId: string): Promise<GetTriggerResult | null> {
	const row = await triggersDb.findById(id, orgId);
	if (!row) return null;

	const [recentEvents, eventCounts] = await Promise.all([
		triggersDb.getRecentEvents(id),
		triggersDb.getEventStatusCounts(id),
	]);

	return {
		trigger: toTriggerWithIntegration(row),
		recentEvents: toTriggerEvents(recentEvents),
		eventCounts,
	};
}

/**
 * Create a new trigger with associated automation.
 */
export async function createTrigger(input: CreateTriggerInput): Promise<CreateTriggerResult> {
	const triggerType = input.triggerType ?? "webhook";

	// Validate configuration if provided
	if (input.defaultConfigurationId) {
		const exists = await triggersDb.configurationExists(input.defaultConfigurationId, input.organizationId);
		if (!exists) {
			throw new Error("Configuration not found");
		}
	}

	// Validate integration if provided
	if (input.integrationId) {
		const exists = await triggersDb.integrationExists(input.integrationId, input.organizationId);
		if (!exists) {
			throw new Error("Integration not found");
		}
	}

	// Generate webhook path and secret for webhook triggers
	const webhookUrlPath =
		triggerType === "webhook" ? `/webhooks/t_${randomUUID().slice(0, 12)}` : null;
	const webhookSecret = triggerType === "webhook" ? randomBytes(32).toString("hex") : null;

	// Create automation first (required parent for triggers)
	const automation = await triggersDb.createAutomation({
		organizationId: input.organizationId,
		name: input.name || "Untitled Automation",
		description: input.description ?? null,
		agentInstructions: input.agentInstructions ?? null,
		defaultConfigurationId: input.defaultConfigurationId ?? null,
		allowAgenticRepoSelection: input.allowAgenticRepoSelection ?? false,
		createdBy: input.userId,
	});

	// Create the trigger
	const trigger = await triggersDb.create({
		automationId: automation.id,
		organizationId: input.organizationId,
		name: input.name,
		description: input.description ?? null,
		triggerType,
		provider: input.provider,
		executionMode: input.executionMode ?? "auto",
		allowAgenticRepoSelection: input.allowAgenticRepoSelection ?? false,
		agentInstructions: input.agentInstructions ?? null,
		webhookUrlPath,
		webhookSecret,
		pollingCron: input.pollingCron ?? null,
		pollingEndpoint: input.pollingEndpoint ?? null,
		config: input.config ?? null,
		integrationId: input.integrationId ?? null,
		createdBy: input.userId,
	});

	// Build full webhook URL
	const webhookUrl =
		webhookUrlPath && input.gatewayUrl ? `${input.gatewayUrl}${webhookUrlPath}` : null;

	if (triggerType === "polling" && input.pollingCron) {
		try {
			// vNext: Create/reuse a poll group for this org+provider+integration
			const group = await pollGroupsDb.findOrCreateGroup(
				input.organizationId,
				input.provider,
				input.integrationId ?? null,
				input.pollingCron,
			);
			await schedulePollGroupJob(getPollGroupQueue(), group.id, group.cronExpression);
		} catch (err) {
			getServicesLogger()
				.child({ module: "triggers" })
				.error({ err }, "Failed to schedule poll group");
		}
	}

	return {
		trigger: toTrigger(trigger),
		webhookUrl,
	};
}

/**
 * Update a trigger.
 */
export async function updateTrigger(
	id: string,
	orgId: string,
	input: UpdateTriggerInput,
): Promise<Trigger | null> {
	// Check if trigger exists
	const existing = await triggersDb.findById(id, orgId);
	if (!existing) return null;

	const updated = await triggersDb.update(id, {
		name: input.name,
		description: input.description,
		enabled: input.enabled,
		executionMode: input.executionMode,
		allowAgenticRepoSelection: input.allowAgenticRepoSelection,
		agentInstructions: input.agentInstructions,
		pollingCron: input.pollingCron,
		config: input.config,
		integrationId: input.integrationId,
	});

	if (updated.triggerType === "polling") {
		try {
			if (updated.enabled && updated.pollingCron) {
				// vNext: Create/reuse poll group and schedule
				const group = await pollGroupsDb.findOrCreateGroup(
					orgId,
					updated.provider,
					updated.integrationId ?? null,
					updated.pollingCron,
				);
				await schedulePollGroupJob(getPollGroupQueue(), group.id, group.cronExpression);
			}
			// Clean up orphaned groups and their BullMQ jobs
			const orphaned = await pollGroupsDb.deleteOrphanedGroups();
			const queue = getPollGroupQueue();
			for (const group of orphaned) {
				await removePollGroupJob(queue, group.id, group.cronExpression);
			}
		} catch (err) {
			getServicesLogger()
				.child({ module: "triggers" })
				.error({ err }, "Failed to update poll group");
		}
	}

	return toTrigger(updated);
}

/**
 * Delete a trigger.
 */
export async function deleteTrigger(id: string, orgId: string): Promise<boolean> {
	const existing = await triggersDb.findById(id, orgId);
	await triggersDb.deleteById(id, orgId);

	if (existing?.triggerType === "polling") {
		try {
			// vNext: Clean up orphaned poll groups and their BullMQ jobs
			const orphaned = await pollGroupsDb.deleteOrphanedGroups();
			if (orphaned.length > 0) {
				const queue = getPollGroupQueue();
				for (const group of orphaned) {
					await removePollGroupJob(queue, group.id, group.cronExpression);
				}
				getServicesLogger()
					.child({ module: "triggers" })
					.info({ orphanedGroups: orphaned.length }, "Cleaned up orphaned poll groups");
			}
		} catch (err) {
			getServicesLogger()
				.child({ module: "triggers" })
				.error({ err }, "Failed to clean up poll groups");
		}
	}
	return true;
}

/**
 * List trigger events with filters and pagination.
 */
export async function listTriggerEvents(
	orgId: string,
	options: ListEventsOptions = {},
): Promise<ListEventsResult> {
	const { triggerId, status, limit = 50, offset = 0 } = options;

	const result = await triggersDb.listEvents(orgId, { triggerId, status, limit, offset });

	return {
		events: toTriggerEventsWithRelations(result.events),
		total: result.total,
		limit,
		offset,
	};
}

/**
 * Skip a queued trigger event.
 */
export async function skipTriggerEvent(id: string, orgId: string): Promise<SkipEventResult | null> {
	const event = await triggersDb.findEventById(id, orgId);

	if (!event) return null;

	if (event.status !== "queued") {
		throw new Error(`Event is already ${event.status}`);
	}

	await triggersDb.skipEvent(id);

	return {
		skipped: true,
		eventId: id,
	};
}

/**
 * Check if a trigger exists and belongs to the organization.
 */
export async function triggerExists(id: string, orgId: string): Promise<boolean> {
	return triggersDb.exists(id, orgId);
}
