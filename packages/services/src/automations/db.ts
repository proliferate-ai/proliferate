/**
 * Automations DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	type InferSelectModel,
	and,
	automationConnections,
	automations,
	configurations,
	desc,
	eq,
	getDb,
	gte,
	inArray,
	integrations,
	triggerEvents,
	triggers,
} from "../db/client";
import type {
	CreateAutomationInput,
	CreateTriggerEventInput,
	CreateTriggerForAutomationInput,
	Json,
	ListEventsOptions,
	UpdateAutomationInput,
} from "../types/automations";

export type { Json };

// ============================================
// Types
// ============================================

/** Automation row type from Drizzle schema */
export type AutomationRow = InferSelectModel<typeof automations>;

/** Prebuild summary for relations */
export interface PrebuildSummary {
	id: string;
	name: string | null;
	snapshotId: string | null;
}

/** Creator summary for relations */
export interface CreatorSummary {
	id: string;
	name: string | null;
	image: string | null;
}

/** Trigger summary for relations */
export interface TriggerSummary {
	id: string;
	provider: string;
	enabled: boolean | null;
}

/** Schedule summary for relations */
export interface ScheduleSummary {
	id: string;
	enabled: boolean | null;
}

/** Integration summary for relations */
export interface IntegrationSummary {
	id: string;
	displayName: string | null;
	status: string | null;
}

/** Automation connection with integration detail */
export interface AutomationConnectionWithIntegration {
	id: string;
	automationId: string;
	integrationId: string;
	createdAt: Date | null;
	integration: {
		id: string;
		provider: string;
		integrationId: string;
		connectionId: string;
		displayName: string | null;
		status: string | null;
	} | null;
}

/** Trigger with integration for detail view */
export interface TriggerWithIntegration {
	id: string;
	provider: string;
	triggerType: string;
	enabled: boolean | null;
	config: unknown;
	webhookUrlPath: string | null;
	webhookSecret: string | null;
	integrationId: string | null;
	integration: IntegrationSummary | null;
	name: string | null;
}

/** Automation with all relations for list view */
export interface AutomationWithRelations extends AutomationRow {
	defaultPrebuild: PrebuildSummary | null;
	triggers: TriggerSummary[];
	schedules: ScheduleSummary[];
	createdByUser: CreatorSummary | null;
}

/** Automation with triggers for detail view */
export interface AutomationWithTriggers extends AutomationRow {
	defaultPrebuild: PrebuildSummary | null;
	triggers: TriggerWithIntegration[];
}

/** Trigger event row for list view */
export interface TriggerEventRow {
	id: string;
	externalEventId: string | null;
	providerEventType: string | null;
	status: string | null;
	parsedContext: unknown;
	errorMessage: string | null;
	skipReason: string | null;
	processedAt: Date | null;
	createdAt: Date | null;
	sessionId: string | null;
	trigger: { id: string; name: string | null; provider: string } | null;
	session: { id: string; title: string | null; status: string | null } | null;
	enrichedData: unknown;
	llmFilterResult: unknown;
	llmAnalysisResult: unknown;
}

/** Trigger event detail row with full data */
export interface TriggerEventDetailRow extends TriggerEventRow {
	rawPayload: unknown;
	trigger: {
		id: string;
		name: string | null;
		provider: string;
		config: unknown;
		automation: { id: string; name: string } | null;
	} | null;
	automationRuns: Array<{
		id: string;
		status: string;
		errorMessage: string | null;
		completedAt: Date | null;
		assignedTo: string | null;
		assignee: {
			id: string;
			name: string;
			email: string;
			image: string | null;
		} | null;
	}>;
}

/** Trigger for automation row */
export interface TriggerForAutomationRow {
	id: string;
	provider: string;
	triggerType: string;
	enabled: boolean | null;
	config: unknown;
	webhookUrlPath: string | null;
	webhookSecret: string | null;
	integrationId: string | null;
	integration: IntegrationSummary | null;
	name: string | null;
}

/** Webhook trigger with automation */
export interface WebhookTriggerWithAutomation {
	id: string;
	organizationId: string;
	provider: string;
	webhookSecret: string | null;
	config: unknown;
	automation: {
		id: string;
		name: string;
		enabled: boolean | null;
		defaultPrebuildId: string | null;
		agentInstructions: string | null;
		modelId: string | null;
	} | null;
}

/** Webhook trigger info for GET handler */
export interface WebhookTriggerInfo {
	id: string;
	enabled: boolean | null;
	automation: { id: string; name: string; enabled: boolean | null } | null;
}

