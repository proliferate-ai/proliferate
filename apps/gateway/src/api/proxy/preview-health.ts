/**
 * Preview Health-Check Proxy Route
 *
 * GET /proxy/:proliferateSessionId/:token/health-check?url=<target>
 *
 * Server-side health probe for preview URLs. Fetches the target URL
 * from the gateway and returns { ready, status } so the client can
 * poll without running into CORS / mixed-content issues.
 *
 * Uses requireProxyAuth only (no ensureSessionReady) because the
 * preview may not be ready yet — that's what we're checking.
 */

import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../hub";
import type { GatewayEnv } from "../../lib/env";
import { createRequireProxyAuth } from "../../middleware";

const logger = createLogger({ service: "gateway" }).child({ module: "preview-health" });

export function createPreviewHealthRoutes(_hubManager: HubManager, env: GatewayEnv): RouterType {
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

				const upstream = await fetch(url, {
					signal: controller.signal,
					redirect: "follow",
				});
				clearTimeout(timeout);

				res.json({ ready: upstream.ok, status: upstream.status });
			} catch (err) {
				logger.debug(
					{ err, url, sessionId: req.proliferateSessionId },
					"Preview health-check not ready",
				);
				res.json({ ready: false, status: 0 });
			}
		},
	);

	return router;
}
