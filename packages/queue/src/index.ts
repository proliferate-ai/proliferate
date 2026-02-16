import { env } from "@proliferate/environment/server";
import { type ConnectionOptions, type Job, type JobsOptions, Queue, Worker } from "bullmq";
import IORedis from "ioredis";

// Queue names
export const QUEUE_NAMES = {
	TRIGGER_EVENTS: "trigger-events",
	POLLING: "polling",
	POLL_GROUPS: "poll-groups",
	WEBHOOK_INBOX: "webhook-inbox",
	INBOX_GC: "inbox-gc",
	SCHEDULED: "scheduled",
	AUTOMATION_ENRICH: "automation-enrich",
	AUTOMATION_EXECUTE: "automation-execute",
	AUTOMATION_FINALIZE: "automation-finalize",
	REPO_SNAPSHOT_BUILDS: "repo-snapshot-builds",
	BASE_SNAPSHOT_BUILDS: "base-snapshot-builds",
	BILLING_METERING: "billing-metering",
	BILLING_OUTBOX: "billing-outbox",
	BILLING_GRACE: "billing-grace",
	BILLING_RECONCILE: "billing-reconcile",
	BILLING_LLM_SYNC_DISPATCH: "billing-llm-sync-dispatch",
	BILLING_LLM_SYNC_ORG: "billing-llm-sync-org",
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
 * Job to build a deterministic repo snapshot (clone-only baseline).
 */
export interface RepoSnapshotBuildJob {
	repoId: string;
	force?: boolean;
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
 * Job to poll a trigger poll group (vNext per-group fan-out).
 * Worker fetches group config, polls once, then fans out to all triggers in-memory.
 */
export interface PollGroupJob {
	groupId: string; // FK to trigger_poll_groups.id
}

/**
 * Job to drain webhook inbox rows (vNext async processing).
 */
export interface WebhookInboxJob {
	batchSize?: number;
}

/**
 * Job to garbage-collect old webhook inbox rows.
 */
export interface InboxGcJob {
	retentionDays?: number;
}

/**
 * Result of adding a scheduled job.
 * Contains the repeat job key needed to remove the job later.
 */
export interface AddScheduledJobResult {
	repeatJobKey: string;
}

// ============================================
// Billing Job Types
// ============================================

/** Repeatable metering job — runs every 30s, no data needed. */
export type BillingMeteringJob = Record<string, never>;

/** Repeatable outbox job — runs every 60s, no data needed. */
export type BillingOutboxJob = Record<string, never>;

/** Repeatable grace expiration job — runs every 60s, no data needed. */
export type BillingGraceJob = Record<string, never>;

/** Nightly reconciliation job — cron at 00:00 UTC, no data needed. */
export type BillingReconcileJob = Record<string, never>;

/** Repeatable LLM sync dispatcher — runs every 30s, fans out per-org jobs. */
export type BillingLLMSyncDispatchJob = Record<string, never>;

/** Per-org LLM spend sync job — dispatched by the dispatcher. */
export interface BillingLLMSyncOrgJob {
	orgId: string;
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

	/**
	 * Lock during poll group execution: poll-group:lock:{groupId}
	 * TTL: 120 seconds. Prevents concurrent polls for the same group.
	 */
	pollGroupLock: (groupId: string) => `poll-group:lock:${groupId}`,
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

const pollGroupJobOptions: JobsOptions = {
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

const webhookInboxJobOptions: JobsOptions = {
	attempts: 1, // Inbox rows handle their own retry via status
	removeOnComplete: {
		age: 3600, // 1 hour
		count: 100,
	},
	removeOnFail: {
		age: 86400, // 24 hours
		count: 100,
	},
};

const inboxGcJobOptions: JobsOptions = {
	attempts: 2,
	backoff: {
		type: "fixed",
		delay: 30000,
	},
	removeOnComplete: {
		age: 86400, // 24 hours
		count: 50,
	},
	removeOnFail: {
		age: 86400,
		count: 50,
	},
};

const repoSnapshotBuildJobOptions: JobsOptions = {
	attempts: 3,
	backoff: {
		type: "exponential",
		delay: 5000,
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

/**
 * Create the repo snapshot build queue
 */
export function createRepoSnapshotBuildQueue(
	connection?: ConnectionOptions,
): Queue<RepoSnapshotBuildJob> {
	return new Queue<RepoSnapshotBuildJob>(QUEUE_NAMES.REPO_SNAPSHOT_BUILDS, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: repoSnapshotBuildJobOptions,
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

export function createRepoSnapshotBuildWorker(
	processor: (job: Job<RepoSnapshotBuildJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<RepoSnapshotBuildJob> {
	return new Worker<RepoSnapshotBuildJob>(QUEUE_NAMES.REPO_SNAPSHOT_BUILDS, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 2,
	});
}

/**
 * Create the poll groups queue (vNext per-group fan-out)
 */
export function createPollGroupQueue(connection?: ConnectionOptions): Queue<PollGroupJob> {
	return new Queue<PollGroupJob>(QUEUE_NAMES.POLL_GROUPS, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: pollGroupJobOptions,
	});
}

/**
 * Create a worker for processing poll group jobs
 */
export function createPollGroupWorker(
	processor: (job: Job<PollGroupJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<PollGroupJob> {
	return new Worker<PollGroupJob>(QUEUE_NAMES.POLL_GROUPS, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 3,
	});
}

/**
 * Create the webhook inbox queue
 */
export function createWebhookInboxQueue(connection?: ConnectionOptions): Queue<WebhookInboxJob> {
	return new Queue<WebhookInboxJob>(QUEUE_NAMES.WEBHOOK_INBOX, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: webhookInboxJobOptions,
	});
}

/**
 * Create a worker for draining the webhook inbox
 */
export function createWebhookInboxWorker(
	processor: (job: Job<WebhookInboxJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<WebhookInboxJob> {
	return new Worker<WebhookInboxJob>(QUEUE_NAMES.WEBHOOK_INBOX, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 2,
	});
}

/**
 * Create the inbox garbage collection queue
 */
export function createInboxGcQueue(connection?: ConnectionOptions): Queue<InboxGcJob> {
	return new Queue<InboxGcJob>(QUEUE_NAMES.INBOX_GC, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: inboxGcJobOptions,
	});
}

/**
 * Create a worker for inbox garbage collection
 */
export function createInboxGcWorker(
	processor: (job: Job<InboxGcJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<InboxGcJob> {
	return new Worker<InboxGcJob>(QUEUE_NAMES.INBOX_GC, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 1,
	});
}

/**
 * Schedule a poll group job with a cron pattern.
 */
export async function schedulePollGroupJob(
	queue: Queue<PollGroupJob>,
	groupId: string,
	cronPattern: string,
): Promise<void> {
	await queue.add(
		`poll-group:${groupId}`,
		{ groupId },
		{
			repeat: { pattern: cronPattern },
			jobId: `poll-group:${groupId}`,
		},
	);
}

/**
 * Remove a scheduled poll group job.
 */
export async function removePollGroupJob(
	queue: Queue<PollGroupJob>,
	groupId: string,
	cronPattern: string,
): Promise<void> {
	await queue.removeRepeatable(`poll-group:${groupId}`, {
		pattern: cronPattern,
	});
}

<<<<<<< HEAD
// ============================================
// Billing Job Options
// ============================================

const billingRepeatableJobOptions: JobsOptions = {
	attempts: 3,
	backoff: {
		type: "exponential",
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

const billingLLMSyncOrgJobOptions: JobsOptions = {
	attempts: 2,
	backoff: {
		type: "fixed",
		delay: 5000,
	},
	removeOnComplete: {
		count: 0, // Remove immediately so jobId can be reused across dispatch cycles
	},
	removeOnFail: {
		age: 86400, // 24 hours
		count: 100,
	},
};

// ============================================
// Billing Queue Factories
// ============================================

export function createBillingMeteringQueue(
	connection?: ConnectionOptions,
): Queue<BillingMeteringJob> {
	return new Queue<BillingMeteringJob>(QUEUE_NAMES.BILLING_METERING, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: billingRepeatableJobOptions,
	});
}

export function createBillingOutboxQueue(connection?: ConnectionOptions): Queue<BillingOutboxJob> {
	return new Queue<BillingOutboxJob>(QUEUE_NAMES.BILLING_OUTBOX, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: billingRepeatableJobOptions,
	});
}

export function createBillingGraceQueue(connection?: ConnectionOptions): Queue<BillingGraceJob> {
	return new Queue<BillingGraceJob>(QUEUE_NAMES.BILLING_GRACE, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: billingRepeatableJobOptions,
	});
}

export function createBillingReconcileQueue(
	connection?: ConnectionOptions,
): Queue<BillingReconcileJob> {
	return new Queue<BillingReconcileJob>(QUEUE_NAMES.BILLING_RECONCILE, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: billingRepeatableJobOptions,
	});
}

export function createBillingLLMSyncDispatchQueue(
	connection?: ConnectionOptions,
): Queue<BillingLLMSyncDispatchJob> {
	return new Queue<BillingLLMSyncDispatchJob>(QUEUE_NAMES.BILLING_LLM_SYNC_DISPATCH, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: billingRepeatableJobOptions,
	});
}

export function createBillingLLMSyncOrgQueue(
	connection?: ConnectionOptions,
): Queue<BillingLLMSyncOrgJob> {
	return new Queue<BillingLLMSyncOrgJob>(QUEUE_NAMES.BILLING_LLM_SYNC_ORG, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: billingLLMSyncOrgJobOptions,
	});
}

// ============================================
// Billing Worker Factories
// ============================================

export function createBillingMeteringWorker(
	processor: (job: Job<BillingMeteringJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<BillingMeteringJob> {
	return new Worker<BillingMeteringJob>(QUEUE_NAMES.BILLING_METERING, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 1,
	});
}

export function createBillingOutboxWorker(
	processor: (job: Job<BillingOutboxJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<BillingOutboxJob> {
	return new Worker<BillingOutboxJob>(QUEUE_NAMES.BILLING_OUTBOX, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 1,
	});
}

export function createBillingGraceWorker(
	processor: (job: Job<BillingGraceJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<BillingGraceJob> {
	return new Worker<BillingGraceJob>(QUEUE_NAMES.BILLING_GRACE, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 1,
	});
}

export function createBillingReconcileWorker(
	processor: (job: Job<BillingReconcileJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<BillingReconcileJob> {
	return new Worker<BillingReconcileJob>(QUEUE_NAMES.BILLING_RECONCILE, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 1,
	});
}

export function createBillingLLMSyncDispatchWorker(
	processor: (job: Job<BillingLLMSyncDispatchJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<BillingLLMSyncDispatchJob> {
	return new Worker<BillingLLMSyncDispatchJob>(QUEUE_NAMES.BILLING_LLM_SYNC_DISPATCH, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 1,
	});
}

export function createBillingLLMSyncOrgWorker(
	processor: (job: Job<BillingLLMSyncOrgJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<BillingLLMSyncOrgJob> {
	return new Worker<BillingLLMSyncOrgJob>(QUEUE_NAMES.BILLING_LLM_SYNC_ORG, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 5,
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
