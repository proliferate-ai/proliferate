import { createLogger } from "@proliferate/logger";
import { workers } from "@proliferate/services";
import type { WorkerRunEventType } from "@proliferate/shared/contracts/workers";
import { Router, type Router as RouterType } from "express";
import { executeManagerTool } from "../../../../../harness/manager/tools";
import type { HubManager } from "../../../../../hub";
import { ApiError } from "../../../../../server/middleware/errors";
import {
	claimManagerRunContext,
	createManagerToolExecutionContext,
	requireActiveManagerRun,
	requireManagerControlSession,
} from "./helpers";

const logger = createLogger({ service: "gateway" }).child({ module: "manager-control" });

export function createManagerRoutes(hubManager: HubManager): RouterType {
	const router: RouterType = Router({ mergeParams: true });

	router.use((req, _res, next) => {
		req.proliferateSessionId = req.params.proliferateSessionId;
		next();
	});

	router.post("/runs/claim", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			if (!sessionId) {
				throw new ApiError(400, "Missing session ID");
			}

			const managerSession = await requireManagerControlSession(sessionId, req.auth);
			const claimed = await claimManagerRunContext(
				managerSession,
				logger.child({ managerSessionId: sessionId }),
			);
			res.json(claimed);
		} catch (error) {
			next(error);
		}
	});

	router.post("/tools/execute", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			if (!sessionId) {
				throw new ApiError(400, "Missing session ID");
			}

			const { toolName, args, workerRunId, workerId } = req.body as {
				toolName?: string;
				args?: Record<string, unknown>;
				workerRunId?: string;
				workerId?: string;
			};
			if (!toolName || typeof toolName !== "string") {
				throw new ApiError(400, "Missing or invalid toolName");
			}
			if (!workerRunId || typeof workerRunId !== "string") {
				throw new ApiError(400, "Missing or invalid workerRunId");
			}
			if (workerId !== undefined && typeof workerId !== "string") {
				throw new ApiError(400, "workerId must be a string when provided");
			}
			if (
				args !== undefined &&
				(typeof args !== "object" || args === null || Array.isArray(args))
			) {
				throw new ApiError(400, "args must be an object");
			}

			const managerSession = await requireManagerControlSession(sessionId, req.auth);
			const activeRun = await requireActiveManagerRun(managerSession, workerRunId);
			if (workerId && workerId !== activeRun.workerId) {
				throw new ApiError(409, "Worker context does not match the active run");
			}

			const result = await executeManagerTool(
				toolName,
				args ?? {},
				createManagerToolExecutionContext({ managerSession, activeRun, hubManager }),
				logger.child({
					managerSessionId: sessionId,
					toolName,
					workerRunId,
				}),
			);
			res.json({ result });
		} catch (error) {
			next(error);
		}
	});

	router.post("/runs/:workerRunId/events", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			const { workerRunId } = req.params as Record<string, string>;
			if (!sessionId) {
				throw new ApiError(400, "Missing session ID");
			}
			if (!workerRunId) {
				throw new ApiError(400, "Missing workerRunId");
			}

			const {
				eventType,
				summaryText,
				payloadJson,
				payloadVersion,
				sessionId: eventSessionId,
			} = req.body as {
				eventType?: string;
				summaryText?: string;
				payloadJson?: unknown;
				payloadVersion?: number;
				sessionId?: string;
				actionInvocationId?: string;
				dedupeKey?: string;
			};
			const { actionInvocationId, dedupeKey } = req.body as {
				actionInvocationId?: string;
				dedupeKey?: string;
			};

			if (!eventType || typeof eventType !== "string") {
				throw new ApiError(400, "Missing or invalid eventType");
			}
			if (summaryText !== undefined && typeof summaryText !== "string") {
				throw new ApiError(400, "summaryText must be a string when provided");
			}
			if (payloadVersion !== undefined && !Number.isInteger(payloadVersion)) {
				throw new ApiError(400, "payloadVersion must be an integer when provided");
			}
			if (eventSessionId !== undefined && typeof eventSessionId !== "string") {
				throw new ApiError(400, "sessionId must be a string when provided");
			}
			if (actionInvocationId !== undefined && typeof actionInvocationId !== "string") {
				throw new ApiError(400, "actionInvocationId must be a string when provided");
			}
			if (dedupeKey !== undefined && typeof dedupeKey !== "string") {
				throw new ApiError(400, "dedupeKey must be a string when provided");
			}

			const managerSession = await requireManagerControlSession(sessionId, req.auth);
			const activeRun = await requireActiveManagerRun(managerSession, workerRunId);
			const event = await workers.appendWorkerRunEvent({
				workerRunId: activeRun.id,
				workerId: activeRun.workerId,
				eventType: eventType as WorkerRunEventType,
				summaryText,
				payloadJson,
				payloadVersion,
				sessionId: eventSessionId,
				actionInvocationId,
				dedupeKey,
			});
			res.status(201).json({ event });
		} catch (error) {
			next(mapWorkerMutationError(error));
		}
	});

	router.post("/runs/:workerRunId/complete", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			const { workerRunId } = req.params as Record<string, string>;
			if (!sessionId) {
				throw new ApiError(400, "Missing session ID");
			}
			if (!workerRunId) {
				throw new ApiError(400, "Missing workerRunId");
			}

			const { summary, result } = req.body as {
				summary?: string;
				result?: string;
			};
			if (summary !== undefined && typeof summary !== "string") {
				throw new ApiError(400, "summary must be a string when provided");
			}
			if (result !== undefined && typeof result !== "string") {
				throw new ApiError(400, "result must be a string when provided");
			}

			const managerSession = await requireManagerControlSession(sessionId, req.auth);
			await requireActiveManagerRun(managerSession, workerRunId);
			const workerRun = await workers.completeWorkerRun({
				workerRunId,
				organizationId: managerSession.organizationId,
				summary,
				result,
			});
			res.json({ workerRun });
		} catch (error) {
			next(mapWorkerMutationError(error));
		}
	});

	router.post("/runs/:workerRunId/fail", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId;
			const { workerRunId } = req.params as Record<string, string>;
			if (!sessionId) {
				throw new ApiError(400, "Missing session ID");
			}
			if (!workerRunId) {
				throw new ApiError(400, "Missing workerRunId");
			}

			const { errorCode, errorMessage, retryable } = req.body as {
				errorCode?: string;
				errorMessage?: string;
				retryable?: boolean;
			};
			if (!errorCode || typeof errorCode !== "string") {
				throw new ApiError(400, "Missing or invalid errorCode");
			}
			if (errorMessage !== undefined && typeof errorMessage !== "string") {
				throw new ApiError(400, "errorMessage must be a string when provided");
			}
			if (retryable !== undefined && typeof retryable !== "boolean") {
				throw new ApiError(400, "retryable must be a boolean when provided");
			}

			const managerSession = await requireManagerControlSession(sessionId, req.auth);
			await requireActiveManagerRun(managerSession, workerRunId);
			const workerRun = await workers.failWorkerRun({
				workerRunId,
				organizationId: managerSession.organizationId,
				errorCode,
				errorMessage,
				retryable,
			});
			res.json({ workerRun });
		} catch (error) {
			next(mapWorkerMutationError(error));
		}
	});

	return router;
}

function mapWorkerMutationError(error: unknown): unknown {
	if (error instanceof ApiError) {
		return error;
	}
	if (error instanceof workers.WorkerRunEventTypeError) {
		return new ApiError(400, error.message);
	}
	if (error instanceof workers.WorkerRunNotFoundError) {
		return new ApiError(404, error.message);
	}
	if (error instanceof workers.WorkerRunTransitionError) {
		return new ApiError(409, error.message);
	}
	return error;
}
