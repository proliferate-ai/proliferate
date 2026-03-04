import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";
import { createRequireProxyAuth } from "../../../middleware/auth";
import { createEnsureSessionReady } from "../../../middleware/session";
import { handleOpencodeProxyError } from "./errors";
import { rewriteOpencodePath } from "./rewrite";
import { resolveOpenCodeUpstream } from "./upstream";

export function createOpencodeProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireProxyAuth = createRequireProxyAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	const proxy = createProxyMiddleware<Request, Response>({
		router: (req: Request) => resolveOpenCodeUpstream(req),
		changeOrigin: true,
		pathRewrite: rewriteOpencodePath,
		on: {
			proxyReq: fixRequestBody,
			error: handleOpencodeProxyError,
		},
	});

	router.use("/:proliferateSessionId/:token/opencode", requireProxyAuth, ensureSessionReady, proxy);
	return router;
}
