/**
 * API Routes
 *
 * Mounts all routes on the Express app.
 */

import type { Server } from "http";
import type { Express } from "express";
import type { HubManager } from "../hub";
import type { GatewayEnv } from "../lib/env";
import healthRouter from "./health";
import { createProliferateHttpRoutes } from "./proliferate/http";
import { setupProliferateWebSocket } from "./proliferate/ws";
import { createDevtoolsProxyRoutes } from "./proxy/devtools";
import { createProxyRoutes } from "./proxy/opencode";

export function mountRoutes(app: Express, hubManager: HubManager, env: GatewayEnv): void {
	// Health check
	app.use(healthRouter);

	// Proliferate routes (HTTP and proxy)
	app.use("/proliferate", createProliferateHttpRoutes(hubManager, env));
	app.use("/proxy", createProxyRoutes(hubManager, env));
	app.use("/proxy", createDevtoolsProxyRoutes(hubManager, env));
}

export function setupWebSocket(server: Server, hubManager: HubManager, env: GatewayEnv): void {
	setupProliferateWebSocket(server, hubManager, env);
}
