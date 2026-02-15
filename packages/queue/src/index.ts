import { env } from "@proliferate/environment/server";
import { type ConnectionOptions, type Job, type JobsOptions, Queue, Worker } from "bullmq";
import IORedis from "ioredis";

// Queue names
export const QUEUE_NAMES = {
	TRIGGER_EVENTS: "trigger-events",
	POLLING: "polling",
	SCHEDULED: "scheduled",
	AUTOMATION_ENRICH: "automation-enrich",
	AUTOMATION_EXECUTE: "automation-execute",
	AUTOMATION_FINALIZE: "automation-finalize",
	BASE_SNAPSHOT_BUILDS: "base-snapshot-builds",
} as const;

// ============================================
// Job Types (Minimal - IDs only)
// ============================================

/**
 * Job to process a single trigger event.
 * Worker fetches event details from database.
 */
export interface TriggerEventJob {
	eventId: string; // FK to trigger_events.id
}

/**
 * Job to execute a scheduled poll for a trigger.
 * Worker fetches trigger config and state from database/Redis.
 */
export interface PollingJob {
	triggerId: string; // FK to triggers.id
}

/**
 * Job to execute a scheduled (cron) trigger.
 * Worker creates a trigger event when the cron fires.
 */
export interface ScheduledJob {
	triggerId: string; // FK to triggers.id
}

/**
 * Job to enrich a single automation run.
 */
export interface AutomationEnrichJob {
	runId: string; // FK to automation_runs.id
}

/**
 * Job to execute a single automation run.
 */
export interface AutomationExecuteJob {
	runId: string; // FK to automation_runs.id
}

/**
 * Job to finalize a single automation run (optional).
 */
export interface AutomationFinalizeJob {
	runId: string;
}

/**
 * Job to build a base sandbox snapshot (Layer 1).
 * Worker computes version key and builds if needed.
 */
export interface BaseSnapshotBuildJob {
	versionKey: string;
	provider: string;
	modalAppName: string;
}

/**
 * Result of adding a scheduled job.
 * Contains the repeat job key needed to remove the job later.
 */
export interface AddScheduledJobResult {
	repeatJobKey: string;
}

// ============================================
// Connection Options
// ============================================

let cachedConnection: ConnectionOptions | null = null;
let redisClient: IORedis | null = null;

/**
 * Get BullMQ connection options from environment
 */
export function getConnectionOptions(): ConnectionOptions {
	if (cachedConnection) return cachedConnection;

	const redisUrl = env.REDIS_URL;
	if (!redisUrl) {
		throw new Error("REDIS_URL environment variable is not set");
	}

	cachedConnection = {
		url: redisUrl,
		maxRetriesPerRequest: null,
		enableReadyCheck: false,
	} as ConnectionOptions;

	return cachedConnection;
}

/**
 * Get or create a shared Redis client for state operations.
 * Use this for poll state storage, not queue operations.
 */
export function getRedisClient(): IORedis {
	if (redisClient) return redisClient;

	const redisUrl = env.REDIS_URL;
	if (!redisUrl) {
		throw new Error("REDIS_URL environment variable is not set");
	}

	redisClient = new IORedis(redisUrl, {
		maxRetriesPerRequest: 3,
		enableReadyCheck: true,
		lazyConnect: true,
	});

	return redisClient;
}

/**
 * Close the shared Redis client (for graceful shutdown)
 */
export async function closeRedisClient(): Promise<void> {
	if (redisClient) {
		await redisClient.quit();
		redisClient = null;
	}
}

// ============================================
// Redis Key Helpers
// ============================================

export const REDIS_KEYS = {
	/**
	 * Poll state for a trigger: poll:{triggerId}
	 */
	pollState: (triggerId: string) => `poll:${triggerId}`,

	/**
	 * Lock during poll execution: poll:lock:{triggerId}
	 * TTL: 120 seconds
	 */
	pollLock: (triggerId: string) => `poll:lock:${triggerId}`,
} as const;

// ============================================
// Job Options
// ============================================

const triggerEventJobOptions: JobsOptions = {
	attempts: 3,
	backoff: {
		type: "exponential",
		delay: 1000,
	},
	removeOnComplete: {
		age: 86400, // 24 hours
		count: 1000,
	},
	removeOnFail: {
		age: 604800, // 7 days
		count: 1000,
	},
};

const pollingJobOptions: JobsOptions = {
	attempts: 2,
	backoff: {
		type: "fixed",
		delay: 5000,
	},
	removeOnComplete: {
		age: 3600, // 1 hour
		count: 100,
	},
	removeOnFail: {
		age: 86400, // 24 hours
		count: 100,
	},
};

