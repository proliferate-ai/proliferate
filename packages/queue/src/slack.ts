/**
 * Slack Integration Queue Definitions
 *
 * Two job types:
 * - SlackMessageJob: Per-message, idempotent - handles incoming Slack messages
 * - SlackReceiverJob: Per-session - listens for Gateway events and posts to Slack
 */

import type { ConnectionOptions, Job, JobsOptions } from "bullmq";
import { Queue, Worker } from "bullmq";
import { createLogger } from "@proliferate/logger";
import { getConnectionOptions } from "./index";

const logger = createLogger({ service: "queue" }).child({ module: "slack" });

// ============================================
// Queue Names
// ============================================

export const SLACK_QUEUE_NAMES = {
	INBOUND: "slack-inbound",
	RECEIVER: "slack-receiver",
} as const;

// ============================================
// Job Types
// ============================================

/**
 * Job to process an incoming Slack message.
 * - Finds or creates a session
 * - Ensures a receiver job exists
 * - Posts prompt to Gateway
 */
export interface SlackMessageJob {
	/** Slack installation ID (FK to slack_installations.id) */
	installationId: string;
	/** Slack channel ID */
	channelId: string;
	/** Thread timestamp (conversation identifier) */
	threadTs: string;
	/** Message content (prompt) */
	content: string;
	/** Encrypted bot token for posting responses */
	encryptedBotToken: string;
	/** Repo ID if already selected (from interaction handler) */
	repoId?: string;
	/** Original Slack message timestamp for deduplication */
	messageTs: string;
	/** Slack user ID who sent the message */
	slackUserId: string;
	/** Organization ID for the installation */
	organizationId: string;
	/** Image URLs attached to the message (Slack private URLs) */
	imageUrls?: string[];
}

/**
 * Job to receive events from Gateway and post to Slack.
 * - Connects WebSocket to Gateway
 * - Listens for events (message_complete, tool_end, error)
 * - Posts responses to Slack thread
 * - Exits on message_complete or error
 */
export interface SlackReceiverJob {
	/** Session ID to connect to */
	sessionId: string;
	/** Slack installation ID */
	installationId: string;
	/** Slack channel ID */
	channelId: string;
	/** Thread timestamp */
	threadTs: string;
	/** Encrypted bot token for posting responses */
	encryptedBotToken: string;
}

// ============================================
// Job Options
// ============================================

export const SLACK_MESSAGE_JOB_OPTIONS: JobsOptions = {
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

export const SLACK_RECEIVER_JOB_OPTIONS: JobsOptions = {
	attempts: 3,
	backoff: {
		type: "exponential",
		delay: 2000,
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

// ============================================
// Queue Factories
// ============================================

/**
 * Create the Slack messages queue
 */
export function createSlackMessagesQueue(connection?: ConnectionOptions): Queue<SlackMessageJob> {
	return new Queue<SlackMessageJob>(SLACK_QUEUE_NAMES.INBOUND, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: SLACK_MESSAGE_JOB_OPTIONS,
	});
}

/**
 * Create the Slack receivers queue
 */
export function createSlackReceiversQueue(connection?: ConnectionOptions): Queue<SlackReceiverJob> {
	return new Queue<SlackReceiverJob>(SLACK_QUEUE_NAMES.RECEIVER, {
		connection: connection ?? getConnectionOptions(),
		defaultJobOptions: SLACK_RECEIVER_JOB_OPTIONS,
	});
}

// ============================================
// Worker Factories
// ============================================

/**
 * Create a worker for processing Slack messages
 */
export function createSlackMessageWorker(
	processor: (job: Job<SlackMessageJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<SlackMessageJob> {
	return new Worker<SlackMessageJob>(SLACK_QUEUE_NAMES.INBOUND, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 5,
	});
}

/**
 * Create a worker for Slack receivers
 * Lower concurrency since these hold WebSocket connections
 */
export function createSlackReceiverWorker(
	processor: (job: Job<SlackReceiverJob>) => Promise<void>,
	connection?: ConnectionOptions,
): Worker<SlackReceiverJob> {
	return new Worker<SlackReceiverJob>(SLACK_QUEUE_NAMES.RECEIVER, processor, {
		connection: connection ?? getConnectionOptions(),
		concurrency: 10, // Each receiver holds a WebSocket connection
	});
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Queue a Slack message for processing.
 * Uses messageTs as job ID for deduplication.
 */
export async function queueSlackMessage(
	queue: Queue<SlackMessageJob>,
	job: SlackMessageJob,
): Promise<void> {
	const jobId = `slack_${job.installationId}_${job.channelId}_${job.messageTs}`;
	await queue.add(`message_${job.messageTs}`, job, { jobId });
}

/**
 * Ensure a receiver job exists for a session.
 * Checks if there's an active (waiting/active) receiver - if not, creates one.
 */
export async function ensureSlackReceiver(
	queue: Queue<SlackReceiverJob>,
	job: SlackReceiverJob,
): Promise<void> {
	// Use deterministic jobId to avoid duplicate receivers for the same session.
	// BullMQ enforces uniqueness on jobId, so this is race-safe across workers.
	const jobId = `receiver_${job.sessionId}`;
	const existing = await queue.getJob(jobId);
	if (existing) {
		const state = await existing.getState();
		if (state === "active" || state === "waiting" || state === "delayed") {
			logger.info({ state, sessionId: job.sessionId }, "Receiver job already exists for session");
			return;
		}

		// Job completed/failed - remove so we can re-add
		await existing.remove();
		logger.info({ state, sessionId: job.sessionId }, "Removed stale receiver job for session");
	}

	try {
		await queue.add(`receiver_${job.sessionId}`, job, { jobId });
		logger.info({ jobId }, "Ensured receiver job");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("exists")) {
			logger.info({ sessionId: job.sessionId }, "Receiver job already exists for session");
			return;
		}
		throw err;
	}
}
