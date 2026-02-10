import { createLogger } from "@proliferate/logger";
import { startApiServer } from "./api-server.js";
import { startMcpServer } from "./mcp-server.js";
import { setupTerminalWebSocket } from "./terminal.js";

const logger = createLogger({ service: "sandbox-mcp" });

const mode = process.argv[2];

if (mode === "api") {
	// Port 4000 is hardcoded — the Caddyfile routes /_proliferate/mcp/* to localhost:4000
	const server = startApiServer();
	setupTerminalWebSocket(server);
} else if (mode === "mcp") {
	startMcpServer().catch((err) => {
		logger.fatal({ err }, "Failed to start MCP server");
		process.exit(1);
	});
} else {
	console.error("Usage: sandbox-mcp <api|mcp>");
	console.error("  api - Start the HTTP API server on port 4000");
	console.error("  mcp - Start the MCP server on stdio");
	process.exit(1);
}
