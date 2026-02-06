/**
 * Error Handler Middleware
 *
 * Consistent error responses across all routes.
 */

import type { ErrorRequestHandler } from "express";

/**
 * API error with status code and optional details
 */
export class ApiError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/**
 * Express error handler middleware
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
	if (err instanceof ApiError) {
		res.status(err.statusCode).json({
			error: err.message,
			...(err.details ? { details: err.details } : {}),
		});
		return;
	}

	console.error("[Gateway] Unhandled error:", err);
	res.status(500).json({ error: "Internal server error" });
};
