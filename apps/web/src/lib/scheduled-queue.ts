/**
 * Scheduled Queue Client
 *
 * Provides access to the BullMQ scheduled queue from API routes.
 * Used to manage cron jobs for scheduled triggers.
 */

import { logger } from "@/lib/logger";
import { env } from "@proliferate/environment/server";

const log = logger.child({ module: "scheduled-queue" });
import {
	type AddScheduledJobResult,
	type Queue,
	type ScheduledJob,
	addScheduledJob,
	createScheduledQueue,
	removeScheduledJob,
} from "@proliferate/queue";

let scheduledQueue: Queue<ScheduledJob> | null = null;

/**
 * Get or create the scheduled queue instance.
 * Returns null if REDIS_URL is not configured.
 */
function getScheduledQueue(): Queue<ScheduledJob> | null {
	if (!env.REDIS_URL) {
		log.warn("REDIS_URL not configured, scheduled triggers will not work");
		return null;
	}

	if (!scheduledQueue) {
		scheduledQueue = createScheduledQueue();
	}

	return scheduledQueue;
}

/**
 * Add a scheduled trigger job.
 * Returns the repeat job key to store in the database.
 */
export async function addScheduledTriggerJob(
	triggerId: string,
	cronExpression: string,
): Promise<AddScheduledJobResult | null> {
	const queue = getScheduledQueue();
	if (!queue) {
		log.warn("Queue not available, skipping job creation");
		return null;
	}

	return addScheduledJob(queue, triggerId, cronExpression);
}

/**
 * Remove a scheduled trigger job.
 */
export async function removeScheduledTriggerJob(repeatJobKey: string): Promise<void> {
	const queue = getScheduledQueue();
	if (!queue) {
		log.warn("Queue not available, skipping job removal");
		return;
	}

	await removeScheduledJob(queue, repeatJobKey);
}
