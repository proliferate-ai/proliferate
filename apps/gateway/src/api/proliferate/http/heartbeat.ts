/**
 * Heartbeat Route
 *
 * POST /proliferate/:proliferateSessionId/heartbeat
 *
 * Signals that a client is still interested in the session.
 * Resets idle timers without forcing sandbox resume.
 */

import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../../hub";

export function createHeartbeatRouter(hubManager: HubManager): RouterType {
	const router: RouterType = Router({ mergeParams: true });

	router.post("/heartbeat", (req, res) => {
		const { proliferateSessionId } = req.params as Record<string, string>;
		if (!proliferateSessionId) {
			res.status(400).json({ error: "Missing session ID" });
			return;
		}

		const hub = hubManager.get(proliferateSessionId);
		if (!hub) {
			res.status(404).json({ error: "Session not active" });
			return;
		}

		hub.touchActivity();
		res.json({ ok: true });
	});

	return router;
}
