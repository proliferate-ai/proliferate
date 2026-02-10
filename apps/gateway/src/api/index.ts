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
import { createDevtoolsProxyRoutes } from "./proxy/devtools";
import { createProxyRoutes } from "./proxy/opencode";
import { createTerminalWsProxy } from "./proxy/terminal";
import { createVscodeProxyRoutes, createVscodeWsProxy } from "./proxy/vscode";
import { WsMultiplexer } from "./ws-multiplexer";

export function mountRoutes(app: Express, hubManager: HubManager, env: GatewayEnv): void {
	// Health check
	app.use(healthRouter);

	// Proliferate routes (HTTP and proxy)
	app.use("/proliferate", createProliferateHttpRoutes(hubManager, env));
	app.use("/proxy", createProxyRoutes(hubManager, env));
	app.use("/proxy", createDevtoolsProxyRoutes(hubManager, env));
	app.use("/proxy", createVscodeProxyRoutes(hubManager, env));
}

export function setupWebSocket(server: Server, hubManager: HubManager, env: GatewayEnv): void {
	const mux = new WsMultiplexer();

	// Proliferate main WS (existing — /proliferate/:sessionId)
	const proliferateWs = createProliferateWsHandler(hubManager, env);
	mux.addHandler(proliferateWs.handleUpgrade);

	// Terminal WS proxy (/proxy/:sessionId/:token/devtools/terminal)
	const terminalWs = createTerminalWsProxy(hubManager, env);
	mux.addHandler(terminalWs.handleUpgrade);

	// VS Code WS proxy (/proxy/:sessionId/:token/devtools/vscode/*)
	const vscodeWs = createVscodeWsProxy(hubManager, env);
	mux.addHandler(vscodeWs.handleUpgrade);

	mux.attach(server);
}
