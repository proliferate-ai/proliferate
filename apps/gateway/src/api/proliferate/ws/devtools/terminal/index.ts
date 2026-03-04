import type { HubManager } from "../../../../../hub";
import type { GatewayEnv } from "../../../../../lib/env";
import { createTerminalWsProxy as createTerminalWsProxyHandler } from "./handler";

export function createTerminalWsProxy(hubManager: HubManager, env: GatewayEnv) {
	return createTerminalWsProxyHandler(hubManager, env);
}
