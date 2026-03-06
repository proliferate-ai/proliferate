import type { NextFunction, Request, Response } from "express";

export function allowCors(req: Request, res: Response, next: NextFunction): void {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
	res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
	if (req.method === "OPTIONS") {
		res.sendStatus(200);
		return;
	}
	next();
}
