/**
 * Terminal WebSocket Proxy
 *
 * /proxy/:proliferateSessionId/:token/devtools/terminal
 *
 * Proxies WebSocket connections from the browser to the sandbox-mcp
 * terminal endpoint. Uses direct WS-to-WS piping via the `ws` library.
 *
 * Auth: path-based token (same as opencode/devtools proxies).
 * Injects HMAC-derived Bearer token for sandbox-mcp authentication.
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { createLogger } from "@proliferate/logger";
import { WebSocket } from "ws";
import type { HubManager } from "../../hub";
import type { GatewayEnv } from "../../lib/env";
import { deriveSandboxMcpToken } from "../../lib/sandbox-mcp-token";
import { verifyToken } from "../../middleware/auth";
import type { UpgradeHandler } from "../ws-multiplexer";

const logger = createLogger({ service: "gateway" }).child({ module: "terminal-proxy" });

// Match /proxy/:sessionId/:token/devtools/terminal
const TERMINAL_PATH_RE = /^\/proxy\/([^/]+)\/([^/]+)\/devtools\/terminal\/?$/;

export function createTerminalWsProxy(
	hubManager: HubManager,
	env: GatewayEnv,
): { handleUpgrade: UpgradeHandler } {
	const handleUpgrade: UpgradeHandler = async (
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): Promise<boolean> => {
		if (!req.url) return false;

		const url = new URL(req.url, `http://${req.headers.host}`);
		const match = url.pathname.match(TERMINAL_PATH_RE);
		if (!match) return false;

		const [, sessionId, token] = match;

		// Auth: verify path token
		try {
			const auth = await verifyToken(token, env);
			if (!auth) {
				socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
				socket.destroy();
				return true;
			}
		} catch {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return true;
		}

		// Get hub and ensure runtime ready
		try {
			const hub = await hubManager.getOrCreate(sessionId);
			await hub.ensureRuntimeReady();
			const previewUrl = hub.getPreviewUrl();
			if (!previewUrl) {
				socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
				socket.destroy();
				return true;
			}

			// Build upstream WS URL
			const sandboxToken = deriveSandboxMcpToken(env.serviceToken, sessionId);
			const upstreamUrl = `${previewUrl.replace(/^http/, "ws")}/_proliferate/mcp/api/terminal`;

			logger.info(
				{ sessionId, upstreamUrl: upstreamUrl.replace(/\/\/.*@/, "//***@") },
				"Proxying terminal WS",
			);

			// Create upstream WS connection with Bearer auth
			const upstream = new WebSocket(upstreamUrl, {
				headers: { Authorization: `Bearer ${sandboxToken}` },
			});

			// Track whether we've completed the initial handshake
			let clientWs: WebSocket | null = null;

			// Create a temporary WSS to handle the client upgrade
			const { WebSocketServer } = await import("ws");
			const wss = new WebSocketServer({ noServer: true });

			upstream.on("open", () => {
				// Upstream connected — now complete the client handshake
				wss.handleUpgrade(req, socket, head, (ws) => {
					clientWs = ws;

					// Pipe: upstream → client
					upstream.on("message", (data) => {
						if (ws.readyState === WebSocket.OPEN) {
							ws.send(data);
						}
					});

					// Pipe: client → upstream
					ws.on("message", (data) => {
						if (upstream.readyState === WebSocket.OPEN) {
							upstream.send(data);
						}
					});

					// Close propagation
					ws.on("close", () => {
						if (upstream.readyState === WebSocket.OPEN) {
							upstream.close();
						}
					});

					upstream.on("close", () => {
						if (ws.readyState === WebSocket.OPEN) {
							ws.close();
						}
					});
				});
			});

			upstream.on("error", (err) => {
				logger.error({ err, sessionId }, "Terminal upstream WS error");
				if (clientWs && clientWs.readyState === WebSocket.OPEN) {
					clientWs.close(1011, "Upstream error");
				} else if (!socket.destroyed) {
					socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
					socket.destroy();
				}
			});
		} catch (err) {
			logger.error({ err, sessionId }, "Terminal proxy setup error");
			if (!socket.destroyed) {
				socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
				socket.destroy();
			}
		}

		return true;
	};

	return { handleUpgrade };
}
