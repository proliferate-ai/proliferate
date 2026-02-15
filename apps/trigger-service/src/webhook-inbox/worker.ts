/**
 * Webhook Inbox Worker
 *
 * BullMQ worker that processes webhook_inbox rows asynchronously.
 * Claims a row, resolves identity → org → triggers, runs the
 * filter/dedup/run-creation pipeline, and marks the row completed.
 */

import { createHash } from "crypto";
import { createWebhookInboxWorker } from "@proliferate/queue";
import { automations, integrations, runs, triggers as triggerService } from "@proliferate/services";
import {
	type TriggerProvider,
	type TriggerProviderType,
	getProviderByType,
} from "@proliferate/triggers";
import { logger as rootLogger } from "../lib/logger.js";

const logger = rootLogger.child({ module: "webhook-inbox" });

// ============================================
// Nango provider key → our provider type mapping
// ============================================

/**
 * Map a Nango providerConfigKey (or raw provider name) to our TriggerProvider type.
 * Nango may send the integration ID or just the provider name.
 */
function resolveProviderType(nangoKey: string): TriggerProviderType | null {
	const lower = nangoKey.toLowerCase();
	if (lower.includes("github") || lower === "github") return "github";
	if (lower.includes("linear") || lower === "linear") return "linear";
	if (lower.includes("sentry") || lower === "sentry") return "sentry";
	if (lower.includes("posthog") || lower === "posthog") return "posthog";
	return null;
}

// ============================================
// Worker
// ============================================

export function startWebhookInboxWorker() {
	const worker = createWebhookInboxWorker(async (job) => {
		const { inboxId } = job.data;
		const log = logger.child({ inboxId });

		// 1. Claim the inbox row (atomic status transition)
		const claimed = await triggerService.claimWebhookInboxRow(inboxId);
		if (!claimed) {
			log.debug("Inbox row already claimed or not ready, skipping");
			return;
		}

		// 2. Load the full inbox row
		const row = await triggerService.findWebhookInboxById(inboxId);
		if (!row) {
			log.warn("Inbox row not found after claiming");
			return;
		}

		try {
			// 3. Route based on identity_kind
			await processInboxRow(row, log);

			// 4. Mark completed
			await triggerService.completeWebhookInboxRow(inboxId);
		} catch (err) {
			// 5. Mark failed with retry backoff
			const nextAttempt = computeNextAttempt(row.attempt);
			await triggerService.failWebhookInboxRow(
				inboxId,
				err instanceof Error ? err.message : String(err),
				nextAttempt,
			);
			throw err; // Let BullMQ handle the retry
		}
	});

	return worker;
}

// ============================================
// Routing
// ============================================

async function processInboxRow(
	row: triggerService.WebhookInboxRow,
	log: typeof logger,
): Promise<void> {
	switch (row.identityKind) {
		case "connection_id":
			return processNangoInbox(row, log);
		case "github_installation_id":
			return processGitHubInbox(row, log);
		case "trigger_id":
			return processCustomInbox(row, log);
		case "automation_id_posthog":
			return processPostHogInbox(row, log);
		case "automation_id_webhook":
			return processAutomationInbox(row, log);
		default:
			throw new Error(`Unknown identity_kind: ${row.identityKind}`);
	}
}

// ============================================
// Nango forwarded webhooks (connectionId → integration → triggers)
// ============================================

async function processNangoInbox(
	row: triggerService.WebhookInboxRow,
	log: typeof logger,
): Promise<void> {
	// Resolve connectionId → integration
	const integration = await integrations.findByConnectionIdAndProvider(row.identityValue, "nango");
	if (!integration) {
		log.info({ connectionId: row.identityValue }, "Integration not found for connection");
		return;
	}

	// Resolve provider
	const providerType = resolveProviderType(row.provider);
	if (!providerType) {
		log.info({ provider: row.provider }, "Unsupported provider");
		return;
	}

	const provider = getProviderByType(providerType);
	if (!provider) {
		log.error({ providerType }, "Provider not found in registry");
		return;
	}

	// Parse webhook payload
	const items = provider.parseWebhook(row.payload);
	if (items.length === 0) {
		log.info({ provider: row.provider }, "No events parsed from payload");
		return;
	}

	// Find active triggers for this integration
	const triggerRows = await triggerService.findActiveWebhookTriggers(integration.id);
	if (triggerRows.length === 0) {
		log.info({ integrationId: integration.id }, "No active triggers");
		return;
	}

	// TODO: call provider.hydrate(event, { token }) when providers implement it

	// Process events using the shared processor (filter → dedup → createRun)
	const processableItems = items.map((item) => ({ item, provider }));
	await triggerService.processTriggerEvents(triggerRows, processableItems);
}

