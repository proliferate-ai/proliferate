/**
 * Webhook Inbox Processor — Async processing of raw webhook payloads.
 *
 * Pipeline: parse → hydrate → match → execute (outbox handoff).
 *
 * Each provider has its own processing path:
 *   - nango: parse Nango envelope, resolve integration, dispatch to trigger adapters
 *   - github-app: handle installation lifecycle + dispatch events
 *   - custom: resolve trigger by ID, apply filter, create run
 *   - posthog: resolve automation trigger, apply PostHog filter, create run
 *   - automation: resolve automation webhook trigger, create run
 */

import { automations, integrations, runs, triggers } from "@proliferate/services";
import type { WebhookInboxRow } from "@proliferate/services/webhook-inbox";
import { type TriggerEvent, registry } from "@proliferate/triggers";
import { logger as rootLogger } from "../lib/logger.js";
import { processTriggerEvents } from "../lib/trigger-processor.js";

const logger = rootLogger.child({ module: "inbox-processor" });

// ============================================
// Main entry point
// ============================================

export async function processInboxRow(row: WebhookInboxRow): Promise<void> {
	const payload = row.payload as Record<string, unknown>;

	switch (row.provider) {
		case "nango":
			await processNangoWebhook(row, payload);
			break;
		case "github-app":
			await processGitHubAppWebhook(row, payload);
			break;
		case "custom":
			await processCustomWebhook(row, payload);
			break;
		case "posthog":
			await processPostHogWebhook(row, payload);
			break;
		case "automation":
			await processAutomationWebhook(row, payload);
			break;
		default:
			logger.warn({ provider: row.provider }, "Unknown inbox provider");
	}
}

// ============================================
// Nango
// ============================================

async function processNangoWebhook(
	row: WebhookInboxRow,
	payload: Record<string, unknown>,
): Promise<void> {
	const type = payload.type as string | undefined;

	if (type === "auth") {
		await handleNangoAuth(payload);
		return;
	}

	if (type === "sync") {
		logger.info({ syncName: payload.syncName, success: payload.success }, "Sync completed");
		return;
	}

	if (type === "forward") {
		await handleNangoForward(row, payload);
		return;
	}

	logger.info({ type }, "Unknown Nango webhook type");
}

async function handleNangoAuth(payload: Record<string, unknown>): Promise<void> {
	const connectionId = payload.connectionId as string | undefined;
	if (!connectionId) return;

	const integration = await integrations.findByConnectionIdAndProvider(connectionId, "nango");
	if (!integration) return;

	let newStatus: string | null = null;
	const operation = payload.operation as string | undefined;
	const success = payload.success as boolean | undefined;

	if (operation === "creation" && success) newStatus = "active";
	else if (operation === "override" && success) newStatus = "active";
	else if (operation === "refresh" && !success) newStatus = "error";

	if (newStatus && newStatus !== integration.status) {
		await integrations.updateStatus(integration.id, newStatus);
	}
}

async function handleNangoForward(
	_row: WebhookInboxRow,
	payload: Record<string, unknown>,
): Promise<void> {
	// Re-create a minimal request-like object from stored payload for the dispatcher
	const connectionId = payload.connectionId as string | undefined;
	const providerConfigKey = (payload.providerConfigKey as string) ?? (payload.from as string);

	if (!connectionId || !providerConfigKey) {
		logger.info("Nango forward webhook missing connectionId or provider key");
		return;
	}

	// Find matching trigger definitions from the registry
	const triggerDefs = registry.webhooksByProvider(providerConfigKey);
	if (triggerDefs.length === 0) return;

	// Look up integration
	const integration = await integrations.findByConnectionIdAndProvider(connectionId, "nango");
	if (!integration) {
		logger.info({ connectionId }, "Integration not found for connection");
		return;
	}

	// Find active triggers
	const triggerRows = await triggers.findActiveWebhookTriggers(integration.id);
	if (triggerRows.length === 0) return;

	// Parse events from each trigger definition
	// We create a mock express request to pass to the webhook handler
	for (const triggerDef of triggerDefs) {
		// Build events from the provider's parseWebhook method
		const events: TriggerEvent[] = [];
		try {
			// The inner payload is the actual provider event
			const fakeReq = {
				body: payload,
				headers: {},
				rawBody: JSON.stringify(payload),
			} as unknown as import("express").Request;
			const parsed = await triggerDef.webhook(fakeReq);
			events.push(...parsed);
		} catch (err) {
			logger.error({ err, provider: triggerDef.provider }, "Failed to parse webhook events");
			continue;
		}

		if (events.length === 0) continue;

		for (const triggerRow of triggerRows) {
			if (triggerRow.provider !== triggerDef.provider) continue;
			await processTriggerEvents(triggerDef, triggerRow, events);
		}
	}
}

// ============================================
// GitHub App
// ============================================

