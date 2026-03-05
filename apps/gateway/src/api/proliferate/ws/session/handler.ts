import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { createLogger } from "@proliferate/logger";
import { type WebSocket, WebSocketServer } from "ws";
import type { HubManager } from "../../../../hub";
import type { GatewayEnv } from "../../../../lib/env";
import type { UpgradeHandler } from "../../../ws-multiplexer";
import { authenticateSessionUpgrade } from "./auth";
import { matchSessionWsPath } from "./match";
import type { SessionWsConnectionContext } from "./types";

const logger = createLogger({ service: "gateway" }).child({ module: "ws-session" });

export function createSessionWsHandler(
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
		const match = matchSessionWsPath(url.pathname);
		if (!match) return false;

		const auth = await authenticateSessionUpgrade(req, url, env);
		if (!auth) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return true;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit("connection", ws, req, {
				proliferateSessionId: match.sessionId,
				auth,
			} as SessionWsConnectionContext);
		});

		return true;
	};

	wss.on(
		"connection",
		async (ws: WebSocket, _req: IncomingMessage, context: SessionWsConnectionContext) => {
			const { proliferateSessionId, auth } = context;

			try {
				logger.info({ sessionId: proliferateSessionId, userId: auth.userId }, "Client connected");
				const hub = await hubManager.getOrCreate(proliferateSessionId);

				ws.on("message", (data) => {
					try {
						const parsed = JSON.parse(data.toString());
						hub.handleClientMessage(ws, parsed);
					} catch (error) {
						logger.warn({ err: error }, "Invalid client message");
					}
				});
				ws.on("close", (code, reason) => {
					logger.info(
						{ sessionId: proliferateSessionId, code, reason: reason?.toString() },
						"Client disconnected",
					);
				});

				hub.addClient(ws, auth.userId);
			} catch (error) {
				logger.error({ err: error }, "Failed to setup connection");
				ws.close(1011, "Failed to setup connection");
			}
		},
	);

	return { handleUpgrade, wss };
}
