/**
 * AsyncClient
 *
 * Abstract base class for async (BullMQ-based) clients.
 * Used by Slack, Discord, Teams, etc.
 */

import type { Database } from "@proliferate/db";
import type { ClientSource, ServerMessage, WakeOptions } from "@proliferate/shared";
import type { Job } from "bullmq";
import { Queue, Worker } from "bullmq";
import type { Client, ClientTools } from "../../client";
import type { HealthCheckResult } from "../../types";
import type { SyncClient } from "../sync";
import { runReceiver } from "./receiver";
import type { AsyncClientDeps, AsyncClientSetupOptions } from "./types";

/**
 * Minimal interface for clients that can be woken.
 * Used by SessionSubscriber which only needs wake() functionality.
 */
export interface WakeableClient {
	readonly clientType: ClientSource;
	wake(
		proliferateSessionId: string,
		metadata: unknown,
		source: ClientSource,
		options?: WakeOptions,
	): Promise<void>;
}

/**
 * Async client - receiver spawned on demand
 * Used by: Slack, Discord, Teams, etc.
 *
 * Extend this class and implement:
 * - clientType: Your platform identifier
 * - processInbound(): Handle incoming messages from your platform
 * - handleEvent(): Handle gateway events and post to your platform
 */
export abstract class AsyncClient<
	TMetadata = unknown,
	TInboundJob = unknown,
	TReceiverJob = unknown,
> implements Client
{
	readonly type = "async" as const;
	abstract readonly clientType: ClientSource;

	readonly tools: ClientTools;
	readonly syncClient: SyncClient;

	protected receiverQueue!: Queue<TReceiverJob, unknown, string>;
	protected inboundQueue!: Queue<TInboundJob, unknown, string>;
	protected inboundWorker!: Worker<TInboundJob, unknown, string>;
	protected receiverWorker!: Worker<TReceiverJob, unknown, string>;

	constructor(readonly deps: AsyncClientDeps) {
		this.syncClient = deps.syncClient;
		this.tools = this.syncClient.tools;
	}

	/** Drizzle database client */
	get db(): Database {
		return this.deps.db;
	}

	/**
	 * Initialize queues and workers. Call once at startup.
	 */
	setup(options: AsyncClientSetupOptions): void {
		const { connection, inboundConcurrency = 5, receiverConcurrency = 10 } = options;

		// Create queues
		this.inboundQueue = new Queue<TInboundJob>(`${this.clientType}-inbound`, {
			connection,
			defaultJobOptions: options.inboundJobOptions,
		});

		this.receiverQueue = new Queue<TReceiverJob>(`${this.clientType}-receiver`, {
			connection,
			defaultJobOptions: options.receiverJobOptions,
		});

		// Create workers
		this.inboundWorker = new Worker<TInboundJob>(
			`${this.clientType}-inbound`,
			async (job: Job<TInboundJob>) => this.processInbound(job.data),
			{ connection, concurrency: inboundConcurrency },
		);

		this.receiverWorker = new Worker<TReceiverJob>(
			`${this.clientType}-receiver`,
			async (job: Job<TReceiverJob>) => {
				const { sessionId, ...metadata } = job.data as TReceiverJob & { sessionId: string };
				await runReceiver(this as AsyncClient<TMetadata>, sessionId, metadata as TMetadata);
			},
			{ connection, concurrency: receiverConcurrency },
		);

		console.log(`[${this.clientType}] Setup complete - queues and workers initialized`);
	}

	/**
	 * Wake the receiver for a session.
	 * Checks for existing active receiver before creating a new job.
	 * Override in subclass to handle the message content (e.g., post to Slack immediately).
	 */
	async wake(
		proliferateSessionId: string,
		metadata: TMetadata,
		source: ClientSource,
		_options?: WakeOptions,
	): Promise<void> {
		// Don't wake for own messages
		if (source === this.clientType) {
			return;
		}

		// Check for existing active receiver
		const existingJobs = await this.receiverQueue.getJobs(["waiting", "active", "delayed"]);
		const hasActiveReceiver = existingJobs.some(
			(j) => (j.data as TReceiverJob & { sessionId: string }).sessionId === proliferateSessionId,
		);

		if (hasActiveReceiver) {
			console.log(
				`[${this.clientType}] Active receiver exists for session ${proliferateSessionId}`,
			);
			return;
		}

		// Create receiver job
		const jobData = { sessionId: proliferateSessionId, ...metadata } as TReceiverJob;
		const jobId = `${proliferateSessionId}_${Date.now()}`;
		// @ts-expect-error BullMQ's complex generic name types don't play well with our generics
		await this.receiverQueue.add("receiver", jobData, { jobId });
		console.log(`[${this.clientType}] Created receiver job ${jobId}`);
	}

	/**
	 * Health check - delegates to sync client
	 */
	async checkHealth(): Promise<HealthCheckResult> {
		return this.syncClient.checkHealth();
	}

	/**
	 * Gracefully close queues and workers
	 */
	async close(): Promise<void> {
		await Promise.all([
			this.inboundWorker?.close(),
			this.receiverWorker?.close(),
			this.inboundQueue?.close(),
			this.receiverQueue?.close(),
		]);
		console.log(`[${this.clientType}] Closed`);
	}

	/**
	 * Process an inbound message from the platform.
	 * Implement this to handle incoming messages (find/create session, post to gateway).
	 */
	abstract processInbound(job: TInboundJob): Promise<void>;

	/**
	 * Handle an event from the gateway.
	 * @returns "continue" to keep listening, "stop" to close connection
	 */
	abstract handleEvent(
		proliferateSessionId: string,
		metadata: TMetadata,
		event: ServerMessage,
	): Promise<"continue" | "stop">;
}

// Re-export types and receiver
export { runReceiver } from "./receiver";
export type { AsyncClientDeps, AsyncClientSetupOptions, ReceiverOptions } from "./types";
