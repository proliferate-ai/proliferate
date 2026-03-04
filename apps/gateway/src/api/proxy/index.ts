import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../hub";
import type { GatewayEnv } from "../../lib/env";
import { createDevtoolsProxyRoutes } from "./devtools/index";
import { createProxyRoutes } from "./opencode/index";
import { createPreviewHealthRoutes } from "./preview-health/index";

export function createGatewayProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	router.use(createProxyRoutes(hubManager, env));
	router.use(createDevtoolsProxyRoutes(hubManager, env));
	router.use(createPreviewHealthRoutes(hubManager, env));
	return router;
}
