/**
 * Triggers DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	and,
	automations,
	desc,
	eq,
	getDb,
	gte,
	inArray,
	integrations,
	prebuilds,
	sql,
	triggerEvents,
	triggers,
} from "../db/client";
import type { InferSelectModel } from "../db/client";

// ============================================
// Type Exports
// ============================================

export type TriggerRow = InferSelectModel<typeof triggers>;
export type TriggerEventRow = InferSelectModel<typeof triggerEvents>;

// Trigger with integration relation
export interface TriggerWithIntegrationRow extends TriggerRow {
	integration: {
		id: string;
		provider: string;
		integrationId: string | null;
		connectionId: string | null;
		displayName: string | null;
		status: string | null;
	} | null;
}

// Trigger with automation relation
export interface TriggerWithAutomationRow extends TriggerRow {
	automation: {
		id: string;
		name: string;
		enabled: boolean | null;
	} | null;
}

// Trigger event with relations
export interface TriggerEventWithRelationsRow extends TriggerEventRow {
	trigger: {
		id: string;
		name: string | null;
		provider: string;
	} | null;
	session: {
		id: string;
		title: string | null;
		status: string | null;
	} | null;
}

// Basic trigger info
export interface TriggerBasicRow {
	id: string;
	enabled: boolean | null;
	provider: string;
}

// ============================================
// Input Types
// ============================================

export interface CreateTriggerInput {
	automationId: string;
	organizationId: string;
	name: string;
	description?: string | null;
	triggerType: string;
	provider: string;
	executionMode?: string | null;
	allowAgenticRepoSelection?: boolean | null;
	agentInstructions?: string | null;
	webhookUrlPath?: string | null;
	webhookSecret?: string | null;
	pollingCron?: string | null;
	pollingEndpoint?: string | null;
	config?: Record<string, unknown> | null;
	integrationId?: string | null;
	createdBy: string;
}

export interface CreateAutomationInput {
	organizationId: string;
	name: string;
	description?: string | null;
	agentInstructions?: string | null;
	defaultPrebuildId?: string | null;
	allowAgenticRepoSelection?: boolean;
	createdBy: string;
}

export interface CreateTriggerEventInput {
	triggerId: string;
	organizationId: string;
	externalEventId: string | null;
	providerEventType: string | null;
	rawPayload: Record<string, unknown>;
	parsedContext: Record<string, unknown> | null;
	dedupKey: string | null;
	status: string;
	skipReason?: string | null;
}

export interface UpdateTriggerInput {
	name?: string;
	description?: string | null;
	enabled?: boolean;
	executionMode?: string | null;
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

export interface CreateSkippedEventInput {
	triggerId: string;
	organizationId: string;
	externalEventId: string | null;
	providerEventType: string | null;
	rawPayload: Record<string, unknown>;
	parsedContext: Record<string, unknown> | null;
	dedupKey: string | null;
	skipReason: string;
}

// ============================================
// Queries
// ============================================

/**
 * List triggers for an organization with integration data.
 */
export async function listByOrganization(orgId: string): Promise<TriggerWithIntegrationRow[]> {
	const db = getDb();
	const results = await db.query.triggers.findMany({
		where: eq(triggers.organizationId, orgId),
		orderBy: [desc(triggers.createdAt)],
		with: {
			integration: {
				columns: {
					id: true,
					provider: true,
					integrationId: true,
					connectionId: true,
					displayName: true,
					status: true,
				},
			},
		},
	});

	return results as TriggerWithIntegrationRow[];
}

/**
 * Get pending event counts for triggers.
 */
export async function getPendingEventCounts(triggerIds: string[]): Promise<Record<string, number>> {
	if (triggerIds.length === 0) return {};

	const db = getDb();
	const results = await db.query.triggerEvents.findMany({
		where: and(inArray(triggerEvents.triggerId, triggerIds), eq(triggerEvents.status, "pending")),
		columns: {
			triggerId: true,
		},
	});

	const counts: Record<string, number> = {};
	for (const event of results) {
		counts[event.triggerId] = (counts[event.triggerId] ?? 0) + 1;
	}
	return counts;
}

/**
 * Get a single trigger by ID with integration.
 */
export async function findById(
	id: string,
	orgId: string,
): Promise<TriggerWithIntegrationRow | null> {
	const db = getDb();
	const result = await db.query.triggers.findFirst({
		where: and(eq(triggers.id, id), eq(triggers.organizationId, orgId)),
		with: {
			integration: {
				columns: {
					id: true,
					provider: true,
					integrationId: true,
					connectionId: true,
					displayName: true,
					status: true,
				},
			},
		},
	});

	return (result as TriggerWithIntegrationRow) ?? null;
}

