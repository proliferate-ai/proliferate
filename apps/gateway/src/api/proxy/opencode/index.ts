import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";
import { createOpencodeProxyRoutes } from "./routes";

export function createProxyRoutes(hubManager: HubManager, env: GatewayEnv) {
	return createOpencodeProxyRoutes(hubManager, env);
}