/** Trigger event insert row */
export interface TriggerEventInsertRow {
	id: string;
	triggerId: string;
	organizationId: string;
	externalEventId: string;
	providerEventType: string;
	status: string;
	dedupKey: string;
	createdAt: Date | null;
}

/** List events result */
export interface ListEventsResult {
	events: TriggerEventRow[];
	total: number;
}

// ============================================
// Queries
// ============================================

/**
 * List automations for an organization with related data.
 */
export async function listByOrganization(orgId: string): Promise<AutomationWithRelations[]> {
	const db = getDb();
	const results = await db.query.automations.findMany({
		where: eq(automations.organizationId, orgId),
		orderBy: [desc(automations.updatedAt)],
		with: {
			configuration: {
				columns: {
					id: true,
					name: true,
					snapshotId: true,
				},
			},
			triggers: {
				columns: {
					id: true,
					provider: true,
					enabled: true,
				},
			},
			schedules: {
				columns: {
					id: true,
					enabled: true,
				},
			},
			user: {
				columns: {
					id: true,
					name: true,
					image: true,
				},
			},
		},
	});

	return results.map((row) => {
		const { configuration, user, ...rest } = row;
		return {
			...rest,
			defaultPrebuild: configuration ?? null,
			createdByUser: user ?? null,
		};
	});
}

/**
 * Get an automation by ID with triggers.
 */
export async function findById(id: string, orgId: string): Promise<AutomationWithTriggers | null> {
	const db = getDb();
	const result = await db.query.automations.findFirst({
		where: and(eq(automations.id, id), eq(automations.organizationId, orgId)),
		with: {
			configuration: {
				columns: {
					id: true,
					name: true,
					snapshotId: true,
				},
			},
			triggers: {
				columns: {
					id: true,
					provider: true,
					triggerType: true,
					enabled: true,
					config: true,
					webhookUrlPath: true,
					webhookSecret: true,
					integrationId: true,
					name: true,
				},
				with: {
					integration: {
						columns: {
							id: true,
							displayName: true,
							status: true,
						},
					},
				},
			},
		},
	});

	if (!result) return null;
	const { configuration, ...rest } = result;
	return {
		...rest,
		defaultPrebuild: configuration ?? null,
	};
}

/**
 * Create a new automation.
 */
export async function create(
	input: CreateAutomationInput,
): Promise<AutomationRow & { defaultPrebuild: PrebuildSummary | null }> {
	const db = getDb();
	const [result] = await db
		.insert(automations)
		.values({
			organizationId: input.organizationId,
			name: input.name || "Untitled Automation",
			description: input.description || null,
			agentInstructions: input.agentInstructions || null,
			defaultPrebuildId: input.defaultPrebuildId || null,
			allowAgenticRepoSelection: input.allowAgenticRepoSelection ?? false,
			enabled: false,
			createdBy: input.createdBy,
		})
		.returning();

	// Fetch with configuration relation
	const withConfiguration = await db.query.automations.findFirst({
		where: eq(automations.id, result.id),
		with: {
			configuration: {
				columns: {
					id: true,
					name: true,
					snapshotId: true,
				},
			},
		},
	});

	if (!withConfiguration) {
		return { ...result, defaultPrebuild: null };
	}
	const { configuration, ...rest } = withConfiguration;
	return { ...rest, defaultPrebuild: configuration ?? null };
}

/**
 * Update an automation.
 */
