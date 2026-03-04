/**
 * Proliferate HTTP Routes
 *
 * Mounts all proliferate HTTP endpoints under /proliferate
 */

import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";
import { createRequireAuth } from "../../../middleware/auth";
import { createEnsureSessionReady } from "../../../middleware/session";
import { createDaemonHttpRouter } from "./daemon";
import { createActionsRouter } from "./session/actions";
import { createSessionControlRouter } from "./session/control";
import { createSessionMediaRouter } from "./session/media";
import { createSessionRuntimeRouter } from "./session/runtime";
import { createSourceRouter } from "./session/source";
import { createToolsRouter } from "./session/tools";
import { createSessionsRouter } from "./sessions";

export function createProliferateHttpRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireAuth = createRequireAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	// Endpoint class: auth-only
	router.use(requireAuth);

	// Domain: daemon HTTP bridge (auth + runtime-ready)
	router.use(createDaemonHttpRouter(hubManager, env));

	// Domain: sessions (auth-only)
	router.use("/sessions", createSessionsRouter(env, hubManager));

	// Domain: session media (auth-only)
	router.use(createSessionMediaRouter(env));

	// Endpoint class: auth + session-exists (no runtime required)
	router.use("/:proliferateSessionId", createSessionControlRouter(hubManager));
	router.use("/:proliferateSessionId/actions", createActionsRouter(hubManager));
	router.use("/:proliferateSessionId/source", createSourceRouter());
	router.use("/:proliferateSessionId/tools", createToolsRouter(env, hubManager));

	// Endpoint class: auth + runtime-ready
	router.use("/:proliferateSessionId", ensureSessionReady, createSessionRuntimeRouter());

	return router;
}
