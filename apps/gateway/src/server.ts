/**
 * Server Setup
 *
 * Creates Express app and HTTP server.
 */

import http from "http";
import express, { type Express } from "express";
import { createHttpLogger, type Logger } from "@proliferate/logger";
import { mountRoutes, setupWebSocket } from "./api";
import { startSessionExpiryWorker } from "./expiry/expiry-queue";
import { HubManager } from "./hub";
import type { GatewayEnv } from "./lib/env";
import { cors, errorHandler } from "./middleware";

export interface ServerDependencies {
	env: GatewayEnv;
	logger: Logger;
}

export interface ServerResult {
	app: Express;
	server: http.Server;
	hubManager: HubManager;
}

/**
 * Create and configure the Express app and HTTP server.
 */
export function createServer(deps: ServerDependencies): ServerResult {
	const { env, logger } = deps;

	// Create hub manager (now uses Drizzle via services module)
	const hubManager = new HubManager(env);

	// Create Express app
	const app = express();

	// Middleware
	app.use(cors);
	app.use(createHttpLogger({ logger }));
	app.use(express.json());

	// Mount routes
	mountRoutes(app, hubManager, env);

	// Error handler (must be last)
	app.use(errorHandler);

	// Create HTTP server
	const server = http.createServer(app);

	// Setup WebSocket handling
	setupWebSocket(server, hubManager, env);

	// Start expiry worker (durable delayed jobs via BullMQ)
	startSessionExpiryWorker(env, hubManager);

	return { app, server, hubManager };
}
