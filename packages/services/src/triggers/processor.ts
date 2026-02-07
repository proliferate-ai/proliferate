/**
 * Trigger Event Processor
 *
 * Shared logic for processing trigger events from webhooks.
 * Used by the web app's Nango webhook handler.
 */

import type { TriggerProvider } from "@proliferate/triggers";
import * as automationsDb from "../automations/db";
import { getServicesLogger } from "../logger";
import * as runsService from "../runs/service";
import type { TriggerRow } from "../types/triggers";
import * as triggersDb from "./db";

// ============================================
// Types
// ============================================

export interface ProcessResult {
	processed: number;
	skipped: number;
}

export interface ProcessableItem {
	/** Raw item from provider.parseWebhook() */
	item: unknown;
	/** Provider that parsed this item */
	provider: TriggerProvider<unknown, unknown, unknown>;
}

// ============================================
// Main processor
// ============================================

/**
 * Process trigger events for a list of triggers.
 *
 * For each trigger, filters events, dedupes, creates event records,
 * and spawns sessions via the Gateway.
 */
export async function processTriggerEvents(
	triggers: TriggerRow[],
	items: ProcessableItem[],
): Promise<ProcessResult> {
	let processed = 0;
	let skipped = 0;

	for (const trigger of triggers) {
		for (const { item, provider } of items) {
			const result = await processEventForTrigger(trigger, item, provider);
			processed += result.processed;
			skipped += result.skipped;
		}
	}

	return { processed, skipped };
}

/**
 * Process a single event for a single trigger.
 */
async function processEventForTrigger(
	trigger: TriggerRow,
	item: unknown,
	provider: TriggerProvider<unknown, unknown, unknown>,
): Promise<ProcessResult> {
	// Skip if trigger is disabled
	if (!trigger.enabled) {
		return { processed: 0, skipped: 1 };
	}

	// Load automation
	const automation = await automationsDb.findById(trigger.automationId, trigger.organizationId);
	if (!automation || !automation.enabled) {
		await safeCreateSkippedEvent(trigger, item, provider, "automation_disabled");
		return { processed: 0, skipped: 1 };
	}

	// Apply provider filter
	const config = (trigger.config || {}) as Record<string, unknown>;
	if (!provider.filter(item, config)) {
		await safeCreateSkippedEvent(trigger, item, provider, "filter_mismatch");
		return { processed: 0, skipped: 1 };
	}

	// Check for duplicate
	const dedupKey = provider.computeDedupKey(item);
	if (dedupKey) {
		const isDuplicate = await triggersDb.eventExistsByDedupKey(trigger.id, dedupKey);
		if (isDuplicate) {
			return { processed: 0, skipped: 1 };
		}
	}

	// Parse context
	const parsedContext = provider.parseContext(item) as unknown as Record<string, unknown>;
	const providerEventType = provider.getEventType(item);

	try {
		await runsService.createRunFromTriggerEvent({
			triggerId: trigger.id,
			organizationId: trigger.organizationId,
			automationId: automation.id,
			externalEventId: provider.extractExternalId(item),
			providerEventType,
			rawPayload: item as Record<string, unknown>,
			parsedContext,
			dedupKey,
		});

		return { processed: 1, skipped: 0 };
	} catch (err) {
		getServicesLogger()
			.child({ module: "trigger-processor", triggerId: trigger.id })
			.error({ err }, "Failed to create automation run for trigger event");
		return { processed: 0, skipped: 1 };
	}
}

// ============================================
// Helpers
// ============================================

async function safeCreateSkippedEvent(
	trigger: TriggerRow,
	item: unknown,
	provider: TriggerProvider<unknown, unknown, unknown>,
	skipReason: string,
): Promise<void> {
	try {
		const parsedContext = provider.parseContext(item);
		const dedupKey = provider.computeDedupKey(item);

		await triggersDb.createSkippedEvent({
			triggerId: trigger.id,
			organizationId: trigger.organizationId,
			externalEventId: provider.extractExternalId(item),
			providerEventType: provider.getEventType(item),
			rawPayload: item as Record<string, unknown>,
			parsedContext: parsedContext as unknown as Record<string, unknown> | null,
			dedupKey,
			skipReason,
		});
	} catch (err) {
		getServicesLogger()
			.child({ module: "trigger-processor", triggerId: trigger.id })
			.error({ err }, "Failed to create skipped event");
	}
}

// Prompt composition is handled by the automation execution worker.
