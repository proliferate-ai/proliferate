import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import type { HubManager } from "../../../../hub";
import type { GatewayEnv } from "../../../../lib/env";
import { createRequireProxyAuth, deriveSandboxMcpToken } from "../../../../middleware/auth";
import { createEnsureSessionReady } from "../../../../middleware/session";
import { handleDevtoolsMcpProxyError } from "./errors";
import { rewriteDevtoolsMcpPath } from "./rewrite";
import { resolveDevtoolsMcpUpstream } from "./upstream";

const logger = createLogger({ service: "gateway" }).child({ module: "proxy-devtools-mcp" });

export function createDevtoolsMcpProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireProxyAuth = createRequireProxyAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	const proxy = createProxyMiddleware<Request, Response>({
		router: (req: Request) => resolveDevtoolsMcpUpstream(req),
		changeOrigin: true,
		timeout: 15_000,
		proxyTimeout: 15_000,
		pathRewrite: rewriteDevtoolsMcpPath,
		on: {
			proxyReq: (proxyReq, req) => {
				proxyReq.removeHeader("origin");
				proxyReq.removeHeader("referer");
				const sessionId = (req as Request).proliferateSessionId;
				if (sessionId) {
					const token = deriveSandboxMcpToken(env.serviceToken, sessionId);
					proxyReq.setHeader("Authorization", `Bearer ${token}`);
				}
				fixRequestBody(proxyReq, req as Request);
			},
			proxyRes: (proxyRes, req) => {
				if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
					logger.warn(
						{ status: proxyRes.statusCode, path: (req as Request).originalUrl },
						"Devtools proxy upstream error",
					);
				}
			},
			error: handleDevtoolsMcpProxyError,
		},
	});

	router.use(
		"/:proliferateSessionId/:token/devtools/mcp",
		requireProxyAuth,
		ensureSessionReady,
		proxy,
	);
	return router;
}
