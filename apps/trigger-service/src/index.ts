import { env } from "@proliferate/environment/server";
import { setServicesLogger } from "@proliferate/services/logger";
import { registerDefaultTriggers } from "@proliferate/triggers";
import { startInboxGcWorker } from "./gc/inbox-gc.js";
import { logger } from "./lib/logger.js";
import { scheduleEnabledPollGroups, startPollGroupWorker } from "./polling/worker.js";
import { createServer } from "./server.js";
import { startWebhookInboxWorker } from "./webhook-inbox/worker.js";

setServicesLogger(logger);

const PORT = process.env.PORT || 3001;

registerDefaultTriggers({
	nangoSecret: env.NANGO_SECRET_KEY,
	nangoGitHubIntegrationId: env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID,
	nangoLinearIntegrationId: env.NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID,
	nangoSentryIntegrationId: env.NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID,
	composioApiKey: env.COMPOSIO_API_KEY,
	composioBaseUrl: env.COMPOSIO_BASE_URL,
});

const server = createServer();

// Start workers
const pollGroupWorker = startPollGroupWorker();

// Start async workers (returns promises)
const workerCleanups: Array<() => Promise<void>> = [];

async function startAsyncWorkers() {
	const inboxWorker = await startWebhookInboxWorker();
	workerCleanups.push(inboxWorker.close);

	const gcWorker = await startInboxGcWorker();
	workerCleanups.push(gcWorker.close);

	// Schedule all enabled poll groups at startup
	await scheduleEnabledPollGroups();
}

startAsyncWorkers()
	.then(() => {
		server.listen(PORT, () => {
			logger.info({ port: PORT }, "Trigger service listening");
		});
	})
	.catch((err) => {
		logger.error({ err }, "Failed to start async workers — exiting");
		process.exit(1);
	});

async function gracefulShutdown() {
	await pollGroupWorker.close();
	for (const cleanup of workerCleanups) {
		await cleanup();
	}
	process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
