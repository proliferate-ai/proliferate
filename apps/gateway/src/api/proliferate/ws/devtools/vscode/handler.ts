import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { createLogger } from "@proliferate/logger";
import type { HubManager } from "../../../../../hub";
import type { GatewayEnv } from "../../../../../lib/env";
import type { UpgradeHandler } from "../../../../ws-multiplexer";
import { authenticatePathToken } from "./auth";
import { bridgeVscodeWebSocket } from "./bridge";
import { VSCODE_WS_PATH_RE } from "./match";

const logger = createLogger({ service: "gateway" }).child({ module: "vscode-ws-handler" });

export function createVscodeWsProxy(
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
		const match = url.pathname.match(VSCODE_WS_PATH_RE);
		if (!match) return false;

		const [, sessionId, token, tail] = match;
		const authenticated = await authenticatePathToken(token, env);
		if (!authenticated) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return true;
		}

		try {
			await bridgeVscodeWebSocket(req, socket, head, sessionId, tail, url.search, hubManager, env);
		} catch (error) {
			logger.error({ err: error, sessionId }, "VS Code WS proxy setup error");
			if (!socket.destroyed) {
				socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
				socket.destroy();
			}
		}

		return true;
	};

	return { handleUpgrade };
}