export async function update(
	id: string,
	orgId: string,
	input: UpdateAutomationInput,
): Promise<AutomationRow & { defaultPrebuild: PrebuildSummary | null }> {
	const db = getDb();
	const updates: Partial<typeof automations.$inferInsert> = {
		updatedAt: new Date(),
	};

	if (input.name !== undefined) updates.name = input.name;
	if (input.description !== undefined) updates.description = input.description;
	if (input.enabled !== undefined) updates.enabled = input.enabled;
	if (input.agentInstructions !== undefined) updates.agentInstructions = input.agentInstructions;
	if (input.defaultPrebuildId !== undefined) updates.defaultPrebuildId = input.defaultPrebuildId;
	if (input.allowAgenticRepoSelection !== undefined)
		updates.allowAgenticRepoSelection = input.allowAgenticRepoSelection;
	if (input.agentType !== undefined) updates.agentType = input.agentType;
	if (input.modelId !== undefined) updates.modelId = input.modelId;
	if (input.llmFilterPrompt !== undefined) updates.llmFilterPrompt = input.llmFilterPrompt;
	if (input.enabledTools !== undefined) updates.enabledTools = input.enabledTools;
	if (input.llmAnalysisPrompt !== undefined) updates.llmAnalysisPrompt = input.llmAnalysisPrompt;
	if (input.notificationChannelId !== undefined)
		updates.notificationChannelId = input.notificationChannelId;
	if (input.notificationSlackInstallationId !== undefined)
		updates.notificationSlackInstallationId = input.notificationSlackInstallationId;

	await db
		.update(automations)
		.set(updates)
		.where(and(eq(automations.id, id), eq(automations.organizationId, orgId)));

	// Fetch with configuration relation
	const result = await db.query.automations.findFirst({
		where: and(eq(automations.id, id), eq(automations.organizationId, orgId)),
		with: {
			configuration: {
				columns: {
					id: true,
					name: true,
					snapshotId: true,
				},
			},
		},
	});

	if (!result) {
		throw new Error("Automation not found after update");
	}
	const { configuration, ...rest } = result;
	return { ...rest, defaultPrebuild: configuration ?? null };
}

/**
 * Delete an automation.
 */
export async function deleteById(id: string, orgId: string): Promise<void> {
	const db = getDb();
	await db
		.delete(automations)
		.where(and(eq(automations.id, id), eq(automations.organizationId, orgId)));
}

/**
 * Check if an automation exists.
 */
export async function exists(id: string, orgId: string): Promise<boolean> {
	const db = getDb();
	const result = await db.query.automations.findFirst({
		where: and(eq(automations.id, id), eq(automations.organizationId, orgId)),
		columns: { id: true },
	});

	return !!result;
}

/**
 * Get automation name for display.
 */
export async function getAutomationName(
	id: string,
	orgId: string,
): Promise<{ id: string; name: string } | null> {
	const db = getDb();
	const result = await db.query.automations.findFirst({
		where: and(eq(automations.id, id), eq(automations.organizationId, orgId)),
		columns: { id: true, name: true },
	});

	return result ?? null;
}

/**
 * Validate prebuild exists and belongs to org (via linked repos).
 */
