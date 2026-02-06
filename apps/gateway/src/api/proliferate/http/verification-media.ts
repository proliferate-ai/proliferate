/**
 * Verification Media Route
 *
 * GET /proliferate/:proliferateSessionId/verification-media
 *
 * List or get verification files from S3.
 */

import { Router, type Router as RouterType } from "express";
import type { GatewayEnv } from "../../../lib/env";
import {
	getVerificationFileStream,
	getVerificationFileUrl,
	listVerificationFiles,
} from "../../../lib/s3";
import { ApiError } from "../../../middleware";

export function createVerificationMediaRouter(env: GatewayEnv): RouterType {
	const router: RouterType = Router();

	/**
	 * GET /proliferate/:proliferateSessionId/verification-media
	 * List files or get a specific file from S3
	 */
	router.get("/:proliferateSessionId/verification-media", async (req, res, next) => {
		try {
			const prefix = req.query.prefix as string | undefined;
			const key = req.query.key as string | undefined;
			const stream = req.query.stream === "true";

			if (prefix) {
				// List files under prefix
				const files = await listVerificationFiles(prefix, env);
				res.json({ files });
				return;
			}

			if (key) {
				if (stream) {
					// Stream file content
					const { body, contentType } = await getVerificationFileStream(key, env);
					res.setHeader("Content-Type", contentType);
					res.setHeader("Content-Length", body.length.toString());
					res.setHeader("Cache-Control", "private, max-age=3600");
					res.send(Buffer.from(body));
					return;
				}
				// Return presigned URL
				const presignedUrl = await getVerificationFileUrl(key, env);
				res.json({ url: presignedUrl });
				return;
			}

			throw new ApiError(400, "Missing prefix or key parameter");
		} catch (err) {
			next(err);
		}
	});

	return router;
}
