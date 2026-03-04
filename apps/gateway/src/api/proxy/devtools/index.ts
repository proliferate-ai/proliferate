import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";
import { createDevtoolsProxyRoutes as createMcpRoutes } from "./mcp";
import { createVscodeProxyRoutes as createVscodeRoutes } from "./vscode";

export function createDevtoolsProxyRoutes(hubManager: HubManager, env: GatewayEnv) {
	const mcpRouter = createMcpRoutes(hubManager, env);
	const vscodeRouter = createVscodeRoutes(hubManager, env);
	// Compose via root proxy/index.ts mounting order.
	mcpRouter.use(vscodeRouter);
	return mcpRouter;
}
