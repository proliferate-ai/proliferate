/**
 * OpenCode Proxy Route
 *
 * /proxy/:proliferateSessionId/:token/opencode[/*]
 *
 * Pure passthrough proxy for CLI's opencode --attach.
 * Uses http-proxy-middleware for robust SSE/streaming support.
 * Auth is handled via token in the URL path.
 */

import type { ServerResponse } from "http";
import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import type { HubManager } from "../../hub";
import type { GatewayEnv } from "../../lib/env";
import { ApiError, createEnsureSessionReady, createRequireProxyAuth } from "../../middleware";

const logger = createLogger({ service: "gateway" }).child({ module: "proxy" });

export function createProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireProxyAuth = createRequireProxyAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	// Create proxy middleware with dynamic target
	const proxy = createProxyMiddleware<Request, Response>({
		// Target is set dynamically in the router function
		router: (req: Request) => {
			const openCodeUrl = req.hub?.getOpenCodeUrl();
			if (!openCodeUrl) {
				throw new ApiError(503, "Sandbox not ready");
			}
			return openCodeUrl;
		},
		changeOrigin: true,
		// Rewrite the path to strip the /proxy/:sessionId/:token/opencode prefix
		pathRewrite: (path: string) => {
			const opencodeIndex = path.indexOf("/opencode");
			if (opencodeIndex >= 0) {
				return path.slice(opencodeIndex + 9) || "/";
			}
			return path;
		},
		// Required for Express 5.x body parser compatibility
		on: {
			proxyReq: fixRequestBody,
			error: (err: Error, _req, res) => {
				logger.error({ err }, "Proxy error");
				if ("headersSent" in res && !res.headersSent && "writeHead" in res) {
					(res as ServerResponse).writeHead(502, { "Content-Type": "application/json" });
					(res as ServerResponse).end(
						JSON.stringify({ error: "Proxy error", message: err.message }),
					);
				}
			},
		},
	});

	// Match both /opencode and /opencode/*
	router.use("/:proliferateSessionId/:token/opencode", requireProxyAuth, ensureSessionReady, proxy);

	return router;
}