const scheduledJobOptions: JobsOptions = {
	attempts: 3,
	backoff: {
		type: "exponential",
		delay: 1000,
	},
	removeOnComplete: {
		age: 86400, // 24 hours
		count: 1000,
	},
	removeOnFail: {
		age: 604800, // 7 days
		count: 1000,
	},
};

const automationJobOptions: JobsOptions = {
	attempts: 3,
	backoff: {
		type: "exponential",
		delay: 2000,
	},
	removeOnComplete: {
		age: 86400, // 24 hours
		count: 1000,
	},
	removeOnFail: {
		age: 604800, // 7 days
		count: 1000,
	},
};

const baseSnapshotBuildJobOptions: JobsOptions = {
	attempts: 3,
	backoff: {
		type: "exponential",
		delay: 10000, // 10s initial — base snapshot builds are slow (~60s)
	},
	removeOnComplete: {
		age: 86400, // 24 hours
		count: 100,
	},
	removeOnFail: {
		age: 604800, // 7 days
		count: 100,
	},
};

// ============================================
// Queue Factories
// ============================================

/**
 * Create the trigger events queue
 */
export function createTriggerEventsQueue(connection?: ConnectionOptions): Queue<TriggerEventJob> {
	return new Queue<TriggerEventJob>(QUEUE_NAMES.TRIGGER_EVENTS, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: triggerEventJobOptions,
	});
}

/**
 * Create the polling jobs queue
 */
export function createPollingQueue(connection?: ConnectionOptions): Queue<PollingJob> {
	return new Queue<PollingJob>(QUEUE_NAMES.POLLING, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: pollingJobOptions,
	});
}

/**
 * Create the scheduled jobs queue (for cron triggers)
 */
export function createScheduledQueue(connection?: ConnectionOptions): Queue<ScheduledJob> {
	return new Queue<ScheduledJob>(QUEUE_NAMES.SCHEDULED, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: scheduledJobOptions,
	});
}

/**
 * Create the automation enrich queue
 */
export function createAutomationEnrichQueue(
	connection?: ConnectionOptions,
): Queue<AutomationEnrichJob> {
	return new Queue<AutomationEnrichJob>(QUEUE_NAMES.AUTOMATION_ENRICH, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: automationJobOptions,
	});
}

/**
 * Create the automation execute queue
 */
export function createAutomationExecuteQueue(
	connection?: ConnectionOptions,
): Queue<AutomationExecuteJob> {
	return new Queue<AutomationExecuteJob>(QUEUE_NAMES.AUTOMATION_EXECUTE, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: automationJobOptions,
	});
}

/**
 * Create the automation finalize queue
 */
export function createAutomationFinalizeQueue(
	connection?: ConnectionOptions,
): Queue<AutomationFinalizeJob> {
	return new Queue<AutomationFinalizeJob>(QUEUE_NAMES.AUTOMATION_FINALIZE, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: automationJobOptions,
	});
}

/**
 * Create the base snapshot build queue
 */
export function createBaseSnapshotBuildQueue(
	connection?: ConnectionOptions,
): Queue<BaseSnapshotBuildJob> {
	return new Queue<BaseSnapshotBuildJob>(QUEUE_NAMES.BASE_SNAPSHOT_BUILDS, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: baseSnapshotBuildJobOptions,
	});
}

// ============================================
// Worker Factories
// ============================================

/**
 * Create a worker for processing trigger events
 */
