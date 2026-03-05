/**
 * Error handler middleware.
 */
import { createLogger } from "@proliferate/logger";
import { BillingGateError } from "@proliferate/shared/billing";
import type { ErrorRequestHandler } from "express";
import { ApiError } from "./api-error";

const logger = createLogger({ service: "gateway" }).child({ module: "error-handler" });

/**
 * Express error handler middleware.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
	if (err instanceof BillingGateError) {
		res.status(402).json({
			error: err.message,
			details: { billingCode: err.code },
		});
		return;
	}

	if (err instanceof ApiError) {
		res.status(err.statusCode).json({
			error: err.message,
			...(err.details ? { details: err.details } : {}),
		});
		return;
	}

	logger.error({ err }, "Unhandled error");
	res.status(500).json({ error: "Internal server error" });
};