// ============================================
// GitHub App webhooks (installationId → integration → triggers)
// ============================================

async function processGitHubInbox(
	row: triggerService.WebhookInboxRow,
	log: typeof logger,
): Promise<void> {
	const integration = await integrations.findActiveByGitHubInstallationId(row.identityValue);
	if (!integration) {
		log.info({ installationId: row.identityValue }, "No integration for installation");
		return;
	}

	const provider = getProviderByType("github");
	if (!provider) {
		log.error("GitHub provider not found in registry");
		return;
	}

	const items = provider.parseWebhook(row.payload);
	if (items.length === 0) {
		log.info("No events parsed from GitHub payload");
		return;
	}

	const triggerRows = await triggerService.findActiveByIntegrationId(integration.id);
	if (triggerRows.length === 0) {
		log.info({ integrationId: integration.id }, "No active GitHub triggers");
		return;
	}

	const processableItems = items.map((item) => ({ item, provider }));
	await triggerService.processTriggerEvents(triggerRows, processableItems);
}

// ============================================
// Custom webhooks (triggerId → trigger → run)
// ============================================

async function processCustomInbox(
	row: triggerService.WebhookInboxRow,
	log: typeof logger,
): Promise<void> {
	const trigger = await triggerService.findTriggerWithAutomationById(row.identityValue);
	if (!trigger || !trigger.enabled) {
		log.info({ triggerId: row.identityValue }, "Trigger not found or disabled");
		return;
	}

	if (!trigger.automation?.enabled) {
		await safeCreateSkippedEvent(trigger, row, "automation_disabled");
		return;
	}

	// Compute dedup key from payload hash
	const payloadHash = createHash("sha256").update(JSON.stringify(row.payload)).digest("hex");
	const dedupKey = `webhook:${payloadHash}`;

	// Check dedup (5-minute window)
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
	const existing = await triggerService.findDuplicateEventByDedupKey(
		trigger.id,
		dedupKey,
		fiveMinutesAgo,
	);
	if (existing) {
		log.info({ triggerId: trigger.id }, "Duplicate event detected");
		return;
	}

	const parsedContext = {
		title: "Webhook Received",
		summary: `Custom webhook received at ${row.receivedAt.toISOString()}`,
		source: "webhook",
		timestamp: row.receivedAt.toISOString(),
		payload: row.payload,
	};

	await runs.createRunFromTriggerEvent({
		triggerId: trigger.id,
		organizationId: trigger.organizationId,
		automationId: trigger.automationId,
		externalEventId: `webhook:${row.receivedAt.toISOString()}`,
		providerEventType: "webhook:received",
		rawPayload: row.payload as Record<string, unknown>,
		parsedContext,
		dedupKey,
	});
}

// ============================================
// PostHog webhooks (automationId → trigger → run)
// ============================================

async function processPostHogInbox(
	row: triggerService.WebhookInboxRow,
	log: typeof logger,
): Promise<void> {
	const triggerInfo = await automations.findTriggerForAutomationByProvider(
		row.identityValue,
		"posthog",
	);
	if (!triggerInfo) {
		log.info({ automationId: row.identityValue }, "PostHog trigger not found");
		return;
	}

	const provider = getProviderByType("posthog");
	if (!provider) {
		log.error("PostHog provider not found in registry");
		return;
	}

	// Parse webhook payload
	const items = provider.parseWebhook(row.payload);
	if (items.length === 0) {
		log.info("No events parsed from PostHog payload");
		return;
	}

	// Process each item through filter/dedup/run pipeline
	await processItemsForSingleTrigger(triggerInfo, items, provider, log);
}

// ============================================
// Generic automation webhooks (automationId → trigger → run)
// ============================================

