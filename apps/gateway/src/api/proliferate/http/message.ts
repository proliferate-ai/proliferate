/**
 * Message Route
 *
 * POST /proliferate/:proliferateSessionId/message
 *
 * Send a prompt to the session.
 */

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
	try {
		const body = req.body as MessageBody;
		const orgId = req.auth?.orgId;
		const idempotencyKey = req.header("Idempotency-Key");

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
			const userId = body.userId || req.auth?.userId || "anonymous";
			await req.hub!.postPrompt(body.content, userId, body.source, body.images);
			const response = { ok: true };
			if (idempotencyState) {
				await storeIdempotencyResponse(idempotencyState.orgId, idempotencyState.key, response);
			}
			res.json(response);
			return;
		}

		throw new ApiError(400, "Invalid message type");
	} catch (err) {
		if (idempotencyState) {
			await clearIdempotencyKey(idempotencyState.orgId, idempotencyState.key);
		}
		next(err);
	}
});

export default router;
