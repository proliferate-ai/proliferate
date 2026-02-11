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
import { createLogger } from "@proliferate/logger";
import type { Logger } from "@proliferate/logger";
import {
	SLACK_MESSAGE_JOB_OPTIONS,
	SLACK_RECEIVER_JOB_OPTIONS,
	closeRedisClient,
	getConnectionOptions,
	getRedisClient,
} from "@proliferate/queue";
import { setServicesLogger } from "@proliferate/services/logger";
import { setSharedLogger } from "@proliferate/shared/logger";
import { startAutomationWorkers, stopAutomationWorkers } from "./automation";
import { startBaseSnapshotWorkers, stopBaseSnapshotWorkers } from "./base-snapshots";
import { isBillingWorkerHealthy, startBillingWorker, stopBillingWorker } from "./billing";
import { SessionSubscriber } from "./pubsub";
import { startRepoSnapshotWorkers, stopRepoSnapshotWorkers } from "./repo-snapshots";
import { SlackClient } from "./slack";
import { startActionExpirySweeper, stopActionExpirySweeper } from "./sweepers";

// Create root logger
const logger: Logger = createLogger({ service: "worker" });

// Inject logger into shared packages
setServicesLogger(logger.child({ module: "services" }));
setSharedLogger(logger.child({ module: "shared" }));

// Environment variables
const GATEWAY_URL = env.NEXT_PUBLIC_GATEWAY_URL;
const SERVICE_TO_SERVICE_AUTH_TOKEN = env.SERVICE_TO_SERVICE_AUTH_TOKEN;

logger.info("Starting worker service");
const status = getEnvStatus();
if (status.missing.length > 0) {
	logger.warn(
		{ profile: status.profile, missingKeys: status.missing.map((item) => item.key) },
		"Missing required environment variables",
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
const sessionSubscriber = new SessionSubscriber(
	subscriberRedis,
	logger.child({ module: "session-subscriber" }),
);

// Create and setup async clients
const slackClient = new SlackClient({ syncClient, db }, logger.child({ module: "slack" }));
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
	startBillingWorker(logger.child({ module: "billing" }));
} else {
	logger.info("Billing disabled - skipping billing worker startup");
}

const automationWorkers = startAutomationWorkers(logger.child({ module: "automation" }));

// Modal-only workers: repo snapshots + base snapshots require Modal provider
const isModalConfigured = Boolean(env.MODAL_APP_NAME);
const repoSnapshotWorkers = isModalConfigured
	? startRepoSnapshotWorkers(logger.child({ module: "repo-snapshots" }))
	: null;
const baseSnapshotWorkers = isModalConfigured
	? startBaseSnapshotWorkers(logger.child({ module: "base-snapshots" }))
	: null;
if (!isModalConfigured) {
	logger.info("Modal not configured - skipping snapshot worker startup");
}

// Action invocation expiry sweeper
startActionExpirySweeper(logger.child({ module: "action-expiry" }));

logger.info(
	{
		slackInbound: 5,
		slackReceiver: 10,
		billingEnabled,
		automationWorkers: ["enrich", "execute", "outbox", "finalizer"],
		repoSnapshotWorkers: isModalConfigured ? ["build"] : [],
		baseSnapshotWorkers: isModalConfigured ? ["build"] : [],
	},
	"Workers started",
);

// Start the subscriber
sessionSubscriber.start().catch((err) => {
	logger.error({ err }, "Failed to start session subscriber");
});

logger.info("Session subscriber started");

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
healthServer.listen(PORT, () => logger.info({ port: PORT }, "Health check server listening"));

// Graceful shutdown
async function shutdown(): Promise<void> {
	logger.info("Shutting down");

	// Close health check server
	await new Promise<void>((resolve) => healthServer.close(() => resolve()));

	// Stop billing worker
	stopBillingWorker();

	// Stop action expiry sweeper
	stopActionExpirySweeper();

	// Stop session subscriber
	await sessionSubscriber.stop();
	await subscriberRedis.quit();

	// Close async clients (closes their queues and workers)
	await slackClient.close();
	await stopAutomationWorkers(automationWorkers);
	if (repoSnapshotWorkers) {
		await stopRepoSnapshotWorkers(repoSnapshotWorkers);
	}
	if (baseSnapshotWorkers) {
		await stopBaseSnapshotWorkers(baseSnapshotWorkers);
	}

	// Close Redis client
	await closeRedisClient();

	logger.info("Shutdown complete");
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep process alive
process.stdin.resume();