export function createTriggerEventWorker(
	processor: (job: Job<TriggerEventJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<TriggerEventJob> {
	return new Worker<TriggerEventJob>(QUEUE_NAMES.TRIGGER_EVENTS, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 5,
	});
}

/**
 * Create a worker for processing polling jobs
 */
export function createPollingWorker(
	processor: (job: Job<PollingJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<PollingJob> {
	return new Worker<PollingJob>(QUEUE_NAMES.POLLING, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 3,
	});
}

/**
 * Create a worker for processing scheduled (cron) jobs
 */
export function createScheduledWorker(
	processor: (job: Job<ScheduledJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<ScheduledJob> {
	return new Worker<ScheduledJob>(QUEUE_NAMES.SCHEDULED, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 3,
	});
}

/**
 * Create a worker for processing automation enrich jobs
 */
export function createAutomationEnrichWorker(
	processor: (job: Job<AutomationEnrichJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<AutomationEnrichJob> {
	return new Worker<AutomationEnrichJob>(QUEUE_NAMES.AUTOMATION_ENRICH, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 5,
	});
}

/**
 * Create a worker for processing automation execute jobs
 */
export function createAutomationExecuteWorker(
	processor: (job: Job<AutomationExecuteJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<AutomationExecuteJob> {
	return new Worker<AutomationExecuteJob>(QUEUE_NAMES.AUTOMATION_EXECUTE, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 3,
	});
}

/**
 * Create a worker for processing automation finalize jobs
 */
export function createAutomationFinalizeWorker(
	processor: (job: Job<AutomationFinalizeJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<AutomationFinalizeJob> {
	return new Worker<AutomationFinalizeJob>(QUEUE_NAMES.AUTOMATION_FINALIZE, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 2,
	});
}

export function createBaseSnapshotBuildWorker(
	processor: (job: Job<BaseSnapshotBuildJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<BaseSnapshotBuildJob> {
	return new Worker<BaseSnapshotBuildJob>(QUEUE_NAMES.BASE_SNAPSHOT_BUILDS, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 1,
	});
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Queue a trigger event for processing.
 * Called by webhook handler after creating trigger_event record.
 */
export async function queueTriggerEvent(
	queue: Queue<TriggerEventJob>,
	eventId: string,
): Promise<void> {
	await queue.add(`event:${eventId}`, { eventId });
}

/**
 * Queue an automation run for enrichment.
 */
export async function queueAutomationEnrich(
	queue: Queue<AutomationEnrichJob>,
	runId: string,
): Promise<void> {
	await queue.add(`run:${runId}:enrich`, { runId }, { jobId: `run:${runId}:enrich` });
}

/**
 * Queue an automation run for execution.
 */
export async function queueAutomationExecute(
	queue: Queue<AutomationExecuteJob>,
	runId: string,
): Promise<void> {
	await queue.add(`run:${runId}:execute`, { runId }, { jobId: `run:${runId}:execute` });
}

/**
 * Schedule a polling job with a cron pattern.
 * Uses BullMQ repeatable jobs.
 */
export async function schedulePollingJob(
	queue: Queue<PollingJob>,
	triggerId: string,
	cronPattern: string,
): Promise<void> {
	await queue.add(
		`poll_${triggerId}`,
		{ triggerId },
		{
			repeat: {
				pattern: cronPattern,
			},
			jobId: `poll_${triggerId}`,
		},
	);
}

/**
 * Remove a scheduled polling job.
 * Call when trigger is disabled or deleted.
 */
export async function removePollingJob(queue: Queue<PollingJob>, triggerId: string): Promise<void> {
	await queue.removeRepeatable(`poll_${triggerId}`, {
		pattern: "", // Pattern doesn't matter for removal by jobId
	});
}

/**
 * Run a one-off poll immediately (for testing or manual triggers)
 */
export async function triggerImmediatePoll(
	queue: Queue<PollingJob>,
	triggerId: string,
): Promise<void> {
	await queue.add(`poll_${triggerId}_manual`, { triggerId }, { jobId: `poll_${triggerId}_manual` });
}

/**
 * Add a scheduled job with a cron pattern.
 * Returns the repeat job key needed to remove the job later.
 */
export async function addScheduledJob(
	queue: Queue<ScheduledJob>,
	triggerId: string,
	cronPattern: string,
): Promise<AddScheduledJobResult> {
	const job = await queue.add(
		`scheduled:${triggerId}`,
		{ triggerId },
		{
			repeat: {
				pattern: cronPattern,
			},
		},
	);

	// The repeat job key is used to identify and remove the repeatable job
	const repeatJobKey = job.repeatJobKey ?? `scheduled:${triggerId}:::${cronPattern}`;

	return { repeatJobKey };
}

/**
 * Remove a scheduled job by its repeat job key.
 */
export async function removeScheduledJob(
	queue: Queue<ScheduledJob>,
	repeatJobKey: string,
): Promise<void> {
	await queue.removeRepeatableByKey(repeatJobKey);
}

/**
 * Queue a base snapshot build.
 * Uses jobId for deduplication so only one build runs per version+provider+app.
 */
export async function queueBaseSnapshotBuild(
	queue: Queue<BaseSnapshotBuildJob>,
	input: BaseSnapshotBuildJob,
): Promise<void> {
	const jobId = `base-snapshot:${input.provider}:${input.modalAppName}:${input.versionKey.slice(0, 16)}`;
	await queue.add(jobId, input, { jobId });
}

// ============================================
// Slack Queues Re-export
// ============================================

export * from "./slack";

// ============================================
// Re-exports
// ============================================

export { Queue, Worker, type Job };
export type { JobsOptions, ConnectionOptions };