/**
 * Get a single trigger by ID with integration (no org check).
 * Used by polling workers and webhook handlers.
 */
export async function findByIdWithIntegrationNoOrg(
	id: string,
): Promise<TriggerWithIntegrationRow | null> {
	const db = getDb();
	const result = await db.query.triggers.findFirst({
		where: eq(triggers.id, id),
		with: {
			integration: {
				columns: {
					id: true,
					provider: true,
					integrationId: true,
					connectionId: true,
					displayName: true,
					status: true,
				},
			},
		},
	});

	return (result as TriggerWithIntegrationRow) ?? null;
}

/**
 * Get recent events for a trigger.
 */
export async function getRecentEvents(triggerId: string, limit = 10): Promise<TriggerEventRow[]> {
	const db = getDb();
	const results = await db.query.triggerEvents.findMany({
		where: eq(triggerEvents.triggerId, triggerId),
		orderBy: [desc(triggerEvents.createdAt)],
		limit,
	});

	return results;
}

/**
 * Get event status counts for a trigger.
 */
export async function getEventStatusCounts(triggerId: string): Promise<Record<string, number>> {
	const db = getDb();
	const results = await db.query.triggerEvents.findMany({
		where: eq(triggerEvents.triggerId, triggerId),
		columns: {
			status: true,
		},
	});

	const counts: Record<string, number> = {};
	for (const event of results) {
		const status = event.status || "unknown";
		counts[status] = (counts[status] ?? 0) + 1;
	}
	return counts;
}

/**
 * Check if a trigger exists.
 */
export async function exists(id: string, orgId: string): Promise<boolean> {
	const db = getDb();
	const result = await db.query.triggers.findFirst({
		where: and(eq(triggers.id, id), eq(triggers.organizationId, orgId)),
		columns: { id: true },
	});

	return !!result;
}

/**
 * Create an automation.
 */
export async function createAutomation(input: CreateAutomationInput): Promise<{ id: string }> {
	const db = getDb();
	const [result] = await db
		.insert(automations)
		.values({
			organizationId: input.organizationId,
			name: input.name,
			description: input.description ?? null,
			agentInstructions: input.agentInstructions ?? null,
			defaultPrebuildId: input.defaultPrebuildId ?? null,
			allowAgenticRepoSelection: input.allowAgenticRepoSelection ?? false,
			createdBy: input.createdBy,
		})
		.returning({ id: automations.id });

	return result;
}

/**
 * Create a trigger.
 */
export async function create(input: CreateTriggerInput): Promise<TriggerRow> {
	const db = getDb();
	const [result] = await db
		.insert(triggers)
		.values({
			automationId: input.automationId,
			organizationId: input.organizationId,
			name: input.name,
			description: input.description ?? null,
			triggerType: input.triggerType,
			provider: input.provider,
			executionMode: input.executionMode ?? "auto",
			allowAgenticRepoSelection: input.allowAgenticRepoSelection ?? false,
			agentInstructions: input.agentInstructions ?? null,
			webhookUrlPath: input.webhookUrlPath ?? null,
			webhookSecret: input.webhookSecret ?? null,
			pollingCron: input.pollingCron ?? null,
			pollingEndpoint: input.pollingEndpoint ?? null,
			config: (input.config ?? {}) as Record<string, unknown>,
			integrationId: input.integrationId ?? null,
			createdBy: input.createdBy,
		})
		.returning();

	return result;
}

/**
 * Update a trigger.
 */
export async function update(id: string, input: UpdateTriggerInput): Promise<TriggerRow> {
	const db = getDb();
	const updateData: Partial<InferSelectModel<typeof triggers>> = {
		updatedAt: new Date(),
	};

	if (input.name !== undefined) updateData.name = input.name;
	if (input.description !== undefined) updateData.description = input.description;
	if (input.enabled !== undefined) updateData.enabled = input.enabled;
	if (input.executionMode !== undefined) updateData.executionMode = input.executionMode;
	if (input.allowAgenticRepoSelection !== undefined) {
		updateData.allowAgenticRepoSelection = input.allowAgenticRepoSelection;
	}
	if (input.agentInstructions !== undefined) {
		updateData.agentInstructions = input.agentInstructions;
	}
	if (input.pollingCron !== undefined) updateData.pollingCron = input.pollingCron;
	if (input.config !== undefined) updateData.config = input.config;
	if (input.integrationId !== undefined) updateData.integrationId = input.integrationId;

	const [result] = await db.update(triggers).set(updateData).where(eq(triggers.id, id)).returning();

	return result;
}

