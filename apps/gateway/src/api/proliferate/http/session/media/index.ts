import type { GatewayEnv } from "../../../../../lib/env";
import { createSessionMediaRoutes } from "./routes";

export function createSessionMediaRouter(env: GatewayEnv) {
	return createSessionMediaRoutes(env);
}
