import type { HubManager } from "../../../../hub";
import type { GatewayEnv } from "../../../../lib/env";
import { createVscodeProxyRoutes as createVscodeHttpRoutes } from "./routes";

export function createVscodeProxyRoutes(hubManager: HubManager, env: GatewayEnv) {
	return createVscodeHttpRoutes(hubManager, env);
}
