import { env } from "@proliferate/environment/server";
import { setServicesLogger } from "@proliferate/services/logger";
import { registerDefaultTriggers } from "@proliferate/triggers";
import { logger } from "./lib/logger.js";
import { startPollingWorker } from "./polling/worker.js";
import { createServer } from "./server.js";

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
const pollingWorker = startPollingWorker();

server.listen(PORT, () => {
	logger.info({ port: PORT }, "Trigger service listening");
});

process.on("SIGINT", async () => {
	await pollingWorker.close();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	await pollingWorker.close();
	process.exit(0);
});
