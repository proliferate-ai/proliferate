import { env } from "@proliferate/environment/server";
import { startApiServer } from "./api-server.js";
import { startMcpServer } from "./mcp-server.js";

const mode = process.argv[2];

if (mode === "api") {
	startApiServer(env.API_PORT);
} else if (mode === "mcp") {
	startMcpServer().catch((error) => {
		console.error("Failed to start MCP server:", error);
		process.exit(1);
	});
} else {
	console.error("Usage: sandbox-mcp <api|mcp>");
	console.error("  api - Start the HTTP API server on port 4000");
	console.error("  mcp - Start the MCP server on stdio");
	process.exit(1);
}
