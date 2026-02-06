/**
 * Gateway Entry Point
 *
 * Starts the Express server with WebSocket support.
 */

import { getEnvStatus } from "@proliferate/environment";
import { loadGatewayEnv } from "./lib/env";
import { ensureRedisConnected } from "./lib/redis";
import { createServer } from "./server";

async function start(): Promise<void> {
	const status = getEnvStatus();
	if (status.missing.length > 0) {
		console.warn(
			`[Gateway] Missing required environment variables (${status.profile}): ${status.missing
				.map((item) => item.key)
				.join(", ")}`,
		);
	}

	// Load environment
	const env = loadGatewayEnv();
	await ensureRedisConnected();

	// Create and start server
	const { server } = createServer({ env });

	server.listen(env.port, () => {
		console.log(`Gateway listening on :${env.port}`);
	});
}

start().catch((err) => {
	console.error("Failed to start gateway:", err instanceof Error ? err.message : err);
	process.exit(1);
});
