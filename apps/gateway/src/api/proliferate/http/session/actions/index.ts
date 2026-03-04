import type { HubManager } from "../../../../../hub";
import { createActionsRoutes } from "./routes";

export function createActionsRouter(hubManager: HubManager) {
	return createActionsRoutes(hubManager);
}
