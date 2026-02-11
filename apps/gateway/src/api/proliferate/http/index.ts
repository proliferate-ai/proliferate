/**
 * Proliferate HTTP Routes
 *
 * Mounts all proliferate HTTP endpoints under /proliferate
 */

import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";
import { createEnsureSessionReady, createRequireAuth } from "../../../middleware";
import { createActionsRouter } from "./actions";
import cancelRouter from "./cancel";
import infoRouter from "./info";
import messageRouter from "./message";
import { createSessionsRouter } from "./sessions";
import { createVerificationMediaRouter } from "./verification-media";

export function createProliferateHttpRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireAuth = createRequireAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	// All proliferate routes require auth
	router.use(requireAuth);

	// Session creation - may need hub manager to kick off setup sessions
	router.use("/sessions", createSessionsRouter(env, hubManager));

	// Verification media doesn't need session hub (reads from S3)
	router.use(createVerificationMediaRouter(env));

	// Actions routes — don't require sandbox running (DB + external API only)
	router.use("/:proliferateSessionId/actions", createActionsRouter(env));

	// Routes that need the sandbox running
	// Mount ensureSessionReady on the param path so params are extracted first
	router.use("/:proliferateSessionId", ensureSessionReady, infoRouter);
	router.use("/:proliferateSessionId", ensureSessionReady, messageRouter);
	router.use("/:proliferateSessionId", ensureSessionReady, cancelRouter);

	return router;
}
