import type { NextFunction, Request, Response } from "express";
import { validateBearerToken } from "../../auth.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
	if (!validateBearerToken(req.headers.authorization)) {
		res.status(401).json({ error: "Unauthorized" });
		return;
	}
	next();
}
