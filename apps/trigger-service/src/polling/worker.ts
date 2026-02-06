import { REDIS_KEYS, createPollingWorker, getRedisClient } from "@proliferate/queue";
import { triggers as triggerService } from "@proliferate/services";
import type { PollingTrigger } from "@proliferate/triggers";
import { registry } from "@proliferate/triggers";
import { processTriggerEvents } from "../lib/trigger-processor.js";

interface PollStateRecord {
	cursor: string | null;
}

export function startPollingWorker() {
	const redis = getRedisClient();

	const worker = createPollingWorker(async (job) => {
		const triggerId = job.data.triggerId;
		const triggerRow = await triggerService.findByIdWithIntegrationNoOrg(triggerId);
		if (!triggerRow) return;
		if (!triggerRow.enabled) return;
		if (triggerRow.triggerType !== "polling") return;

		const pollingTrigger = registry.pollingByProvider(triggerRow.provider)[0] as
			| PollingTrigger
			| undefined;
		if (!pollingTrigger) return;

		const connectionId = triggerRow.integration?.connectionId ?? undefined;
		if (!connectionId) {
			console.warn("[Polling] Missing integration connectionId for trigger", triggerId);
			return;
		}

		const rawState = await redis.get(REDIS_KEYS.pollState(triggerId));
		let cursor: string | null = null;
		if (rawState) {
			try {
				const parsed = JSON.parse(rawState) as PollStateRecord;
				cursor = parsed.cursor ?? null;
			} catch {
				cursor = rawState;
			}
		}

		const result = await pollingTrigger.poll(
			{ connectionId, provider: triggerRow.provider },
			(triggerRow.config ?? {}) as Record<string, unknown>,
			cursor,
		);

		await redis.set(
			REDIS_KEYS.pollState(triggerId),
			JSON.stringify({ cursor: result.cursor ?? null }),
		);

		await triggerService.updatePollingState(triggerId, {
			pollingState: { cursor: result.cursor ?? null },
			lastPolledAt: new Date(),
		});

		if (result.events.length === 0) return;
		await processTriggerEvents(pollingTrigger, triggerRow, result.events);
	});

	return worker;
}
