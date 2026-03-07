import type { HubManager } from "../../../../../hub";
import { createManagerRoutes } from "./routes";

export function createSessionManagerRouter(hubManager: HubManager) {
	return createManagerRoutes(hubManager);
}
