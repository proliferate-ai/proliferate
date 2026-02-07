/**
 * Gateway Entry Point
 *
 * Starts the Express server with WebSocket support.
 */

import { getEnvStatus } from "@proliferate/environment";
import { createLogger } from "@proliferate/logger";
import { setServicesLogger } from "@proliferate/services/logger";
import { setSharedLogger } from "@proliferate/shared/logger";
import { loadGatewayEnv } from "./lib/env";
import { ensureRedisConnected } from "./lib/redis";
import { createServer } from "./server";

const logger = createLogger({ service: "gateway" });
setServicesLogger(logger.child({ layer: "services" }));
setSharedLogger(logger.child({ layer: "shared" }));

async function start(): Promise<void> {
	const status = getEnvStatus();
	if (status.missing.length > 0) {
		logger.warn(
			{ profile: status.profile, missing: status.missing.map((item) => item.key) },
			"Missing required environment variables",
		);
	}

	// Load environment
	const env = loadGatewayEnv();
	await ensureRedisConnected();

	// Create and start server
	const { server } = createServer({ env, logger });

	server.listen(env.port, () => {
		logger.info({ port: env.port }, "Gateway listening");
	});
}

start().catch((err) => {
	logger.fatal({ err }, "Failed to start gateway");
	process.exit(1);
});
