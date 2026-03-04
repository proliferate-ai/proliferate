import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";
import { createPreviewHealthRoutes as createPreviewHealthDomainRoutes } from "./routes";

export function createPreviewHealthRoutes(_hubManager: HubManager, env: GatewayEnv) {
	return createPreviewHealthDomainRoutes(env);
}