/**
 * Update polling state and last polled time for a trigger.
 */
export async function updatePollingState(
	id: string,
	input: { pollingState?: Record<string, unknown>; lastPolledAt?: Date },
): Promise<void> {
	const db = getDb();
	const updates: Partial<InferSelectModel<typeof triggers>> = {};
	if (input.pollingState !== undefined) updates.pollingState = input.pollingState;
	if (input.lastPolledAt !== undefined) updates.lastPolledAt = input.lastPolledAt;

	await db.update(triggers).set(updates).where(eq(triggers.id, id));
}

/**
 * Delete a trigger.
 */
export async function deleteById(id: string, orgId: string): Promise<void> {
	const db = getDb();
	await db.delete(triggers).where(and(eq(triggers.id, id), eq(triggers.organizationId, orgId)));
}

/**
 * List trigger events with filters.
 */
export async function listEvents(
	orgId: string,
	options: ListEventsOptions = {},
): Promise<{ events: TriggerEventWithRelationsRow[]; total: number }> {
	const { triggerId, status, limit = 50, offset = 0 } = options;

	const db = getDb();

	// Build where conditions
	const conditions = [eq(triggerEvents.organizationId, orgId)];
	if (triggerId) {
		conditions.push(eq(triggerEvents.triggerId, triggerId));
	}
	if (status) {
		conditions.push(eq(triggerEvents.status, status));
	}

	// Get count
	const countResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(triggerEvents)
		.where(and(...conditions));
	const total = countResult[0]?.count ?? 0;

	// Get events with relations
	const results = await db.query.triggerEvents.findMany({
		where: and(...conditions),
		orderBy: [desc(triggerEvents.createdAt)],
		limit,
		offset,
		with: {
			trigger: {
				columns: {
					id: true,
					name: true,
					provider: true,
				},
			},
			session: {
				columns: {
					id: true,
					title: true,
					status: true,
				},
			},
		},
	});

	return {
		events: results as TriggerEventWithRelationsRow[],
		total,
	};
}

/**
 * Get a trigger event by ID.
 */
export async function findEventById(id: string, orgId: string): Promise<TriggerEventRow | null> {
	const db = getDb();
	const result = await db.query.triggerEvents.findFirst({
		where: and(eq(triggerEvents.id, id), eq(triggerEvents.organizationId, orgId)),
	});

	return result ?? null;
}

/**
 * Update a trigger event status to skipped.
 */
export async function skipEvent(id: string): Promise<void> {
	const db = getDb();
	await db
		.update(triggerEvents)
		.set({
			status: "skipped",
			skipReason: "manual",
			processedAt: new Date(),
		})
		.where(eq(triggerEvents.id, id));
}

/**
 * Update a trigger event status and metadata.
 */
export async function updateEvent(
	id: string,
	input: {
		status?: string;
		sessionId?: string | null;
		errorMessage?: string | null;
		processedAt?: Date | null;
	},
): Promise<void> {
	const db = getDb();
	const updates: Partial<InferSelectModel<typeof triggerEvents>> = {};
	if (input.status !== undefined) updates.status = input.status;
	if (input.sessionId !== undefined) updates.sessionId = input.sessionId;
	if (input.errorMessage !== undefined) updates.errorMessage = input.errorMessage;
	if (input.processedAt !== undefined) updates.processedAt = input.processedAt;

	await db.update(triggerEvents).set(updates).where(eq(triggerEvents.id, id));
}

/**
 * Check if a prebuild exists in an organization (via linked repos).
 */
export async function prebuildExists(id: string, orgId: string): Promise<boolean> {
	const db = getDb();
	const result = await db.query.prebuilds.findFirst({
		where: eq(prebuilds.id, id),
		columns: { id: true },
		with: {
			configurationRepos: {
				with: {
					repo: {
						columns: { organizationId: true },
					},
				},
			},
		},
	});

	if (!result) return false;
	return result.configurationRepos.some((pr) => pr.repo?.organizationId === orgId);
}

/**
 * Check if an integration exists in an organization.
 */
export async function integrationExists(id: string, orgId: string): Promise<boolean> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(eq(integrations.id, id), eq(integrations.organizationId, orgId)),
		columns: { id: true },
	});

	return !!result;
}

// ============================================
// Webhook-specific queries (no org check - public endpoints)
// ============================================

/**
 * Find a trigger by ID with its automation (for webhook validation).
 * Does not require org ID since webhooks are public endpoints.
 */
