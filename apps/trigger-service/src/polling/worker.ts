/**
 * Polling Worker — BullMQ worker that processes poll groups.
 *
 * Instead of one job per trigger, we schedule one job per poll group
 * (unique provider + integration + cron combo). The worker:
 *   1. Fetches the poll group row.
 *   2. Finds all active triggers in the group.
 *   3. Polls the provider ONCE using the shared connection.
 *   4. Fans out events in-memory to each trigger's filter/match logic.
 *
 * This avoids the "Polling Fan-Out Multiplier" trap where N triggers
 * on the same connection would make N identical API calls.
 */

import { createPollingWorker } from "@proliferate/queue";
import { pollGroups, triggers as triggerService } from "@proliferate/services";
import type { PollingTrigger } from "@proliferate/triggers";
import { registry } from "@proliferate/triggers";
import { logger as rootLogger } from "../lib/logger.js";
import { processTriggerEvents } from "../lib/trigger-processor.js";

const logger = rootLogger.child({ module: "polling" });

export function startPollingWorker() {
	const worker = createPollingWorker(async (job) => {
		const pollGroupId = job.data.triggerId; // reusing PollingJob.triggerId field for group ID

		const group = await pollGroups.findById(pollGroupId);
		if (!group || !group.enabled) return;

		// Find all active triggers in this group
		const triggerRows = await pollGroups.findTriggersForGroup(group);
		if (triggerRows.length === 0) return;

		// Get the polling trigger definition from the registry
		const pollingTrigger = registry.pollingByProvider(group.provider)[0] as
			| PollingTrigger
			| undefined;
		if (!pollingTrigger) return;

		// Get connectionId from the first trigger's integration
		const connectionId = triggerRows[0]?.integration?.connectionId ?? undefined;
		if (!connectionId) {
			logger.warn({ pollGroupId, provider: group.provider }, "No connectionId for poll group");
			return;
		}

		// Parse cursor from group row
		const cursor = (group.cursor as { cursor?: string | null } | null)?.cursor ?? null;

		// Poll the provider ONCE for the entire group
		const result = await pollingTrigger.poll(
			{ connectionId, provider: group.provider },
			{}, // config is per-trigger, not per-group — filters handle specifics
			cursor,
		);

		// Update the group's cursor
		await pollGroups.updateCursor(group.id, { cursor: result.cursor ?? null });

		if (result.events.length === 0) return;

		// Fan out: evaluate each trigger's filter against the events
		for (const triggerRow of triggerRows) {
			// Also update per-trigger lastPolledAt for observability
			await triggerService.updatePollingState(triggerRow.id, {
				lastPolledAt: new Date(),
			});

			await processTriggerEvents(pollingTrigger, triggerRow, result.events);
		}
	});

	return worker;
}
