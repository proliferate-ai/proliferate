import {
	type Job,
	type ScheduledJob,
	addScheduledJob,
	createScheduledQueue,
	createScheduledWorker,
} from "@proliferate/queue";
import { runs, triggers } from "@proliferate/services";
import { logger as rootLogger } from "../lib/logger.js";

const logger = rootLogger.child({ module: "scheduled-worker" });

function buildScheduledDedupKey(job: Job<ScheduledJob>, triggerId: string): string {
	if (job.id) {
		return `scheduled:${job.id}`;
	}
	return `scheduled:${triggerId}:${job.timestamp}`;
}

function buildScheduledPayload(
	triggerId: string,
	cronExpression: string,
	firedAt: string,
	jobId: string | null,
): Record<string, unknown> {
	return {
		type: "scheduled_trigger",
		trigger_id: triggerId,
		cron_expression: cronExpression,
		fired_at: firedAt,
		job_id: jobId,
	};
}

function buildScheduledContext(cronExpression: string, firedAt: string): Record<string, unknown> {
	return {
		title: "Scheduled run",
		description: `Triggered by cron: ${cronExpression}`,
		fired_at: firedAt,
	};
}

async function safeCreateSkippedEvent(input: Parameters<typeof triggers.createSkippedEvent>[0]) {
	try {
		await triggers.createSkippedEvent(input);
	} catch (err) {
		logger.error({ err, triggerId: input.triggerId }, "Failed to create skipped scheduled event");
	}
}

/**
 * Process one scheduled cron job.
 */
async function processScheduledJob(job: Job<ScheduledJob>): Promise<void> {
	const { triggerId } = job.data;
	const trigger = await triggers.findTriggerWithAutomationById(triggerId);

	if (!trigger) {
		logger.debug({ triggerId }, "Scheduled trigger not found");
		return;
	}

	if (trigger.provider !== "scheduled") {
		logger.debug({ triggerId, provider: trigger.provider }, "Ignoring non-scheduled trigger job");
		return;
	}

	if (!trigger.enabled || !trigger.pollingCron) {
		logger.debug({ triggerId, enabled: trigger.enabled }, "Scheduled trigger disabled or missing cron");
		return;
	}

	const dedupKey = buildScheduledDedupKey(job, trigger.id);
	const duplicate = await triggers.eventExistsByDedupKey(trigger.id, dedupKey);
	if (duplicate) {
		logger.debug({ triggerId: trigger.id, dedupKey }, "Duplicate scheduled trigger event");
		return;
	}

	const firedAt = new Date(job.timestamp).toISOString();
	const rawPayload = buildScheduledPayload(
		trigger.id,
		trigger.pollingCron,
		firedAt,
		job.id ? String(job.id) : null,
	);
	const parsedContext = buildScheduledContext(trigger.pollingCron, firedAt);

	if (!trigger.automation || !trigger.automation.enabled) {
		await safeCreateSkippedEvent({
			triggerId: trigger.id,
			organizationId: trigger.organizationId,
			externalEventId: dedupKey,
			providerEventType: "scheduled",
			rawPayload,
			parsedContext,
			dedupKey,
			skipReason: "automation_disabled",
		});
		return;
	}

	try {
		await runs.createRunFromTriggerEvent({
			triggerId: trigger.id,
			organizationId: trigger.organizationId,
			automationId: trigger.automationId,
			externalEventId: dedupKey,
			providerEventType: "scheduled",
			rawPayload,
			parsedContext,
			dedupKey,
		});

		logger.debug({ triggerId: trigger.id, jobId: job.id }, "Scheduled trigger processed");
	} catch (err) {
		logger.error({ err, triggerId: trigger.id, jobId: job.id }, "Failed to process scheduled trigger");
		await safeCreateSkippedEvent({
			triggerId: trigger.id,
			organizationId: trigger.organizationId,
			externalEventId: dedupKey,
			providerEventType: "scheduled",
			rawPayload,
			parsedContext,
			dedupKey,
			skipReason: "run_create_failed",
		});
	}
}

/**
 * Start the scheduled trigger worker.
 */
export function startScheduledWorker() {
	const worker = createScheduledWorker(processScheduledJob);

	worker.on("failed", (job, err) => {
		logger.error({ err, jobId: job?.id }, "Scheduled trigger job failed");
	});

	logger.info("Scheduled trigger worker started");
	return worker;
}

/**
 * Schedule all enabled cron triggers as repeatable BullMQ jobs.
 * Called at startup to ensure scheduled triggers are restored.
 */
export async function scheduleEnabledScheduledTriggers(): Promise<void> {
	const queue = createScheduledQueue();
	const scheduledTriggers = await triggers.listEnabledScheduledTriggers();

	for (const scheduledTrigger of scheduledTriggers) {
		try {
			await addScheduledJob(queue, scheduledTrigger.id, scheduledTrigger.pollingCron);
			logger.debug(
				{ triggerId: scheduledTrigger.id, cron: scheduledTrigger.pollingCron },
				"Scheduled cron trigger",
			);
		} catch (err) {
			logger.error(
				{ err, triggerId: scheduledTrigger.id },
				"Failed to schedule cron trigger",
			);
		}
	}

	await queue.close();
	logger.info({ count: scheduledTriggers.length }, "Scheduled enabled cron triggers");
}