export async function findTriggerWithAutomationById(
	id: string,
): Promise<TriggerWithAutomationRow | null> {
	const db = getDb();
	const result = await db.query.triggers.findFirst({
		where: eq(triggers.id, id),
		with: {
			automation: {
				columns: {
					id: true,
					name: true,
					enabled: true,
				},
			},
		},
	});

	return (result as TriggerWithAutomationRow) ?? null;
}

/**
 * Find basic trigger info by ID (for health checks).
 * Does not require org ID since webhooks are public endpoints.
 */
export async function findTriggerBasicById(id: string): Promise<TriggerBasicRow | null> {
	const db = getDb();
	const result = await db.query.triggers.findFirst({
		where: eq(triggers.id, id),
		columns: {
			id: true,
			enabled: true,
			provider: true,
		},
	});

	return result ?? null;
}

/**
 * Check for duplicate event by dedup key within a time window.
 */
export async function findDuplicateEventByDedupKey(
	triggerId: string,
	dedupKey: string,
	since: string,
): Promise<{ id: string } | null> {
	const db = getDb();
	const result = await db.query.triggerEvents.findFirst({
		where: and(
			eq(triggerEvents.triggerId, triggerId),
			eq(triggerEvents.dedupKey, dedupKey),
			gte(triggerEvents.createdAt, new Date(since)),
		),
		columns: { id: true },
	});

	return result ?? null;
}

/**
 * Create a trigger event.
 */
export async function createEvent(input: CreateTriggerEventInput): Promise<TriggerEventRow> {
	const db = getDb();
	const [result] = await db
		.insert(triggerEvents)
		.values({
			triggerId: input.triggerId,
			organizationId: input.organizationId,
			externalEventId: input.externalEventId,
			providerEventType: input.providerEventType,
			rawPayload: input.rawPayload,
			parsedContext: input.parsedContext,
			dedupKey: input.dedupKey,
			status: input.status,
			skipReason: input.skipReason ?? null,
		})
		.returning();

	return result;
}

/**
 * Find active webhook triggers for an integration (any provider).
 * Used by Nango forwarded webhooks.
 */
export async function findActiveWebhookTriggers(integrationId: string): Promise<TriggerRow[]> {
	const db = getDb();
	const results = await db.query.triggers.findMany({
		where: and(
			eq(triggers.integrationId, integrationId),
			eq(triggers.enabled, true),
			eq(triggers.triggerType, "webhook"),
		),
	});

	return results;
}

/**
 * Check if a trigger event exists by trigger_id and dedup_key.
 * Used by Nango forwarded webhooks for deduplication.
 */
export async function eventExistsByDedupKey(triggerId: string, dedupKey: string): Promise<boolean> {
	const db = getDb();
	const result = await db.query.triggerEvents.findFirst({
		where: and(eq(triggerEvents.triggerId, triggerId), eq(triggerEvents.dedupKey, dedupKey)),
		columns: { id: true },
	});

	return !!result;
}

// ============================================
// GitHub App webhook queries
// ============================================

/**
 * Find active webhook triggers by integration ID.
 * Used by GitHub App webhooks to get triggers associated with an integration.
 */
export async function findActiveByIntegrationId(integrationId: string): Promise<TriggerRow[]> {
	const db = getDb();
	const results = await db.query.triggers.findMany({
		where: and(
			eq(triggers.integrationId, integrationId),
			eq(triggers.provider, "github"),
			eq(triggers.enabled, true),
			eq(triggers.triggerType, "webhook"),
		),
	});

	return results;
}

/**
 * Find event by dedup key for a trigger.
 * Used to check for duplicate events (no time window).
 */
export async function findEventByDedupKey(
	triggerId: string,
	dedupKey: string,
): Promise<{ id: string } | null> {
	const db = getDb();
	const result = await db.query.triggerEvents.findFirst({
		where: and(eq(triggerEvents.triggerId, triggerId), eq(triggerEvents.dedupKey, dedupKey)),
		columns: { id: true },
	});

	return result ?? null;
}

/**
 * Create a skipped trigger event.
 * Used for events that don't match filters or are otherwise skipped.
 */
export async function createSkippedEvent(input: CreateSkippedEventInput): Promise<void> {
	const db = getDb();
	await db.insert(triggerEvents).values({
		triggerId: input.triggerId,
		organizationId: input.organizationId,
		externalEventId: input.externalEventId,
		providerEventType: input.providerEventType,
		rawPayload: input.rawPayload,
		parsedContext: input.parsedContext,
		dedupKey: input.dedupKey,
		status: "skipped",
		skipReason: input.skipReason,
	});
}
