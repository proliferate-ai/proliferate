import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createLogger } from "@proliferate/logger";
import { WebSocket } from "ws";
import type { HubManager } from "../../../../../hub";
import type { GatewayEnv } from "../../../../../lib/env";
import { deriveSandboxMcpToken } from "../../../../../middleware/auth";

const logger = createLogger({ service: "gateway" }).child({ module: "terminal-ws" });

export async function bridgeTerminalWebSocket(
	req: IncomingMessage,
	socket: Duplex,
	head: Buffer,
	sessionId: string,
	hubManager: HubManager,
	env: GatewayEnv,
): Promise<void> {
	const hub = await hubManager.getOrCreate(sessionId);
	hub.touchActivity();
	const removeProxy = hub.addProxyConnection();
	socket.once("close", removeProxy);
	socket.once("error", removeProxy);

	try {
		await hub.ensureRuntimeReady();
	} catch (error) {
		removeProxy();
		throw error;
	}

	const previewUrl = hub.getPreviewUrl();
	if (!previewUrl) {
		removeProxy();
		socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
		socket.destroy();
		return;
	}

	const sandboxToken = deriveSandboxMcpToken(env.serviceToken, sessionId);
	const upstreamUrl = `${previewUrl.replace(/^http/, "ws")}/_proliferate/mcp/api/terminal`;
	logger.info({ sessionId }, "Proxying terminal WS");

	const upstream = new WebSocket(upstreamUrl, {
		headers: { Authorization: `Bearer ${sandboxToken}` },
	});

	let clientWs: WebSocket | null = null;
	const { WebSocketServer } = await import("ws");
	const wss = new WebSocketServer({ noServer: true });

	upstream.on("open", () => {
		wss.handleUpgrade(req, socket, head, (ws) => {
			clientWs = ws;

			upstream.on("message", (data) => {
				if (ws.readyState === WebSocket.OPEN) ws.send(data);
			});
			ws.on("message", (data) => {
				if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
			});
			ws.on("close", () => {
				removeProxy();
				if (upstream.readyState === WebSocket.OPEN) upstream.close();
			});
			upstream.on("close", () => {
				removeProxy();
				if (ws.readyState === WebSocket.OPEN) ws.close();
			});
		});
	});

	upstream.on("error", (error) => {
		logger.error({ err: error, sessionId }, "Terminal upstream WS error");
		removeProxy();
		if (clientWs && clientWs.readyState === WebSocket.OPEN) {
			clientWs.close(1011, "Upstream error");
		} else if (!socket.destroyed) {
			socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
			socket.destroy();
		}
	});
}
