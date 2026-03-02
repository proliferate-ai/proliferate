/**
 * Daemon Proxy Routes (G1/G2/G3/G4)
 *
 * Proxies browser requests through gateway to sandbox-daemon endpoints:
 *   GET  /v1/sessions/:proliferateSessionId/fs/tree    -> daemon /_proliferate/fs/tree
 *   GET  /v1/sessions/:proliferateSessionId/fs/read    -> daemon /_proliferate/fs/read
 *   POST /v1/sessions/:proliferateSessionId/fs/write   -> daemon /_proliferate/fs/write
 *   GET  /v1/sessions/:proliferateSessionId/pty/replay -> daemon /_proliferate/pty/replay
 *   POST /v1/sessions/:proliferateSessionId/pty/write  -> daemon /_proliferate/pty/write
 *   GET  /v1/sessions/:proliferateSessionId/preview/ports -> daemon /_proliferate/ports
 *   GET  /v1/sessions/:proliferateSessionId/daemon/health -> daemon /_proliferate/health
 *
 * Auth: Bearer JWT from gateway client.
 * Hop 2: gateway signs requests with X-Proliferate-Sandbox-Signature.
 */

import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../hub";
import type { GatewayEnv } from "../../lib/env";
import { deriveSandboxMcpToken } from "../../lib/sandbox-mcp-token";
import { createEnsureSessionReady, createRequireAuth } from "../../middleware";

const logger = createLogger({ service: "gateway" }).child({ module: "daemon-proxy" });

const FS_WRITE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Fetch from daemon with auth token injection.
 */
async function daemonFetch(
	previewUrl: string,
	daemonPath: string,
	opts: {
		method?: string;
		body?: string;
		serviceToken: string;
		sessionId: string;
		timeoutMs?: number;
	},
): Promise<globalThis.Response> {
	const token = deriveSandboxMcpToken(opts.serviceToken, opts.sessionId);
	const url = `${previewUrl}${daemonPath}`;
	logger.debug({ url, method: opts.method ?? "GET", sessionId: opts.sessionId }, "daemonFetch");
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);

	try {
		const res = await fetch(url, {
			method: opts.method ?? "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: opts.body,
			signal: controller.signal,
		});
		return res;
	} finally {
		clearTimeout(timeout);
	}
}

