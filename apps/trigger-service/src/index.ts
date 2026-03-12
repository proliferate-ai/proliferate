import { nodeEnv, runtimeEnv } from "@proliferate/environment/runtime";
import { env } from "@proliferate/environment/server";
import * as Sentry from "@sentry/node";

Sentry.init({
	dsn: env.NEXT_PUBLIC_SENTRY_DSN ?? "",
	environment: nodeEnv,
	tracesSampleRate: nodeEnv === "production" ? 0.1 : 1.0,
	beforeSend(event) {
		if (nodeEnv !== "production") return null;
		return event;
	},
});
import { setServicesLogger } from "@proliferate/services/logger";
import { registerDefaultTriggers } from "@proliferate/triggers";
import { startInboxGcWorker } from "./gc/inbox-gc.js";
import { startJobTickScheduleSync, startJobTickWorker } from "./job-ticks/scheduler.js";
import { logger } from "./lib/logger.js";
import { scheduleEnabledPollGroups, startPollGroupWorker } from "./polling/worker.js";
import { scheduleEnabledScheduledTriggers, startScheduledWorker } from "./scheduled/worker.js";
import { createServer } from "./server.js";
import { startWebhookInboxWorker } from "./webhook-inbox/worker.js";

setServicesLogger(logger);

const PORT = runtimeEnv.PORT || 3001;

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
const scheduledWorker = startScheduledWorker();
const jobTickWorker = startJobTickWorker();
const jobTickSync = startJobTickScheduleSync();

// Start async workers (returns promises)
const workerCleanups: Array<() => Promise<void>> = [];

async function startAsyncWorkers() {
	const inboxWorker = await startWebhookInboxWorker();
	workerCleanups.push(inboxWorker.close);

	const gcWorker = await startInboxGcWorker();
	workerCleanups.push(gcWorker.close);

	// Schedule all enabled poll groups at startup
	await scheduleEnabledPollGroups();

	// Schedule all enabled cron triggers at startup
	await scheduleEnabledScheduledTriggers();
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
	jobTickSync.stop();
	await jobTickWorker.close();
	await pollGroupWorker.close();
	await scheduledWorker.close();
	for (const cleanup of workerCleanups) {
		await cleanup();
	}
	await Sentry.flush(2000);
	process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

process.on("uncaughtException", (err) => {
	logger.fatal({ err }, "Uncaught exception");
	Sentry.captureException(err);
	Sentry.flush(2000).then(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
	logger.fatal({ err: reason }, "Unhandled rejection");
	Sentry.captureException(reason);
});
