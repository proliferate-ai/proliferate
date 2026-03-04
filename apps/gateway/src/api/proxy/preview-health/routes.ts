import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import type { GatewayEnv } from "../../../lib/env";
import { createRequireProxyAuth } from "../../../middleware/auth";

const logger = createLogger({ service: "gateway" }).child({ module: "proxy-preview-health" });

export function createPreviewHealthRoutes(env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireProxyAuth = createRequireProxyAuth(env);

	router.get(
		"/:proliferateSessionId/:token/health-check",
		requireProxyAuth,
		async (req: Request, res: Response) => {
			const url = req.query.url;
			if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
				res.status(400).json({ error: "Missing or invalid ?url= parameter (http/https only)" });
				return;
			}

			try {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 5_000);
				const upstream = await fetch(url, { signal: controller.signal, redirect: "follow" });
				clearTimeout(timeout);
				res.json({ ready: upstream.ok, status: upstream.status });
			} catch (error) {
				logger.debug(
					{ err: error, url, sessionId: req.proliferateSessionId },
					"Preview health-check not ready",
				);
				res.json({ ready: false, status: 0 });
			}
		},
	);

	return router;
}
