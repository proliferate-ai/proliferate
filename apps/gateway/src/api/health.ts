/**
 * Health Check Route
 *
 * GET /health
 */

import { Router, type Router as RouterType } from "express";

const router: RouterType = Router();

router.get("/health", (_req, res) => {
	res.json({ status: "ok" });
});

export default router;
