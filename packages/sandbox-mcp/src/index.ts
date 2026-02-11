import { startApiServer } from "./api-server.js";
import { setupTerminalWebSocket } from "./terminal.js";

const mode = process.argv[2];

if (mode === "api") {
	// Port 4000 is hardcoded — the Caddyfile routes /_proliferate/mcp/* to localhost:4000
	const server = startApiServer();
	setupTerminalWebSocket(server);
} else {
	console.error("Usage: sandbox-mcp api");
	console.error("  api - Start the HTTP API server on port 4000");
	process.exit(1);
}
