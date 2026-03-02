/**
 * Daemon HTTP server — B1: binds to one exposed port inside the sandbox.
 *
 * Creates the HTTP server, wires up the router for platform transport
 * and preview proxy, handles WebSocket upgrades for HMR.
 */

import { type Server, createServer } from "node:http";
import type { Logger } from "@proliferate/logger";
import type { DaemonConfig } from "./config.js";
import type { PreviewProxy } from "./preview-proxy.js";
import type { Router } from "./router.js";

export interface DaemonServerOptions {
	config: DaemonConfig;
	router: Router;
	previewProxy: PreviewProxy;
	logger: Logger;
}

export function createDaemonServer(options: DaemonServerOptions): Server {
	const { config, router, previewProxy, logger } = options;
	const log = logger.child({ module: "server" });

	const server = createServer((req, res) => {
		router.handleRequest(req, res);
	});

	// Handle WebSocket upgrades for preview proxy (HMR)
	server.on("upgrade", (req, socket, head) => {
		const url = req.url ?? "/";
		if (url.startsWith("/_proliferate/")) {
			// Platform routes do not support upgrade currently
			socket.destroy();
			return;
		}

		if (!previewProxy.handleUpgrade(req, socket, head)) {
			socket.destroy();
		}
	});

	server.listen(config.port, "0.0.0.0", () => {
		log.info({ port: config.port, mode: config.mode }, "Daemon server listening");
	});

	return server;
}
