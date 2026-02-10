/**
 * VS Code Proxy Routes
 *
 * HTTP: /proxy/:proliferateSessionId/:token/devtools/vscode[/*]
 * WS:   /proxy/:proliferateSessionId/:token/devtools/vscode[/*]
 *
 * Proxies HTTP and WebSocket connections from the browser to the
 * openvscode-server instance running in the sandbox.
 *
 * HTTP requests go through Caddy's /_proliferate/vscode/* route which
 * uses forward_auth to validate the Bearer token.
 *
 * WS connections are handled via direct WS-to-WS piping (same as terminal).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { WebSocket } from "ws";
import type { HubManager } from "../../hub";
import type { GatewayEnv } from "../../lib/env";
import { deriveSandboxMcpToken } from "../../lib/sandbox-mcp-token";
import { ApiError, createEnsureSessionReady, createRequireProxyAuth } from "../../middleware";
import { verifyToken } from "../../middleware/auth";
import type { UpgradeHandler } from "../ws-multiplexer";

const logger = createLogger({ service: "gateway" }).child({ module: "vscode-proxy" });

// ──────────────────────────────────────────────
// HTTP proxy
// ──────────────────────────────────────────────

export function createVscodeProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireProxyAuth = createRequireProxyAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	const proxy = createProxyMiddleware<Request, Response>({
		router: (req: Request) => {
			const previewUrl = req.hub?.getPreviewUrl();
			if (!previewUrl) {
				logger.warn(
					{ sessionId: (req as Request).proliferateSessionId },
					"No preview URL for vscode proxy",
				);
				throw new ApiError(503, "Sandbox not ready");
			}
			return previewUrl;
		},
		changeOrigin: true,
		timeout: 30_000,
		proxyTimeout: 30_000,
		pathRewrite: (path: string) => {
			return `/_proliferate/vscode${path || "/"}`;
		},
		on: {
			proxyReq: (proxyReq, req) => {
				fixRequestBody(proxyReq, req as Request);
				proxyReq.removeHeader("origin");
				proxyReq.removeHeader("referer");
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
						"VS Code proxy upstream error",
					);
				}
			},
			error: (err: Error, _req, res) => {
				logger.error({ err }, "VS Code proxy error");
				if ("headersSent" in res && !res.headersSent && "writeHead" in res) {
					(res as ServerResponse).writeHead(502, { "Content-Type": "application/json" });
					(res as ServerResponse).end(
						JSON.stringify({ error: "Proxy error", message: err.message }),
					);
				}
			},
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

// ──────────────────────────────────────────────
// WebSocket proxy (for VS Code's WS connections)
// ──────────────────────────────────────────────

// Match /proxy/:sessionId/:token/devtools/vscode and any sub-path
const VSCODE_WS_PATH_RE = /^\/proxy\/([^/]+)\/([^/]+)\/devtools\/vscode(\/.*)?$/;

export function createVscodeWsProxy(
	hubManager: HubManager,
	env: GatewayEnv,
): { handleUpgrade: UpgradeHandler } {
	const handleUpgrade: UpgradeHandler = async (
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): Promise<boolean> => {
		if (!req.url) return false;

		const url = new URL(req.url, `http://${req.headers.host}`);
		const match = url.pathname.match(VSCODE_WS_PATH_RE);
		if (!match) return false;

		const [, sessionId, token, tail] = match;

		// Auth: verify path token
		try {
			const auth = await verifyToken(token, env);
			if (!auth) {
				socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
				socket.destroy();
				return true;
			}
		} catch {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return true;
		}

		try {
			const hub = await hubManager.getOrCreate(sessionId);
			await hub.ensureRuntimeReady();
			const previewUrl = hub.getPreviewUrl();
			if (!previewUrl) {
				socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
				socket.destroy();
				return true;
			}

			const sandboxToken = deriveSandboxMcpToken(env.serviceToken, sessionId);
			const upstreamPath = `/_proliferate/vscode${tail || "/"}`;
			const upstreamUrl = `${previewUrl.replace(/^http/, "ws")}${upstreamPath}`;

			logger.info(
				{ sessionId, upstreamUrl: upstreamUrl.replace(/\/\/.*@/, "//***@") },
				"Proxying VS Code WS",
			);

			const upstream = new WebSocket(upstreamUrl, {
				headers: { Authorization: `Bearer ${sandboxToken}` },
			});

			let clientWs: WebSocket | null = null;

			const { WebSocketServer } = await import("ws");
			const wss = new WebSocketServer({ noServer: true });

			upstream.on("open", () => {
				wss.handleUpgrade(req, socket, head, (ws) => {
					clientWs = ws;

					upstream.on("message", (data) => {
						if (ws.readyState === WebSocket.OPEN) {
							ws.send(data);
						}
					});

					ws.on("message", (data) => {
						if (upstream.readyState === WebSocket.OPEN) {
							upstream.send(data);
						}
					});

					ws.on("close", () => {
						if (upstream.readyState === WebSocket.OPEN) {
							upstream.close();
						}
					});

					upstream.on("close", () => {
						if (ws.readyState === WebSocket.OPEN) {
							ws.close();
						}
					});
				});
			});

			upstream.on("error", (err) => {
				logger.error({ err, sessionId }, "VS Code upstream WS error");
				if (clientWs && clientWs.readyState === WebSocket.OPEN) {
					clientWs.close(1011, "Upstream error");
				} else if (!socket.destroyed) {
					socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
					socket.destroy();
				}
			});
		} catch (err) {
			logger.error({ err, sessionId }, "VS Code WS proxy setup error");
			if (!socket.destroyed) {
				socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
				socket.destroy();
			}
		}

		return true;
	};

	return { handleUpgrade };
}
