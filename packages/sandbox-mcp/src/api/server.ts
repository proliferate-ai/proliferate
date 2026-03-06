import { createLogger } from "@proliferate/logger";
import { createApiApp } from "./create-api-app.js";

const logger = createLogger({ service: "sandbox-mcp" }).child({ module: "api-server" });

export function startApiServer(port = 4000): import("http").Server {
	const app = createApiApp();
	const server = app.listen(port, "0.0.0.0", () => {
		logger.info({ port }, "API server listening");
	});
	return server;
}
