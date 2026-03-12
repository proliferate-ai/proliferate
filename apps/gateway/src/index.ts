/**
 * Gateway Entry Point
 *
 * Starts the Express server with WebSocket support.
 */

import { nodeEnv } from "@proliferate/environment/runtime";
import { env as serverEnv } from "@proliferate/environment/server";
import * as Sentry from "@sentry/node";

Sentry.init({
	dsn: serverEnv.NEXT_PUBLIC_SENTRY_DSN ?? "",
	environment: nodeEnv,
	tracesSampleRate: nodeEnv === "production" ? 0.1 : 1.0,
	beforeSend(event) {
		if (nodeEnv !== "production") return null;
		return event;
	},
});

import { getEnvStatus } from "@proliferate/environment";
import { createLogger } from "@proliferate/logger";
import { setServicesLogger } from "@proliferate/services/logger";
import { setSharedLogger } from "@proliferate/shared/logger";
import { setLockRedisClient } from "./hub/session/migration/lock";
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
	const redisClient = await ensureRedisConnected();
	setLockRedisClient(redisClient);

	// Create and start server
	const { server, hubManager } = createServer({ env, logger });

	server.listen(env.port, () => {
		logger.info({ port: env.port }, "Gateway listening");
	});

	// Graceful shutdown: flush telemetry, release leases, close server.
	let shutdownPromise: Promise<void> | null = null;
	const shutdown = async () => {
		if (shutdownPromise) return shutdownPromise;
		shutdownPromise = (async () => {
			logger.info("Shutting down — flushing telemetry and releasing leases");
			await Sentry.flush(2000);
			const forceExit = setTimeout(() => {
				logger.warn("Shutdown timeout — forcing exit");
				process.exit(0);
			}, 5000);
			forceExit.unref();

			await hubManager.releaseAllLeases();
			await new Promise<void>((resolve) => server.close(() => resolve()));

			clearTimeout(forceExit);
		})();
		return shutdownPromise;
	};
	process.once("SIGTERM", () => {
		shutdown().catch(() => {
			// Force exit timer handles this
		});
	});
	process.once("SIGINT", () => {
		shutdown().catch(() => {
			// Force exit timer handles this
		});
	});
}

start().catch((err) => {
	logger.fatal({ err }, "Failed to start gateway");
	process.exit(1);
});

process.on("uncaughtException", (err) => {
	logger.fatal({ err }, "Uncaught exception");
	Sentry.captureException(err);
	Sentry.flush(2000).then(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
	logger.fatal({ err: reason }, "Unhandled rejection");
	Sentry.captureException(reason);
});
