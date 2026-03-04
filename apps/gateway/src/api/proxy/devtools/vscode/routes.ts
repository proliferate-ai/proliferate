import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import type { HubManager } from "../../../../hub";
import type { GatewayEnv } from "../../../../lib/env";
import { createRequireProxyAuth, deriveSandboxMcpToken } from "../../../../middleware/auth";
import { ApiError } from "../../../../middleware/errors";
import { createEnsureSessionReady } from "../../../../middleware/session";
import { handleVscodeProxyError } from "./errors";
import { rewriteVscodeProxyPath, rewriteVscodeRedirectLocation } from "./rewrite";
import { resolveVscodeUpstream } from "./upstream";

const logger = createLogger({ service: "gateway" }).child({ module: "proxy-devtools-vscode" });

export function createVscodeProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireProxyAuth = createRequireProxyAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	const proxy = createProxyMiddleware<Request, Response>({
		router: (req: Request) => resolveVscodeUpstream(req),
		changeOrigin: true,
		timeout: 30_000,
		proxyTimeout: 30_000,
		pathRewrite: (path: string) => {
			const rewritten = rewriteVscodeProxyPath(path);
			logger.debug({ originalPath: path, rewritten }, "VS Code proxy path rewrite");
			return rewritten;
		},
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
				const locationHeader = proxyRes.headers.location;
				if (typeof locationHeader === "string") {
					const rewrittenLocation = rewriteVscodeRedirectLocation(locationHeader);
					if (rewrittenLocation !== locationHeader) {
						proxyRes.headers.location = rewrittenLocation;
					}
				}
				if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
					logger.warn(
						{ status: proxyRes.statusCode, path: (req as Request).originalUrl },
						"VS Code proxy upstream error",
					);
				}
			},
			error: handleVscodeProxyError,
		},
	});

	router.use(
		"/:proliferateSessionId/:token/devtools/vscode",
		requireProxyAuth,
		ensureSessionReady,
		proxy,
	);

	return router;
}

export function createVscodeWsProxy(): never {
	throw new ApiError(500, "createVscodeWsProxy moved to proliferate/ws/devtools/vscode");
}
