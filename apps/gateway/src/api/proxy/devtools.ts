/**
 * Devtools Proxy Route
 *
 * /proxy/:proliferateSessionId/:token/devtools/mcp[/*]
 *
 * Proxies devtools requests through Gateway to sandbox-mcp API.
 * Auth is handled via token in the URL path (same as opencode proxy).
 * Injects HMAC-derived Bearer token for sandbox-mcp authentication.
 */

import type { ServerResponse } from "node:http";
import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import type { HubManager } from "../../hub";
import type { GatewayEnv } from "../../lib/env";
import { deriveSandboxMcpToken } from "../../lib/sandbox-mcp-token";
import { ApiError, createEnsureSessionReady, createRequireProxyAuth } from "../../middleware";

const logger = createLogger({ service: "gateway" }).child({ module: "devtools-proxy" });

export function createDevtoolsProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireProxyAuth = createRequireProxyAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	const proxy = createProxyMiddleware<Request, Response>({
		router: (req: Request) => {
			const previewUrl = req.hub?.getPreviewUrl();
			if (!previewUrl) {
				logger.warn(
					{ sessionId: (req as Request).proliferateSessionId },
					"No preview URL for devtools proxy",
				);
				throw new ApiError(503, "Sandbox not ready");
			}
			return previewUrl;
		},
		changeOrigin: true,
		timeout: 15_000, // 15s upstream socket timeout
		proxyTimeout: 15_000,
		pathRewrite: (path: string) => {
			// Express already strips the matched route prefix, so path is just the tail
			// (e.g., "/api/git/repos"). Prepend the Caddy internal route.
			return `/_proliferate/mcp${path || "/"}`;
		},
		on: {
			proxyReq: (proxyReq, req) => {
				fixRequestBody(proxyReq, req as Request);
				// Strip browser headers that Modal tunnels may reject
				proxyReq.removeHeader("origin");
				proxyReq.removeHeader("referer");
				// Inject sandbox-mcp auth token
				const sessionId = (req as Request).proliferateSessionId;
				if (sessionId) {
					const token = deriveSandboxMcpToken(env.serviceToken, sessionId);
					proxyReq.setHeader("Authorization", `Bearer ${token}`);
				}
			},
			proxyRes: (proxyRes, req) => {
				if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
					logger.warn(
						{ status: proxyRes.statusCode, path: (req as Request).originalUrl },
						"Devtools proxy upstream error",
					);
				}
			},
			error: (err: Error, _req, res) => {
				logger.error({ err }, "Devtools proxy error");
				if ("headersSent" in res && !res.headersSent && "writeHead" in res) {
					(res as ServerResponse).writeHead(502, { "Content-Type": "application/json" });
					(res as ServerResponse).end(
						JSON.stringify({ error: "Proxy error", message: err.message }),
					);
				}
			},
		},
	});

	// Match both /devtools/mcp and /devtools/mcp/*
	router.use(
		"/:proliferateSessionId/:token/devtools/mcp",
		requireProxyAuth,
		ensureSessionReady,
		proxy,
	);

	return router;
}
