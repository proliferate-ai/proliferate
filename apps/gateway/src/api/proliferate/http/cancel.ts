/**
 * Cancel Route
 *
 * POST /proliferate/:proliferateSessionId/cancel
 *
 * Cancel the current message.
 */

import { Router, type Router as RouterType } from "express";

const router: RouterType = Router({ mergeParams: true });

/**
 * POST /proliferate/:proliferateSessionId/cancel
 * Cancel the current message
 */
router.post("/cancel", async (req, res, next) => {
	try {
		req.hub!.postCancel();
		res.json({ ok: true });
	} catch (err) {
		next(err);
	}
});

export default router;