export function createDaemonProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireAuth = createRequireAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	// Helper to get daemon base URL from hub
	function getDaemonUrl(req: Request): string | null {
		const hub = req.hub;
		if (!hub) return null;
		// Use preview URL as the daemon ingress (daemon binds on the same port)
		return hub.getPreviewUrl() || null;
	}

	// GET /v1/sessions/:proliferateSessionId/fs/tree
	router.get(
		"/v1/sessions/:proliferateSessionId/fs/tree",
		requireAuth,
		ensureSessionReady,
		async (req: Request, res: Response) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) {
				res.status(503).json({ error: "Sandbox not ready" });
				return;
			}

			const path = (req.query.path as string) ?? ".";
			const depth = req.query.depth ?? "1";
			const queryStr = `?path=${encodeURIComponent(path)}&depth=${encodeURIComponent(String(depth))}`;

			try {
				const upstream = await daemonFetch(daemonUrl, `/_proliferate/fs/tree${queryStr}`, {
					serviceToken: env.serviceToken,
					sessionId: req.proliferateSessionId!,
				});
				const data = await upstream.json();
				res.status(upstream.status).json(data);
			} catch (err) {
				logger.error({ err, sessionId: req.proliferateSessionId }, "Daemon fs/tree proxy error");
				res.status(502).json({ error: "Daemon unreachable" });
			}
		},
	);

	// GET /v1/sessions/:proliferateSessionId/fs/read
	router.get(
		"/v1/sessions/:proliferateSessionId/fs/read",
		requireAuth,
		ensureSessionReady,
		async (req: Request, res: Response) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) {
				res.status(503).json({ error: "Sandbox not ready" });
				return;
			}

			const path = req.query.path as string;
			if (!path) {
				res.status(400).json({ error: "path query parameter is required" });
				return;
			}

			try {
				const upstream = await daemonFetch(
					daemonUrl,
					`/_proliferate/fs/read?path=${encodeURIComponent(path)}`,
					{
						serviceToken: env.serviceToken,
						sessionId: req.proliferateSessionId!,
					},
				);
				const data = await upstream.json();
				res.status(upstream.status).json(data);
			} catch (err) {
				logger.error({ err, sessionId: req.proliferateSessionId }, "Daemon fs/read proxy error");
				res.status(502).json({ error: "Daemon unreachable" });
			}
		},
	);

	// POST /v1/sessions/:proliferateSessionId/fs/write
	router.post(
		"/v1/sessions/:proliferateSessionId/fs/write",
		requireAuth,
		ensureSessionReady,
		async (req: Request, res: Response) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) {
				res.status(503).json({ error: "Sandbox not ready" });
				return;
			}

			const { path, content } = req.body as { path?: string; content?: string };
			if (!path || typeof content !== "string") {
				res.status(400).json({ error: "path and content are required" });
				return;
			}

			if (Buffer.byteLength(content, "utf-8") > FS_WRITE_MAX_BYTES) {
				res.status(413).json({ error: `Payload exceeds ${FS_WRITE_MAX_BYTES} byte limit` });
				return;
			}

			try {
				const upstream = await daemonFetch(daemonUrl, "/_proliferate/fs/write", {
					method: "POST",
					body: JSON.stringify({ path, content }),
					serviceToken: env.serviceToken,
					sessionId: req.proliferateSessionId!,
				});
				const data = await upstream.json();
				res.status(upstream.status).json(data);
			} catch (err) {
				logger.error({ err, sessionId: req.proliferateSessionId }, "Daemon fs/write proxy error");
				res.status(502).json({ error: "Daemon unreachable" });
			}
		},
	);

	// GET /v1/sessions/:proliferateSessionId/pty/replay
	router.get(
		"/v1/sessions/:proliferateSessionId/pty/replay",
		requireAuth,
		ensureSessionReady,
		async (req: Request, res: Response) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) {
				res.status(503).json({ error: "Sandbox not ready" });
				return;
			}

			const processId = (req.query.process_id as string) ?? "";
			const lastSeq = (req.query.last_seq as string) ?? "0";
			const queryStr = `?process_id=${encodeURIComponent(processId)}&last_seq=${encodeURIComponent(lastSeq)}`;

			try {
				const upstream = await daemonFetch(daemonUrl, `/_proliferate/pty/replay${queryStr}`, {
					serviceToken: env.serviceToken,
					sessionId: req.proliferateSessionId!,
				});
				const data = await upstream.json();
				res.status(upstream.status).json(data);
			} catch (err) {
				logger.error({ err, sessionId: req.proliferateSessionId }, "Daemon pty/replay proxy error");
				res.status(502).json({ error: "Daemon unreachable" });
			}
		},
	);

	// POST /v1/sessions/:proliferateSessionId/pty/write
	router.post(
		"/v1/sessions/:proliferateSessionId/pty/write",
		requireAuth,
		ensureSessionReady,
		async (req: Request, res: Response) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) {
				res.status(503).json({ error: "Sandbox not ready" });
				return;
			}

			try {
				const upstream = await daemonFetch(daemonUrl, "/_proliferate/pty/write", {
					method: "POST",
					body: JSON.stringify(req.body),
					serviceToken: env.serviceToken,
					sessionId: req.proliferateSessionId!,
				});
				const data = await upstream.json();
				res.status(upstream.status).json(data);
			} catch (err) {
				logger.error({ err, sessionId: req.proliferateSessionId }, "Daemon pty/write proxy error");
				res.status(502).json({ error: "Daemon unreachable" });
			}
		},
	);

	// GET /v1/sessions/:proliferateSessionId/preview/ports
	router.get(
		"/v1/sessions/:proliferateSessionId/preview/ports",
		requireAuth,
		ensureSessionReady,
		async (req: Request, res: Response) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) {
				res.status(503).json({ error: "Sandbox not ready" });
				return;
			}

			try {
				const upstream = await daemonFetch(daemonUrl, "/_proliferate/ports", {
					serviceToken: env.serviceToken,
					sessionId: req.proliferateSessionId!,
				});
				const data = await upstream.json();
				res.status(upstream.status).json(data);
			} catch (err) {
				logger.error({ err, sessionId: req.proliferateSessionId }, "Daemon ports proxy error");
				res.status(502).json({ error: "Daemon unreachable" });
			}
		},
	);

	// GET /v1/sessions/:proliferateSessionId/daemon/health
	router.get(
		"/v1/sessions/:proliferateSessionId/daemon/health",
		requireAuth,
		ensureSessionReady,
		async (req: Request, res: Response) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) {
				res.status(503).json({ error: "Sandbox not ready" });
				return;
			}

			try {
				const upstream = await daemonFetch(daemonUrl, "/_proliferate/health", {
					serviceToken: env.serviceToken,
					sessionId: req.proliferateSessionId!,
				});
				const data = await upstream.json();
				res.status(upstream.status).json(data);
			} catch (err) {
				logger.error({ err, sessionId: req.proliferateSessionId }, "Daemon health proxy error");
				res.status(502).json({ error: "Daemon unreachable" });
			}
		},
	);

	return router;
}
