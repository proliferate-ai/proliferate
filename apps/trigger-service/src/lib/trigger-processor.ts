import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import { automations, sessions, triggers } from "@proliferate/services";
import type { TriggerDefinition, TriggerEvent } from "@proliferate/triggers";

const GATEWAY_URL = env.NEXT_PUBLIC_GATEWAY_URL;
const SERVICE_TO_SERVICE_AUTH_TOKEN = env.SERVICE_TO_SERVICE_AUTH_TOKEN;

const syncClient = createSyncClient({
	baseUrl: GATEWAY_URL,
	auth: { type: "service", name: "trigger-service", secret: SERVICE_TO_SERVICE_AUTH_TOKEN },
	source: "automation",
});

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

		const triggerEvent = await triggers.createEvent({
			triggerId: triggerRow.id,
			organizationId: triggerRow.organizationId,
			externalEventId: event.externalId,
			providerEventType,
			rawPayload: toRawPayload(event.payload),
			parsedContext,
			dedupKey,
			status: "processing",
		});

		try {
			const prebuildId = automation.default_prebuild_id ?? null;
			if (!prebuildId) {
				throw new Error("Automation missing default prebuild");
			}

			const prompt = buildPrompt(automation.agent_instructions, parsedContext);
			const title = buildTitle(automation.name, parsedContext);

			const session = await syncClient.createSession({
				organizationId: triggerRow.organizationId,
				prebuildId,
				sessionType: "coding",
				clientType: "automation",
				initialPrompt: prompt,
				title,
				automationId: automation.id,
				triggerId: triggerRow.id,
				triggerEventId: triggerEvent.id,
				agentConfig: automation.model_id ? { modelId: automation.model_id } : undefined,
				clientMetadata: {
					automationId: automation.id,
					triggerId: triggerRow.id,
					triggerEventId: triggerEvent.id,
					provider: triggerRow.provider,
					context: parsedContext,
				},
			});

			await sessions.update(session.sessionId, {
				automationId: automation.id,
				triggerId: triggerRow.id,
				triggerEventId: triggerEvent.id,
			});

			await triggers.updateEvent(triggerEvent.id, {
				status: "completed",
				sessionId: session.sessionId,
				processedAt: new Date(),
			});

			processed++;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await triggers.updateEvent(triggerEvent.id, {
				status: "failed",
				errorMessage: message,
				processedAt: new Date(),
			});
		}
	}

	return { processed, skipped };
}

async function safeCreateSkippedEvent(input: Parameters<typeof triggers.createSkippedEvent>[0]) {
	try {
		await triggers.createSkippedEvent(input);
	} catch (err) {
		console.error("Failed to create skipped event:", err);
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

function buildPrompt(
	instructions: string | null | undefined,
	context: Record<string, unknown>,
): string {
	const parts: string[] = [];
	if (instructions?.trim()) {
		parts.push(instructions.trim());
	}
	parts.push(`Trigger context:\n${JSON.stringify(context, null, 2)}`);
	return parts.join("\n\n");
}

function buildTitle(name: string, context: Record<string, unknown>): string {
	const title = (context as { title?: string }).title;
	if (title) return `${name} · ${title}`;
	return name;
}

function toRawPayload(payload: unknown): Record<string, unknown> {
	if (payload && typeof payload === "object" && !Array.isArray(payload)) {
		return payload as Record<string, unknown>;
	}
	return { payload } as Record<string, unknown>;
}
