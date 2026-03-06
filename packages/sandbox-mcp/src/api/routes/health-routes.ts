import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

export function createHealthRoutes(): Router {
	const router = Router();

	router.get("/health", (_req, res) => {
		res.json({ status: "ok" });
	});

	router.get("/auth/check", requireAuth, (_req, res) => {
		res.json({ status: "ok" });
	});

	return router;
}
