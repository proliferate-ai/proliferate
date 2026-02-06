/**
 * Session Info Route
 *
 * GET /proliferate/:proliferateSessionId
 *
 * Returns session and sandbox metadata.
 */

import { Router, type Router as RouterType } from "express";

const router: RouterType = Router({ mergeParams: true });

/**
 * GET /proliferate/:proliferateSessionId
 * Get session info including sandbox status
 */
router.get("/", async (req, res, next) => {
	try {
		const sandboxInfo = await req.hub!.getSandboxInfo();
		res.json(sandboxInfo);
	} catch (err) {
		next(err);
	}
});

export default router;