export async function validatePrebuild(
	prebuildId: string,
	orgId: string,
): Promise<{ id: string; snapshotId: string | null } | null> {
	const db = getDb();
	const result = await db.query.configurations.findFirst({
		where: eq(configurations.id, prebuildId),
		columns: { id: true, snapshotId: true },
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

	if (!result) return null;

	// Verify at least one linked repo belongs to the org
	const belongsToOrg = result.configurationRepos?.some((pr) => pr.repo?.organizationId === orgId);
	if (!belongsToOrg) return null;

	return { id: result.id, snapshotId: result.snapshotId };
}

// ============================================
// Trigger-related queries for automations
// ============================================

/**
 * Get trigger IDs for an automation.
 */
export async function getTriggerIdsForAutomation(automationId: string): Promise<string[]> {
	const db = getDb();
	const results = await db.query.triggers.findMany({
		where: eq(triggers.automationId, automationId),
		columns: { id: true },
	});

	return results.map((t) => t.id);
}

/**
 * List trigger events for given trigger IDs.
 */
export async function listEventsForTriggers(
	triggerIds: string[],
	options: ListEventsOptions,
): Promise<ListEventsResult> {
	if (triggerIds.length === 0) {
		return { events: [], total: 0 };
	}

	const db = getDb();

	// Build where conditions
	const conditions = [inArray(triggerEvents.triggerId, triggerIds)];
	if (options.status) {
		conditions.push(eq(triggerEvents.status, options.status));
	}

	// Get total count
	const countResult = await db.query.triggerEvents.findMany({
		where: and(...conditions),
		columns: { id: true },
	});
	const total = countResult.length;

	// Get paginated results with relations
	const results = await db.query.triggerEvents.findMany({
		where: and(...conditions),
		orderBy: [desc(triggerEvents.createdAt)],
		limit: options.limit,
		offset: options.offset,
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

	const events: TriggerEventRow[] = results.map((r) => ({
		id: r.id,
		externalEventId: r.externalEventId,
		providerEventType: r.providerEventType,
		status: r.status,
		parsedContext: r.parsedContext,
		errorMessage: r.errorMessage,
		skipReason: r.skipReason,
		processedAt: r.processedAt,
		createdAt: r.createdAt,
		sessionId: r.sessionId,
		trigger: r.trigger,
		session: r.session,
		enrichedData: r.enrichedData,
		llmFilterResult: r.llmFilterResult,
		llmAnalysisResult: r.llmAnalysisResult,
	}));

	return { events, total };
}

/**
 * Get a single trigger event by ID with full details.
 */
export async function findEventById(
	eventId: string,
	orgId: string,
): Promise<TriggerEventDetailRow | null> {
	const db = getDb();
	const result = await db.query.triggerEvents.findFirst({
		where: and(eq(triggerEvents.id, eventId), eq(triggerEvents.organizationId, orgId)),
		with: {
			trigger: {
				columns: {
					id: true,
					name: true,
					provider: true,
					config: true,
				},
				with: {
					automation: {
						columns: {
							id: true,
							name: true,
						},
					},
				},
			},
			session: {
				columns: {
					id: true,
					title: true,
					status: true,
				},
			},
			automationRuns: {
				columns: {
					id: true,
					status: true,
					errorMessage: true,
					completedAt: true,
					assignedTo: true,
				},
				with: {
					assignee: {
						columns: {
							id: true,
							name: true,
							email: true,
							image: true,
						},
					},
				},
				orderBy: (runs, { desc: d }) => [d(runs.queuedAt)],
				limit: 1,
			},
		},
	});

	if (!result) return null;

	return {
		id: result.id,
		externalEventId: result.externalEventId,
		providerEventType: result.providerEventType,
		status: result.status,
		parsedContext: result.parsedContext,
		errorMessage: result.errorMessage,
		skipReason: result.skipReason,
		processedAt: result.processedAt,
		createdAt: result.createdAt,
		sessionId: result.sessionId,
		enrichedData: result.enrichedData,
		llmFilterResult: result.llmFilterResult,
		llmAnalysisResult: result.llmAnalysisResult,
		rawPayload: result.rawPayload,
		trigger: result.trigger
			? {
					id: result.trigger.id,
					name: result.trigger.name,
					provider: result.trigger.provider,
					config: result.trigger.config,
					automation: result.trigger.automation,
				}
			: null,
		session: result.session,
		automationRuns: result.automationRuns ?? [],
	};
}

/**
 * List triggers for an automation.
 */
export async function listTriggersForAutomation(
	automationId: string,
): Promise<TriggerForAutomationRow[]> {
	const db = getDb();
	const results = await db.query.triggers.findMany({
		where: eq(triggers.automationId, automationId),
		columns: {
			id: true,
			provider: true,
			triggerType: true,
			enabled: true,
			config: true,
			webhookUrlPath: true,
			webhookSecret: true,
			integrationId: true,
			name: true,
		},
		with: {
			integration: {
				columns: {
					id: true,
					displayName: true,
					status: true,
				},
			},
		},
	});

	return results as TriggerForAutomationRow[];
}

/**
 * Validate integration exists and belongs to org.
 */
export async function validateIntegration(
	integrationId: string,
	orgId: string,
): Promise<{ id: string; status: string | null } | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(eq(integrations.id, integrationId), eq(integrations.organizationId, orgId)),
		columns: { id: true, status: true },
	});

	return result ?? null;
}

/**
 * List automation connections with integration details.
 */
export async function listAutomationConnections(
	automationId: string,
): Promise<AutomationConnectionWithIntegration[]> {
	const db = getDb();
	const results = await db.query.automationConnections.findMany({
		where: eq(automationConnections.automationId, automationId),
		orderBy: [desc(automationConnections.createdAt)],
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

	return results as AutomationConnectionWithIntegration[];
}

/**
 * Create an automation connection.
 */
export async function createAutomationConnection(input: {
	automationId: string;
	integrationId: string;
}): Promise<{ id: string }> {
	const db = getDb();
	const [result] = await db
		.insert(automationConnections)
		.values({
			automationId: input.automationId,
			integrationId: input.integrationId,
		})
		.returning({ id: automationConnections.id });

	return result;
}

/**
 * Remove an automation connection.
 */
export async function deleteAutomationConnection(
	automationId: string,
	integrationId: string,
): Promise<void> {
	const db = getDb();
	await db
		.delete(automationConnections)
		.where(
			and(
				eq(automationConnections.automationId, automationId),
				eq(automationConnections.integrationId, integrationId),
			),
		);
}

/**
 * Create a trigger for an automation.
 */
export async function createTriggerForAutomation(
	input: CreateTriggerForAutomationInput,
): Promise<TriggerForAutomationRow> {
	const db = getDb();
	const [result] = await db
		.insert(triggers)
		.values({
			automationId: input.automationId,
			organizationId: input.organizationId,
			name: input.name,
			provider: input.provider,
			triggerType: input.triggerType,
			enabled: input.enabled,
			config: input.config,
			integrationId: input.integrationId,
			webhookUrlPath: input.webhookUrlPath,
			webhookSecret: input.webhookSecret,
			pollingCron: input.pollingCron,
			createdBy: input.createdBy,
		})
		.returning();

	// Fetch with integration relation
	const withIntegration = await db.query.triggers.findFirst({
		where: eq(triggers.id, result.id),
		columns: {
			id: true,
			provider: true,
			triggerType: true,
			enabled: true,
			config: true,
			webhookUrlPath: true,
			webhookSecret: true,
			integrationId: true,
			name: true,
		},
		with: {
			integration: {
				columns: {
					id: true,
					displayName: true,
					status: true,
				},
			},
		},
	});

	return withIntegration as TriggerForAutomationRow;
}

// ============================================
// Webhook trigger queries (for automation webhook endpoint)
// ============================================

/**
 * Find an enabled webhook trigger for an automation with automation data.
 * Used by the webhook POST handler.
 */
export async function findWebhookTriggerForAutomation(
	automationId: string,
): Promise<WebhookTriggerWithAutomation | null> {
	const db = getDb();
	const result = await db.query.triggers.findFirst({
		where: and(
			eq(triggers.automationId, automationId),
			eq(triggers.provider, "webhook"),
			eq(triggers.enabled, true),
		),
		columns: {
			id: true,
			organizationId: true,
			provider: true,
			webhookSecret: true,
			config: true,
		},
		with: {
			automation: {
				columns: {
					id: true,
					name: true,
					enabled: true,
					defaultPrebuildId: true,
					agentInstructions: true,
					modelId: true,
				},
			},
		},
	});

	return (result as WebhookTriggerWithAutomation) ?? null;
}

/**
 * Find an enabled trigger for an automation by provider.
 * Used by provider-specific webhook handlers (e.g., PostHog).
 */
export async function findTriggerForAutomationByProvider(
	automationId: string,
	provider: string,
): Promise<WebhookTriggerWithAutomation | null> {
	const db = getDb();
	const result = await db.query.triggers.findFirst({
		where: and(
			eq(triggers.automationId, automationId),
			eq(triggers.provider, provider),
			eq(triggers.enabled, true),
		),
		columns: {
			id: true,
			organizationId: true,
			provider: true,
			webhookSecret: true,
			config: true,
		},
		with: {
			automation: {
				columns: {
					id: true,
					name: true,
					enabled: true,
					defaultPrebuildId: true,
					agentInstructions: true,
					modelId: true,
				},
			},
		},
	});

	return (result as WebhookTriggerWithAutomation) ?? null;
}

/**
 * Find webhook trigger info for the GET handler.
 */
export async function findWebhookTriggerInfo(
	automationId: string,
): Promise<WebhookTriggerInfo | null> {
	const db = getDb();
	const result = await db.query.triggers.findFirst({
		where: and(eq(triggers.automationId, automationId), eq(triggers.provider, "webhook")),
		columns: {
			id: true,
			enabled: true,
		},
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

	return (result as WebhookTriggerInfo) ?? null;
}

/**
 * Check for duplicate trigger event within a time window.
 */
export async function findDuplicateTriggerEvent(
	triggerId: string,
	dedupKey: string,
	sinceTime: string,
): Promise<{ id: string } | null> {
	const db = getDb();
	const result = await db.query.triggerEvents.findFirst({
		where: and(
			eq(triggerEvents.triggerId, triggerId),
			eq(triggerEvents.dedupKey, dedupKey),
			gte(triggerEvents.createdAt, new Date(sinceTime)),
		),
		columns: { id: true },
	});

	return result ?? null;
}

/**
 * Create a trigger event.
 */
export async function createTriggerEvent(
	input: CreateTriggerEventInput,
): Promise<TriggerEventInsertRow> {
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
		})
		.returning({
			id: triggerEvents.id,
			triggerId: triggerEvents.triggerId,
			organizationId: triggerEvents.organizationId,
			externalEventId: triggerEvents.externalEventId,
			providerEventType: triggerEvents.providerEventType,
			status: triggerEvents.status,
			dedupKey: triggerEvents.dedupKey,
			createdAt: triggerEvents.createdAt,
		});

	return result as TriggerEventInsertRow;
}
