/**
 * Poll Group Worker — Per-group fan-out polling.
 *
 * vNext replacement for per-trigger polling. Instead of scheduling one BullMQ
 * job per trigger (which causes N API calls for N triggers against the same
 * provider), this worker schedules one job per poll group (org + provider + integration).
 *
 * The worker:
 * 1. Acquires a Redis lock to prevent concurrent polls for the same group
 * 2. Calls the provider's poll() method ONCE for the group
 * 3. Fans out events in-memory to all active triggers in the group
 * 4. Updates the group cursor in the database
 *
 * This turns an O(N) network fan-out into a single API call + O(N) in-memory matching.
 */

import {
	type PollGroupJob,
	REDIS_KEYS,
	createPollGroupQueue,
	createPollGroupWorker,
	getRedisClient,
} from "@proliferate/queue";
import { integrations, pollGroups } from "@proliferate/services";
import type { PollingTrigger } from "@proliferate/triggers";
import { registry } from "@proliferate/triggers";
import type { Job } from "bullmq";
import { logger as rootLogger } from "../lib/logger.js";
import { processTriggerEvents } from "../lib/trigger-processor.js";

const logger = rootLogger.child({ module: "poll-groups" });

const LOCK_TTL_SECONDS = 120;

/**
 * Process a poll group job: poll once, fan out to all triggers in the group.
 */
async function processPollGroup(job: Job<PollGroupJob>): Promise<void> {
	const { groupId } = job.data;
	const redis = getRedisClient();

	const group = await pollGroups.findGroupById(groupId);
	if (!group || !group.enabled) return;

	// Acquire Redis lock to prevent concurrent polls for the same group
	const lockKey = REDIS_KEYS.pollGroupLock(groupId);
	const lockAcquired = await redis.set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX");
	if (!lockAcquired) {
		logger.debug({ groupId }, "Poll group already locked, skipping");
		return;
	}

	try {
		// Find the polling trigger implementation for this provider
		const pollingTrigger = registry.pollingByProvider(group.provider)[0] as
			| PollingTrigger
			| undefined;
		if (!pollingTrigger) {
			logger.warn({ groupId, provider: group.provider }, "No polling trigger for provider");
			return;
		}

		// Find all active triggers in this group
		const groupTriggers = await pollGroups.findTriggersForGroup(
			group.organizationId,
			group.provider,
			group.integrationId,
		);
		if (groupTriggers.length === 0) {
			logger.debug({ groupId }, "No active triggers for poll group");
			return;
		}

		// Resolve connection info from the first trigger's integration
		// All triggers in the group share the same integration
		const firstTrigger = groupTriggers[0];
		const connectionId = firstTrigger.integrationId
			? await resolveConnectionId(firstTrigger.integrationId)
			: undefined;

		if (!connectionId) {
			logger.warn({ groupId }, "No connectionId for poll group");
			return;
		}

		// Poll ONCE for the entire group
		const cursor = group.cursor as string | null;
		const result = await pollingTrigger.poll(
			{ connectionId, provider: group.provider },
			{}, // Group-level config (unused, trigger-level config used for matching)
			cursor,
		);

		// Update cursor in database
		await pollGroups.updateGroupCursor(groupId, result.cursor ?? null, new Date());

		if (result.events.length === 0) return;

		// In-memory fan-out: run each event against each trigger in the group
		for (const triggerRow of groupTriggers) {
			await processTriggerEvents(pollingTrigger, triggerRow, result.events);
		}

		logger.debug(
			{ groupId, events: result.events.length, triggers: groupTriggers.length },
			"Poll group processed",
		);
	} finally {
		// Release lock
		await redis.del(lockKey);
	}
}

/**
 * Resolve connectionId from an integrationId.
 */
async function resolveConnectionId(integrationId: string): Promise<string | null> {
	const integration = await integrations.findById(integrationId);
	return integration?.connectionId ?? null;
}

/**
 * Start the poll group worker.
 */
export function startPollGroupWorker() {
	const worker = createPollGroupWorker(processPollGroup);

	worker.on("failed", (job, err) => {
		logger.error({ err, jobId: job?.id }, "Poll group job failed");
	});

	logger.info("Poll group worker started");
	return worker;
}

/**
 * Schedule all enabled poll groups as repeatable BullMQ jobs.
 * Called at startup to ensure all groups are scheduled.
 */
export async function scheduleEnabledPollGroups(): Promise<void> {
	const { schedulePollGroupJob } = await import("@proliferate/queue");
	const queue = createPollGroupQueue();
	const groups = await pollGroups.listEnabledGroups();

	for (const group of groups) {
		try {
			await schedulePollGroupJob(queue, group.id, group.cronExpression);
			logger.debug({ groupId: group.id, cron: group.cronExpression }, "Scheduled poll group");
		} catch (err) {
			logger.error({ err, groupId: group.id }, "Failed to schedule poll group");
		}
	}

	await queue.close();
	logger.info({ count: groups.length }, "Scheduled enabled poll groups");
}
