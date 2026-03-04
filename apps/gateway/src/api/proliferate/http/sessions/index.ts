import type { HubManager } from "../../../../hub";
import type { GatewayEnv } from "../../../../lib/env";
import { createSessionsRoutes } from "./routes";

export function createSessionsRouter(env: GatewayEnv, hubManager: HubManager) {
	return createSessionsRoutes(env, hubManager);
}
