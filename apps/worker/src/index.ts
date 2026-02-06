/**
 * Worker Service Entry Point
 *
 * Starts async client workers:
 * - Slack inbound/receiver processing
 * - Session subscriber for cross-platform messaging
 *
 * NOTE: Automation workers (trigger, polling, scheduled) are archived
 * in _archived/ folder - functionality is incomplete.
 */

import { createServer } from "node:http";
import type { Server } from "node:http";
import { getDb } from "@proliferate/db";
import { getEnvStatus } from "@proliferate/environment";
import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import {
	SLACK_MESSAGE_JOB_OPTIONS,
	SLACK_RECEIVER_JOB_OPTIONS,
	closeRedisClient,
	getConnectionOptions,
	getRedisClient,
} from "@proliferate/queue";
import { startAutomationWorkers, stopAutomationWorkers } from "./automation";
import { isBillingWorkerHealthy, startBillingWorker, stopBillingWorker } from "./billing";
import { SessionSubscriber } from "./pubsub";
import { SlackClient } from "./slack";

// Environment variables
const GATEWAY_URL = env.NEXT_PUBLIC_GATEWAY_URL;
const SERVICE_TO_SERVICE_AUTH_TOKEN = env.SERVICE_TO_SERVICE_AUTH_TOKEN;

console.log("[Worker] Starting worker service...");
const status = getEnvStatus();
if (status.missing.length > 0) {
	console.warn(
		`[Worker] Missing required environment variables (${status.profile}): ${status.missing
			.map((item) => item.key)
			.join(", ")}`,
	);
}

// Create shared dependencies
const db = getDb();
const syncClient = createSyncClient({
	baseUrl: GATEWAY_URL,
	auth: { type: "service", name: "worker", secret: SERVICE_TO_SERVICE_AUTH_TOKEN },
	source: "slack",
});

// Create session subscriber for async clients
// Uses a separate Redis connection for pubsub (ioredis requirement)
const subscriberRedis = getRedisClient().duplicate();
const sessionSubscriber = new SessionSubscriber(subscriberRedis);

// Create and setup async clients
const slackClient = new SlackClient({ syncClient, db });
slackClient.setup({
	connection: getConnectionOptions(),
	inboundConcurrency: 5,
	receiverConcurrency: 10,
	inboundJobOptions: SLACK_MESSAGE_JOB_OPTIONS,
	receiverJobOptions: {
		...SLACK_RECEIVER_JOB_OPTIONS,
		removeOnComplete: { count: 0 }, // Remove immediately so sessionId can be reused as jobId
	},
});
sessionSubscriber.registerClient(slackClient);

// Start billing worker (interval-based, not queue-based)
const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
if (billingEnabled) {
	startBillingWorker();
} else {
	console.log("[Worker] Billing disabled - skipping billing worker startup");
}

const automationWorkers = startAutomationWorkers();

console.log("[Worker] Workers started:");
console.log("  - Slack Client (inbound: 5, receiver: 10)");
if (billingEnabled) {
	console.log("  - Billing Worker (interval-based)");
}
console.log("  - Automation Workers (enrich, execute, outbox, finalizer)");

// Start the subscriber
sessionSubscriber.start().catch((err) => {
	console.error("[Worker] Failed to start session subscriber:", err);
});

console.log("[Worker] Session subscriber started");

// Health check HTTP server for container orchestration
const PORT = env.WORKER_PORT;
const healthServer: Server = createServer((req, res) => {
	if (req.url === "/health") {
		const healthy = isBillingWorkerHealthy();
		res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				status: healthy ? "healthy" : "unhealthy",
				workers: {
					slack: true,
					sessionSubscriber: true,
					billing: isBillingWorkerHealthy(),
				},
			}),
		);
	} else {
		res.writeHead(404);
		res.end();
	}
});
healthServer.listen(PORT, () =>
	console.log(`[Worker] Health check server listening on port ${PORT}`),
);

// Graceful shutdown
async function shutdown(): Promise<void> {
	console.log("[Worker] Shutting down...");

	// Close health check server
	await new Promise<void>((resolve) => healthServer.close(() => resolve()));

	// Stop billing worker
	stopBillingWorker();

	// Stop session subscriber
	await sessionSubscriber.stop();
	await subscriberRedis.quit();

	// Close async clients (closes their queues and workers)
	await slackClient.close();
	await stopAutomationWorkers(automationWorkers);

	// Close Redis client
	await closeRedisClient();

	console.log("[Worker] Shutdown complete");
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep process alive
process.stdin.resume();
