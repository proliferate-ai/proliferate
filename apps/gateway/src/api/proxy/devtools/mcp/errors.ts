import type { ServerResponse } from "node:http";
import { createLogger } from "@proliferate/logger";

const logger = createLogger({ service: "gateway" }).child({ module: "proxy-devtools-mcp" });

export function handleDevtoolsMcpProxyError(error: Error, res: unknown): void {
	logger.error({ err: error }, "Devtools proxy error");
	if (
		"headersSent" in (res as object) &&
		!(res as ServerResponse).headersSent &&
		"writeHead" in (res as object)
	) {
		(res as ServerResponse).writeHead(502, { "Content-Type": "application/json" });
		(res as ServerResponse).end(JSON.stringify({ error: "Proxy error", message: error.message }));
	}
}