async function processGitHubAppWebhook(
	row: WebhookInboxRow,
	payload: Record<string, unknown>,
): Promise<void> {
	const headers = row.headers as Record<string, string> | null;
	const event = headers?.["x-github-event"];
	const installation = payload.installation as { id?: number } | undefined;

	if (!installation?.id) {
		logger.info("GitHub App webhook missing installation ID");
		return;
	}

	// Handle installation lifecycle events
	const action = payload.action as string | undefined;
	if (event === "installation" && action) {
		await handleGitHubInstallationEvent(installation.id, action);
		return;
	}

	// Find integration by GitHub installation ID
	const integration = await integrations.findActiveByGitHubInstallationId(
		installation.id.toString(),
	);
	if (!integration) return;

	// Find active triggers for this integration
	const triggerRows = await triggers.findActiveByIntegrationId(integration.id);
	if (triggerRows.length === 0) return;

	// Get GitHub webhook trigger definitions from registry
	const triggerDefs = registry.webhooksByProvider("github");
	if (triggerDefs.length === 0) return;

	// Parse and process events
	for (const triggerDef of triggerDefs) {
		let events: TriggerEvent[] = [];
		try {
			const fakeReq = {
				body: payload,
				headers: headers ?? {},
				rawBody: JSON.stringify(payload),
			} as unknown as import("express").Request;
			events = await triggerDef.webhook(fakeReq);
		} catch (err) {
			logger.error({ err }, "Failed to parse GitHub webhook events");
			continue;
		}

		if (events.length === 0) continue;

		for (const triggerRow of triggerRows) {
			if (triggerRow.provider !== "github") continue;
			await processTriggerEvents(triggerDef, triggerRow, events);
		}
	}
}

async function handleGitHubInstallationEvent(
	installationId: number,
	action: string,
): Promise<void> {
	const integration = await integrations.findActiveByGitHubInstallationId(
		installationId.toString(),
	);
	if (!integration) return;

	let newStatus: string | null = null;
	if (action === "deleted") newStatus = "deleted";
	else if (action === "suspend") newStatus = "suspended";
	else if (action === "unsuspend") newStatus = "active";

	// findActiveByGitHubInstallationId filters status='active', so always update if different
	if (newStatus) {
		await integrations.updateStatus(integration.id, newStatus);
		logger.info(
			{ integrationId: integration.id, action, newStatus },
			"GitHub installation status updated",
		);
	}
}

// ============================================
// Custom
// ============================================

async function processCustomWebhook(
	row: WebhookInboxRow,
	payload: Record<string, unknown>,
): Promise<void> {
	const triggerId = row.externalId;
	if (!triggerId) {
		logger.warn("Custom webhook missing triggerId in externalId");
		return;
	}

	const triggerRow = await triggers.findTriggerWithAutomationById(triggerId);
	if (!triggerRow || !triggerRow.enabled) return;

	const automation = await automations.getAutomation(
		triggerRow.automationId,
		triggerRow.organizationId,
	);
	if (!automation?.enabled) return;

	// Compute dedup key from payload hash
	const payloadStr = JSON.stringify(payload);
	const crypto = await import("node:crypto");
	const dedupKey = `custom:${crypto.createHash("sha256").update(payloadStr).digest("hex")}`;

	// Check dedup
	const isDuplicate = await triggers.eventExistsByDedupKey(triggerId, dedupKey);
	if (isDuplicate) return;

	await runs.createRunFromTriggerEvent({
		triggerId,
		organizationId: triggerRow.organizationId,
		automationId: automation.id,
		externalEventId: null,
		providerEventType: "custom_webhook",
		rawPayload: payload,
		parsedContext: { payload },
		dedupKey,
	});
}

// ============================================
// PostHog
// ============================================

async function processPostHogWebhook(
	row: WebhookInboxRow,
	payload: Record<string, unknown>,
): Promise<void> {
	const automationId = row.externalId;
	if (!automationId) {
		logger.warn("PostHog webhook missing automationId in externalId");
		return;
	}

	// Find PostHog trigger by automation (query already filters enabled=true)
	const triggerRow = await automations.findTriggerForAutomationByProvider(automationId, "posthog");
	if (!triggerRow) return;

	const automation = triggerRow.automation;
	if (!automation?.enabled) return;

	const event = (payload.event as string) ?? "unknown";
	const uuid = payload.uuid as string | undefined;
	const distinctId = payload.distinct_id as string | undefined;
	const timestamp = payload.timestamp as string | undefined;

	const dedupKey = uuid
		? `posthog:${uuid}`
		: `posthog:${event}:${distinctId ?? ""}:${timestamp ?? ""}`;

	const isDuplicate = await triggers.eventExistsByDedupKey(triggerRow.id, dedupKey);
	if (isDuplicate) return;

	await runs.createRunFromTriggerEvent({
		triggerId: triggerRow.id,
		organizationId: triggerRow.organizationId,
		automationId: automation.id,
		externalEventId: uuid ?? null,
		providerEventType: `posthog:${event}`,
		rawPayload: payload,
		parsedContext: { event, properties: payload.properties ?? {} },
		dedupKey,
	});
}

// ============================================
// Automation (generic)
// ============================================

async function processAutomationWebhook(
	row: WebhookInboxRow,
	payload: Record<string, unknown>,
): Promise<void> {
	const automationId = row.externalId;
	if (!automationId) {
		logger.warn("Automation webhook missing automationId in externalId");
		return;
	}

	// findWebhookTrigger already filters enabled=true
	const triggerRow = await automations.findWebhookTrigger(automationId);
	if (!triggerRow) return;

	const automation = triggerRow.automation;
	if (!automation?.enabled) return;

	// Dedup by payload hash
	const payloadStr = JSON.stringify(payload);
	const crypto = await import("node:crypto");
	const dedupKey = `automation:${crypto.createHash("sha256").update(payloadStr).digest("hex")}`;

	const isDuplicate = await triggers.eventExistsByDedupKey(triggerRow.id, dedupKey);
	if (isDuplicate) return;

	await runs.createRunFromTriggerEvent({
		triggerId: triggerRow.id,
		organizationId: triggerRow.organizationId,
		automationId: automation.id,
		externalEventId: null,
		providerEventType: "automation_webhook",
		rawPayload: payload,
		parsedContext: { payload },
		dedupKey,
	});
}
