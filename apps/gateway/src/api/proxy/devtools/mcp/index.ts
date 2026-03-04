import type { HubManager } from "../../../../hub";
import type { GatewayEnv } from "../../../../lib/env";
import { createDevtoolsMcpProxyRoutes } from "./routes";

export function createDevtoolsProxyRoutes(hubManager: HubManager, env: GatewayEnv) {
	return createDevtoolsMcpProxyRoutes(hubManager, env);
}
