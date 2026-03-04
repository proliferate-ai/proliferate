/**
 * Proliferate WebSocket Handler
 *
 * WS /proliferate/:proliferateSessionId
 *
 * Real-time bidirectional communication with sessions.
 */

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { createLogger } from "@proliferate/logger";
import { type WebSocket, WebSocketServer } from "ws";
import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";
import { verifyToken } from "../../../middleware/auth";
import type { AuthResult } from "../../../types";
import type { UpgradeHandler } from "../../ws-multiplexer";

const logger = createLogger({ service: "gateway" }).child({ module: "ws" });

interface WsConnectionContext {
	proliferateSessionId: string;
	auth: AuthResult;
}

/**
 * Create a WS upgrade handler for proliferate sessions.
 * Returns a handler compatible with the WsMultiplexer.
 */
export function createProliferateWsHandler(
	hubManager: HubManager,
	env: GatewayEnv,
): { handleUpgrade: UpgradeHandler; wss: WebSocketServer } {
	const wss = new WebSocketServer({ noServer: true });

	const handleUpgrade: UpgradeHandler = async (
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): Promise<boolean> => {
		if (!req.url) return false;

		const url = new URL(req.url, `http://${req.headers.host}`);

		// Match /proliferate/:proliferateSessionId
		const match = matchProliferatePath(url.pathname);
		if (!match) return false;

		// Authenticate
		const auth = await authenticateUpgrade(req, url, env);
		if (!auth) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return true; // Handled (with auth error)
		}

		// Handle upgrade
		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit("connection", ws, req, {
				proliferateSessionId: match.sessionId,
				auth,
			} as WsConnectionContext);
		});

		return true;
	};

	wss.on(
		"connection",
		async (ws: WebSocket, _req: IncomingMessage, context: WsConnectionContext) => {
			const { proliferateSessionId, auth } = context;

			try {
				logger.info({ sessionId: proliferateSessionId, userId: auth.userId }, "Client connected");
				const hub = await hubManager.getOrCreate(proliferateSessionId);

				// Attach message handler before addClient so messages during
				// runtime startup (e.g. pings) are not silently dropped.
				ws.on("message", (data) => {
					try {
						const parsed = JSON.parse(data.toString());
						hub.handleClientMessage(ws, parsed);
					} catch (err) {
						logger.warn({ err }, "Invalid client message");
					}
				});
				ws.on("close", (code, reason) => {
					logger.info(
						{ sessionId: proliferateSessionId, code, reason: reason?.toString() },
						"Client disconnected",
					);
				});

				// addClient → initializeClient sends status("resuming")
				// immediately, then awaits ensureRuntimeReady internally
				// before sending init + status("running").
				hub.addClient(ws, auth.userId);
			} catch (err) {
				logger.error({ err }, "Failed to setup connection");
				ws.close(1011, "Failed to setup connection");
			}
		},
	);

	return { handleUpgrade, wss };
}

/**
 * Legacy wrapper — setup WebSocket handling directly on a server.
 * Used for backward compatibility. Prefer createProliferateWsHandler + WsMultiplexer.
 */
export function setupProliferateWebSocket(server: Server, hubManager: HubManager, env: GatewayEnv) {
	const { handleUpgrade, wss } = createProliferateWsHandler(hubManager, env);

	server.on("upgrade", async (req, socket, head) => {
		try {
			const handled = await handleUpgrade(req, socket, head);
			if (!handled) {
				socket.destroy();
			}
		} catch (err) {
			logger.error({ err }, "Upgrade error");
			socket.destroy();
		}
	});

	return wss;
}

/**
 * Match /proliferate/:sessionId path
 */
function matchProliferatePath(pathname: string): { sessionId: string } | null {
	const match = pathname.match(/^\/proliferate\/([^/]+)\/?$/);
	if (!match) return null;
	return { sessionId: match[1] };
}

/**
 * Authenticate a WebSocket upgrade request.
 */
async function authenticateUpgrade(
	req: IncomingMessage,
	url: URL,
	env: GatewayEnv,
): Promise<AuthResult | null> {
	// Token can be in query param or Authorization header
	const queryToken = url.searchParams.get("token");
	const authHeader = req.headers.authorization;
	const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

	const token = queryToken || bearerToken;
	if (!token) {
		return null;
	}

	return verifyToken(token, env);
}