async function processAutomationInbox(
	row: triggerService.WebhookInboxRow,
	log: typeof logger,
): Promise<void> {
	const triggerInfo = await automations.findWebhookTrigger(row.identityValue);
	if (!triggerInfo) {
		log.info({ automationId: row.identityValue }, "Webhook trigger not found");
		return;
	}

	if (!triggerInfo.automation?.enabled) {
		log.info({ automationId: row.identityValue }, "Automation disabled");
		return;
	}

	// Compute dedup key from payload hash
	const payloadHash = createHash("sha256").update(JSON.stringify(row.payload)).digest("hex");
	const dedupKey = `webhook:${payloadHash}`;

	// Check dedup (5-minute window)
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
	const existing = await triggerService.findDuplicateEventByDedupKey(
		triggerInfo.id,
		dedupKey,
		fiveMinutesAgo,
	);
	if (existing) {
		log.info({ triggerId: triggerInfo.id }, "Duplicate event detected");
		return;
	}

	const parsedContext = {
		title: "Webhook Received",
		summary: `Automation webhook received at ${row.receivedAt.toISOString()}`,
		source: "webhook",
		timestamp: row.receivedAt.toISOString(),
		payload: row.payload,
	};

	await runs.createRunFromTriggerEvent({
		triggerId: triggerInfo.id,
		organizationId: triggerInfo.organizationId,
		automationId: triggerInfo.automation?.id ?? row.identityValue,
		externalEventId: `webhook:${row.receivedAt.toISOString()}`,
		providerEventType: "webhook:received",
		rawPayload: row.payload as Record<string, unknown>,
		parsedContext,
		dedupKey,
	});
}

// ============================================
// Helpers
// ============================================

/**
 * Process parsed items for a single trigger (PostHog/provider-specific path).
 */
async function processItemsForSingleTrigger(
	triggerInfo: {
		id: string;
		organizationId: string;
		provider: string;
		config: unknown;
		automation: { id: string; enabled: boolean | null } | null;
	},
	items: unknown[],
	provider: TriggerProvider<unknown, unknown, unknown>,
	log: typeof logger,
): Promise<void> {
	if (!triggerInfo.automation?.enabled) {
		log.info({ triggerId: triggerInfo.id }, "Automation disabled");
		return;
	}

	const config = (triggerInfo.config || {}) as Record<string, unknown>;

	for (const item of items) {
		// Apply provider filter
		if (!provider.filter(item, config)) {
			continue;
		}

		// Dedup check
		const dedupKey = provider.computeDedupKey(item);
		if (dedupKey) {
			const isDuplicate = await triggerService.eventExistsByDedupKey(triggerInfo.id, dedupKey);
			if (isDuplicate) {
				continue;
			}
		}

		const parsedContext = provider.parseContext(item) as unknown as Record<string, unknown>;

		try {
			await runs.createRunFromTriggerEvent({
				triggerId: triggerInfo.id,
				organizationId: triggerInfo.organizationId,
				automationId: triggerInfo.automation.id,
				externalEventId: provider.extractExternalId(item),
				providerEventType: provider.getEventType(item),
				rawPayload: item as Record<string, unknown>,
				parsedContext,
				dedupKey,
			});
		} catch (err) {
			log.error({ err, triggerId: triggerInfo.id }, "Failed to create run");
		}
	}
}

function computeNextAttempt(attempt: number): Date | null {
	if (attempt >= 5) return null; // Max retries reached
	const delayMs = Math.min(2000 * 2 ** attempt, 300000); // Max 5 min
	return new Date(Date.now() + delayMs);
}

async function safeCreateSkippedEvent(
	trigger: { id: string; organizationId: string },
	row: triggerService.WebhookInboxRow,
	skipReason: string,
): Promise<void> {
	try {
		await triggerService.createSkippedEvent({
			triggerId: trigger.id,
			organizationId: trigger.organizationId,
			externalEventId: null,
			providerEventType: "webhook:received",
			rawPayload: row.payload as Record<string, unknown>,
			parsedContext: null,
			dedupKey: null,
			skipReason,
		});
	} catch (err) {
		logger.error({ err, triggerId: trigger.id }, "Failed to create skipped event");
	}
}
