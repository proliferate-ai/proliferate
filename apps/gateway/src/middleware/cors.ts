/**
 * CORS Middleware
 *
 * Handles CORS preflight and headers for all routes.
 */

import type { RequestHandler } from "express";

/**
 * CORS headers for responses
 */
export const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
	"Access-Control-Max-Age": "86400",
} as const;

/**
 * CORS middleware - adds headers and handles preflight
 */
export const cors: RequestHandler = (req, res, next) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

	if (req.method === "OPTIONS") {
		res.setHeader("Access-Control-Max-Age", "86400");
		res.status(204).end();
		return;
	}

	next();
};
