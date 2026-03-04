import type { HubManager } from "../../../../../hub";
import type { GatewayEnv } from "../../../../../lib/env";
import { createToolsRoutes } from "./routes";

export function createToolsRouter(_env: GatewayEnv, hubManager: HubManager) {
	return createToolsRoutes(hubManager);
}
