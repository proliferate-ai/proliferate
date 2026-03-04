import type { HubManager } from "../../../../hub";
import type { GatewayEnv } from "../../../../lib/env";
import { createDaemonRoutes } from "./routes";

export function createDaemonHttpRouter(hubManager: HubManager, env: GatewayEnv) {
	return createDaemonRoutes(hubManager, env);
}
