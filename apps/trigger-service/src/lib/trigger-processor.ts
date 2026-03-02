import { automations, runs, triggers, wakes } from "@proliferate/services";
import type { TriggerDefinition, TriggerEvent } from "@proliferate/triggers";
import { logger as rootLogger } from "./logger.js";

const logger = rootLogger.child({ module: "trigger-processor" });

interface ProcessResult {
	processed: number;
	skipped: number;
}

interface TriggerRowLike {
	id: string;
	organizationId: string;
	automationId: string;
	provider: string;
	config: unknown;
	enabled: boolean | null;
	triggerType: string;
}

export async function processTriggerEvents(
	triggerDef: TriggerDefinition,
	triggerRow: TriggerRowLike,
	events: TriggerEvent[],
): Promise<ProcessResult> {
	let processed = 0;
	let skipped = 0;

	const automation = await automations.getAutomation(
		triggerRow.automationId,
		triggerRow.organizationId,
	);

	if (!automation || !automation.enabled) {
		for (const event of events) {
			await safeCreateSkippedEvent({
				triggerId: triggerRow.id,
				organizationId: triggerRow.organizationId,
				externalEventId: event.externalId,
				providerEventType: inferProviderEventType(triggerRow.provider, event.payload),
				rawPayload: toRawPayload(event.payload),
				parsedContext: null,
				dedupKey: triggerDef.idempotencyKey(event),
				skipReason: "automation_disabled",
			});
			skipped++;
		}
		return { processed, skipped };
	}

	// V1 Bridge: if automation is bound to a V1 worker, create wake_events instead of runs
	const workerId = await automations.getAutomationWorkerId(
		triggerRow.automationId,
		triggerRow.organizationId,
	);
	if (workerId) {
		return bridgeToWakeEvents(workerId, triggerRow, triggerDef, events);
	}

	const parsedConfig = triggerDef.configSchema.safeParse(triggerRow.config ?? {});
	const config = parsedConfig.success ? parsedConfig.data : (triggerRow.config ?? {});

	for (const event of events) {
		if (!triggerRow.enabled) {
			skipped++;
			continue;
		}

		if (!triggerDef.filter(event, config)) {
			await safeCreateSkippedEvent({
				triggerId: triggerRow.id,
				organizationId: triggerRow.organizationId,
				externalEventId: event.externalId,
				providerEventType: inferProviderEventType(triggerRow.provider, event.payload),
				rawPayload: toRawPayload(event.payload),
				parsedContext: null,
				dedupKey: triggerDef.idempotencyKey(event),
				skipReason: "filter_mismatch",
			});
			skipped++;
			continue;
		}

		const dedupKey = triggerDef.idempotencyKey(event);
		if (dedupKey) {
			const isDuplicate = await triggers.eventExistsByDedupKey(triggerRow.id, dedupKey);
			if (isDuplicate) {
				skipped++;
				continue;
			}
		}

		const parsedContext = triggerDef.context(event) as Record<string, unknown>;
		const providerEventType = inferProviderEventType(triggerRow.provider, event.payload);

		try {
			await runs.createRunFromTriggerEvent({
				triggerId: triggerRow.id,
				organizationId: triggerRow.organizationId,
				automationId: automation.id,
				externalEventId: event.externalId,
				providerEventType,
				rawPayload: toRawPayload(event.payload),
				parsedContext,
				dedupKey,
			});

			processed++;
		} catch (err) {
			logger.error({ err, triggerId: triggerRow.id }, "Failed to create automation run");
			await safeCreateSkippedEvent({
				triggerId: triggerRow.id,
				organizationId: triggerRow.organizationId,
				externalEventId: event.externalId,
				providerEventType,
				rawPayload: toRawPayload(event.payload),
				parsedContext,
				dedupKey,
				skipReason: "run_create_failed",
			});
			skipped++;
		}
	}

	return { processed, skipped };
}

async function safeCreateSkippedEvent(input: Parameters<typeof triggers.createSkippedEvent>[0]) {
	try {
		await triggers.createSkippedEvent(input);
	} catch (err) {
		logger.error({ err }, "Failed to create skipped event");
	}
}

function inferProviderEventType(provider: string, payload: unknown): string | null {
	if (provider === "github") {
		const p = payload as { eventType?: string; action?: string };
		if (!p.eventType) return null;
		return p.action ? `${p.eventType}:${p.action}` : p.eventType;
	}
	if (provider === "linear") {
		const p = payload as { action?: string };
		return p.action ? `Issue:${p.action}` : "Issue";
	}
	if (provider === "gmail") {
		return "message_received";
	}
	return null;
}

function toRawPayload(payload: unknown): Record<string, unknown> {
	if (payload && typeof payload === "object" && !Array.isArray(payload)) {
		return payload as Record<string, unknown>;
	}
	return { payload } as Record<string, unknown>;
}

/**
 * V1 Bridge: route trigger events to wake_events(source=webhook) for a V1 worker.
 * Deduplicates by checking for an existing queued webhook wake before creating.
 */
async function bridgeToWakeEvents(
	workerId: string,
	triggerRow: TriggerRowLike,
	triggerDef: TriggerDefinition,
	events: TriggerEvent[],
): Promise<ProcessResult> {
	let processed = 0;
	let skipped = 0;

	for (const event of events) {
		const dedupKey = triggerDef.idempotencyKey(event);
		const providerEventType = inferProviderEventType(triggerRow.provider, event.payload);
		const rawPayload = toRawPayload(event.payload);

		if (!triggerDef.filter(event, triggerRow.config ?? {})) {
			await safeCreateSkippedEvent({
				triggerId: triggerRow.id,
				organizationId: triggerRow.organizationId,
				externalEventId: event.externalId,
				providerEventType,
				rawPayload,
				parsedContext: null,
				dedupKey,
				skipReason: "filter_mismatch",
			});
			skipped++;
			continue;
		}

		if (dedupKey) {
			const isDuplicate = await triggers.eventExistsByDedupKey(triggerRow.id, dedupKey);
			if (isDuplicate) {
				skipped++;
				continue;
			}
		}

		const parsedContext = triggerDef.context(event) as Record<string, unknown>;

		try {
			await wakes.createWakeEvent({
				workerId,
				organizationId: triggerRow.organizationId,
				source: "webhook",
				payloadJson: {
					triggerId: triggerRow.id,
					provider: triggerRow.provider,
					externalEventId: event.externalId,
					context: parsedContext,
					dedupeKey: dedupKey ?? undefined,
				},
			});
			await triggers.createEvent({
				triggerId: triggerRow.id,
				organizationId: triggerRow.organizationId,
				externalEventId: event.externalId,
				providerEventType,
				rawPayload,
				parsedContext,
				dedupKey,
				status: "queued",
			});
			processed++;
		} catch (err) {
			logger.error(
				{ err, workerId, triggerId: triggerRow.id },
				"Failed to create wake event for V1 bridge",
			);
			await safeCreateSkippedEvent({
				triggerId: triggerRow.id,
				organizationId: triggerRow.organizationId,
				externalEventId: event.externalId,
				providerEventType,
				rawPayload,
				parsedContext,
				dedupKey,
				skipReason: "wake_create_failed",
			});
			skipped++;
		}
	}

	if (processed > 0) {
		logger.info(
			{ workerId, triggerId: triggerRow.id, processed, skipped },
			"V1 bridge: routed trigger events to wake_events",
		);
	}

	return { processed, skipped };
}
