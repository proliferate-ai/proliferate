/**
 * WebSocket Upgrade Multiplexer
 *
 * Routes WS upgrade requests to the correct handler based on URL path.
 * Handlers are tried in order — first match wins.
 */

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { createLogger } from "@proliferate/logger";

const logger = createLogger({ service: "gateway" }).child({ module: "ws-mux" });

export type UpgradeHandler = (
	req: IncomingMessage,
	socket: Duplex,
	head: Buffer,
) => Promise<boolean>;

export class WsMultiplexer {
	private handlers: UpgradeHandler[] = [];

	addHandler(handler: UpgradeHandler): void {
		this.handlers.push(handler);
	}

	attach(server: Server): void {
		server.on("upgrade", async (req, socket, head) => {
			for (const handler of this.handlers) {
				try {
					const handled = await handler(req, socket, head);
					if (handled) return;
				} catch (err) {
					logger.error({ err, url: req.url }, "Upgrade handler error");
					if (!socket.destroyed) {
						socket.destroy();
					}
					return;
				}
			}
			// No handler matched
			logger.debug({ url: req.url }, "No WS handler matched, destroying socket");
			if (!socket.destroyed) {
				socket.destroy();
			}
		});
	}
}
