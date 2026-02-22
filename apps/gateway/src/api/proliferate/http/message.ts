/**
 * Message Route
 *
 * POST /proliferate/:proliferateSessionId/message
 *
 * Send a prompt to the session.
 */

import { createLogger } from "@proliferate/logger";
import type { ClientSource } from "@proliferate/shared";
import { Router, type Router as RouterType } from "express";
import {
	clearIdempotencyKey,
	readIdempotencyResponse,
	reserveIdempotencyKey,
	storeIdempotencyResponse,
} from "../../../lib/idempotency";
import { ApiError } from "../../../middleware";

const router: RouterType = Router({ mergeParams: true });
const logger = createLogger({ service: "gateway" }).child({ module: "message-route" });

interface MessageBody {
	type: string;
	content?: string;
	userId?: string;
	source?: ClientSource;
	images?: string[];
}

/**
 * POST /proliferate/:proliferateSessionId/message
 * Send a prompt to the session
 */
router.post("/message", async (req, res, next) => {
	let idempotencyState: { orgId: string; key: string } | null = null;
	const startMs = Date.now();
	try {
		const body = req.body as MessageBody;
		const orgId = req.auth?.orgId;
		const idempotencyKey = req.header("Idempotency-Key");
		const sessionId = (req.params as Record<string, string>)?.proliferateSessionId ?? null;
		logger.info(
			{
				sessionId,
				orgId: orgId ?? null,
				authSource: req.auth?.source ?? null,
				idempotencyKey: idempotencyKey ?? null,
				type: body.type,
				contentLength: typeof body.content === "string" ? body.content.length : 0,
				imageCount: Array.isArray(body.images) ? body.images.length : 0,
				source: body.source ?? null,
			},
			"message.request.received",
		);

		if (idempotencyKey && orgId) {
			const existing = await readIdempotencyResponse(orgId, idempotencyKey);
			if (existing) {
				res.json(existing);
				return;
			}

			const reservation = await reserveIdempotencyKey(orgId, idempotencyKey);
			if (reservation === "exists") {
				const replay = await readIdempotencyResponse(orgId, idempotencyKey);
				if (replay) {
					res.json(replay);
					return;
				}
			}
			if (reservation === "in_flight") {
				throw new ApiError(409, "Idempotent request already in progress");
			}
			idempotencyState = { orgId, key: idempotencyKey };
		}

		if (body.type === "prompt" && body.content) {
			const auth = req.auth;
			if (!auth) {
				throw new ApiError(401, "Authentication required");
			}

			// Never trust a caller-supplied userId unless it's a service token explicitly acting on behalf
			// of a user. For user tokens, derive identity from the token.
			const userId = auth.source === "service" ? body.userId : auth.userId;
			if (!userId) {
				throw new ApiError(
					auth.source === "service" ? 400 : 401,
					auth.source === "service"
						? "userId is required for service prompts"
						: "User identity required",
				);
			}

			logger.info(
				{
					sessionId,
					userId,
					source: body.source ?? null,
					contentLength: body.content.length,
					imageCount: Array.isArray(body.images) ? body.images.length : 0,
				},
				"message.request.dispatching_prompt",
			);

			await req.hub!.postPrompt(body.content, userId, body.source, body.images);
			const response = { ok: true };
			if (idempotencyState) {
				await storeIdempotencyResponse(idempotencyState.orgId, idempotencyState.key, response);
			}
			logger.info(
				{
					sessionId,
					userId,
					durationMs: Date.now() - startMs,
				},
				"message.request.completed",
			);
			res.json(response);
			return;
		}

		throw new ApiError(400, "Invalid message type");
	} catch (err) {
		if (idempotencyState) {
			await clearIdempotencyKey(idempotencyState.orgId, idempotencyState.key);
		}
		logger.error(
			{
				err,
				sessionId: (req.params as Record<string, string>)?.proliferateSessionId ?? null,
				durationMs: Date.now() - startMs,
			},
			"message.request.failed",
		);
		next(err);
	}
});

export default router;
