import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../../../../hub";
import { createEagerStartRouter } from "./eager-start";
import { createHeartbeatRouter } from "./heartbeat";

export function createSessionControlRouter(hubManager: HubManager): RouterType {
	const router: RouterType = Router({ mergeParams: true });
	router.use(createHeartbeatRouter(hubManager));
	router.use(createEagerStartRouter(hubManager));
	return router;
}
