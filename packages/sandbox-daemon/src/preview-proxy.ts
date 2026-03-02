/**
 * Preview proxy — B5: HTTP/WebSocket reverse proxy to preview app ports.
 *
 * Routes all non-/_proliferate/* requests to the active preview port.
 * Supports HTTP upgrade and bidirectional WebSocket proxying for HMR
 * (Vite/Next.js/Fast Refresh).
 * Preserves Host and forwarding headers.
 */

import { type IncomingMessage, type ServerResponse, request as httpRequest } from "node:http";
import type { Duplex } from "node:stream";
import type { Logger } from "@proliferate/logger";
import type { PortWatcher } from "./ports.js";

export interface PreviewProxyOptions {
	portWatcher: PortWatcher;
	logger: Logger;
}

export class PreviewProxy {
	private readonly portWatcher: PortWatcher;
	private readonly logger: Logger;

	constructor(options: PreviewProxyOptions) {
		this.portWatcher = options.portWatcher;
		this.logger = options.logger.child({ module: "preview-proxy" });
	}

	/**
	 * Proxy an HTTP request to the active preview port.
	 * Returns false if no preview port is available.
	 */
	handleRequest(req: IncomingMessage, res: ServerResponse): boolean {
		const targetPort = this.resolveTargetPort();
		if (targetPort === null) {
			return false;
		}

		const proxyReq = httpRequest(
			{
				hostname: "127.0.0.1",
				port: targetPort,
				path: req.url,
				method: req.method,
				headers: {
					...req.headers,
					"x-forwarded-for": req.socket.remoteAddress ?? "127.0.0.1",
					"x-forwarded-proto": "https",
					"x-forwarded-host": req.headers.host ?? "",
				},
			},
			(proxyRes) => {
				res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
				proxyRes.pipe(res);
			},
		);

		proxyReq.on("error", (err) => {
			this.logger.warn({ port: targetPort, err: err.message }, "Preview proxy request failed");
			if (!res.headersSent) {
				res.writeHead(502, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Preview backend unreachable" }));
			}
		});

		req.pipe(proxyReq);
		return true;
	}

	/**
	 * Proxy a WebSocket upgrade to the active preview port.
	 * Used for HMR connections (Vite, Next.js, etc.).
	 * Returns false if no preview port is available.
	 */
	handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
		const targetPort = this.resolveTargetPort();
		if (targetPort === null) {
			return false;
		}

		const proxyReq = httpRequest({
			hostname: "127.0.0.1",
			port: targetPort,
			path: req.url,
			method: "GET",
			headers: {
				...req.headers,
				"x-forwarded-for": req.socket.remoteAddress ?? "127.0.0.1",
				"x-forwarded-proto": "https",
				"x-forwarded-host": req.headers.host ?? "",
			},
		});

		proxyReq.on("upgrade", (_proxyRes, proxySocket, proxyHead) => {
			socket.write(
				`HTTP/1.1 101 Switching Protocols\r\nUpgrade: ${req.headers.upgrade}\r\nConnection: Upgrade\r\n\r\n`,
			);
			if (proxyHead.length > 0) {
				socket.write(proxyHead);
			}
			proxySocket.write(head);
			proxySocket.pipe(socket);
			socket.pipe(proxySocket);

			const cleanup = () => {
				proxySocket.destroy();
				socket.destroy();
			};
			socket.on("error", cleanup);
			proxySocket.on("error", cleanup);
			socket.on("close", cleanup);
			proxySocket.on("close", cleanup);
		});

		proxyReq.on("error", (err) => {
			this.logger.warn({ port: targetPort, err: err.message }, "Preview WebSocket upgrade failed");
			socket.destroy();
		});

		proxyReq.end();
		return true;
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	/**
	 * Resolve the target preview port. Uses the first (lowest) active port.
	 */
	private resolveTargetPort(): number | null {
		const ports = this.portWatcher.getActivePorts();
		return ports.length > 0 ? ports[0] : null;
	}
}
