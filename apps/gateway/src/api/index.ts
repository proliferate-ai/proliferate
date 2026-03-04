/**
 * API Routes
 *
 * Mounts all routes on the Express app.
 */

import type { Server } from "node:http";
import type { Express } from "express";
import type { HubManager } from "../hub";
import type { GatewayEnv } from "../lib/env";
import healthRouter from "./health";
import { createProliferateHttpRoutes } from "./proliferate/http";
import { createProliferateWsHandler } from "./proliferate/ws";
import { createTerminalWsProxy } from "./proliferate/ws/devtools/terminal";
import { createVscodeWsProxy } from "./proliferate/ws/devtools/vscode";
import { createGatewayProxyRoutes } from "./proxy";
import { WsMultiplexer } from "./ws-multiplexer";

export function mountRoutes(app: Express, hubManager: HubManager, env: GatewayEnv): void {
	// Health check
	app.use(healthRouter);

	// Daemon proxy routes MUST be mounted before proliferate HTTP routes.
	// Daemon routes now live under proliferate/http/daemon and are mounted by createProliferateHttpRoutes.
	app.use("/proliferate", createProliferateHttpRoutes(hubManager, env));

	// Proxy domains
	app.use("/proxy", createGatewayProxyRoutes(hubManager, env));
}

export function setupWebSocket(server: Server, hubManager: HubManager, env: GatewayEnv): void {
	const mux = new WsMultiplexer();

	// Session WS domain
	const proliferateWs = createProliferateWsHandler(hubManager, env);
	mux.addHandler(proliferateWs.handleUpgrade);

	// Devtools WS domains
	const terminalWs = createTerminalWsProxy(hubManager, env);
	mux.addHandler(terminalWs.handleUpgrade);

	const vscodeWs = createVscodeWsProxy(hubManager, env);
	mux.addHandler(vscodeWs.handleUpgrade);

	mux.attach(server);
}
