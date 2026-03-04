import type { HubManager } from "../../../../../hub";
import type { GatewayEnv } from "../../../../../lib/env";
import { createVscodeWsProxy as createVscodeWsProxyHandler } from "./handler";

export function createVscodeWsProxy(hubManager: HubManager, env: GatewayEnv) {
	return createVscodeWsProxyHandler(hubManager, env);
}
