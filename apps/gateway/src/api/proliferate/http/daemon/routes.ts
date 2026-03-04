import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../../../hub";
import type { GatewayEnv } from "../../../../lib/env";
import { createRequireAuth } from "../../../../middleware/auth";
import { createEnsureSessionReady } from "../../../../middleware/session";
import { daemonFetch, getDaemonUrl } from "./upstream";

const logger = createLogger({ service: "gateway" }).child({ module: "daemon-proxy" });
const FS_WRITE_MAX_BYTES = 10 * 1024 * 1024;

export function createDaemonRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireAuth = createRequireAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	router.get(
		"/v1/sessions/:proliferateSessionId/fs/tree",
		requireAuth,
		ensureSessionReady,
		async (req, res) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) return res.status(503).json({ error: "Sandbox not ready" });
			const path = (req.query.path as string) ?? ".";
			const depth = req.query.depth ?? "1";
			const query = `?path=${encodeURIComponent(path)}&depth=${encodeURIComponent(String(depth))}`;
			return proxyJson(req, res, daemonUrl, `/_proliferate/fs/tree${query}`, env);
		},
	);

	router.get(
		"/v1/sessions/:proliferateSessionId/fs/read",
		requireAuth,
		ensureSessionReady,
		async (req, res) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) return res.status(503).json({ error: "Sandbox not ready" });
			const path = req.query.path as string;
			if (!path) return res.status(400).json({ error: "path query parameter is required" });
			return proxyJson(
				req,
				res,
				daemonUrl,
				`/_proliferate/fs/read?path=${encodeURIComponent(path)}`,
				env,
			);
		},
	);

	router.post(
		"/v1/sessions/:proliferateSessionId/fs/write",
		requireAuth,
		ensureSessionReady,
		async (req, res) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) return res.status(503).json({ error: "Sandbox not ready" });
			const { path, content } = req.body as { path?: string; content?: string };
			if (!path || typeof content !== "string") {
				return res.status(400).json({ error: "path and content are required" });
			}
			if (Buffer.byteLength(content, "utf-8") > FS_WRITE_MAX_BYTES) {
				return res.status(413).json({ error: `Payload exceeds ${FS_WRITE_MAX_BYTES} byte limit` });
			}
			return proxyJson(req, res, daemonUrl, "/_proliferate/fs/write", env, {
				method: "POST",
				body: JSON.stringify({ path, content }),
			});
		},
	);

	router.get(
		"/v1/sessions/:proliferateSessionId/pty/replay",
		requireAuth,
		ensureSessionReady,
		async (req, res) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) return res.status(503).json({ error: "Sandbox not ready" });
			const processId = (req.query.process_id as string) ?? "";
			const lastSeq = (req.query.last_seq as string) ?? "0";
			const query = `?process_id=${encodeURIComponent(processId)}&last_seq=${encodeURIComponent(lastSeq)}`;
			return proxyJson(req, res, daemonUrl, `/_proliferate/pty/replay${query}`, env);
		},
	);

	router.post(
		"/v1/sessions/:proliferateSessionId/pty/write",
		requireAuth,
		ensureSessionReady,
		async (req, res) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) return res.status(503).json({ error: "Sandbox not ready" });
			return proxyJson(req, res, daemonUrl, "/_proliferate/pty/write", env, {
				method: "POST",
				body: JSON.stringify(req.body),
			});
		},
	);

	router.get(
		"/v1/sessions/:proliferateSessionId/preview/ports",
		requireAuth,
		ensureSessionReady,
		async (req, res) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) return res.status(503).json({ error: "Sandbox not ready" });
			return proxyJson(req, res, daemonUrl, "/_proliferate/ports", env);
		},
	);

	router.get(
		"/v1/sessions/:proliferateSessionId/daemon/health",
		requireAuth,
		ensureSessionReady,
		async (req, res) => {
			const daemonUrl = getDaemonUrl(req);
			if (!daemonUrl) return res.status(503).json({ error: "Sandbox not ready" });
			return proxyJson(req, res, daemonUrl, "/_proliferate/health", env);
		},
	);

	return router;
}

async function proxyJson(
	req: Request,
	res: Response,
	daemonUrl: string,
	path: string,
	env: GatewayEnv,
	options?: { method?: string; body?: string },
) {
	try {
		const upstream = await daemonFetch(daemonUrl, path, {
			method: options?.method,
			body: options?.body,
			serviceToken: env.serviceToken,
			sessionId: req.proliferateSessionId!,
		});
		const data = await upstream.json();
		return res.status(upstream.status).json(data);
	} catch (error) {
		logger.error({ err: error, sessionId: req.proliferateSessionId }, "Daemon proxy error");
		return res.status(502).json({ error: "Daemon unreachable" });
	}
}
