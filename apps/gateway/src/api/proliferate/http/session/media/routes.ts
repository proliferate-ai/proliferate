import { Router, type Router as RouterType } from "express";
import type { GatewayEnv } from "../../../../../lib/env";
import {
	getVerificationFileStream,
	getVerificationFileUrl,
	listVerificationFiles,
} from "../../../../../lib/s3";
import { ApiError } from "../../../../../middleware/errors";

export function createSessionMediaRoutes(env: GatewayEnv): RouterType {
	const router: RouterType = Router();

	router.get("/:proliferateSessionId/verification-media", async (req, res, next) => {
		try {
			const prefix = req.query.prefix as string | undefined;
			const key = req.query.key as string | undefined;
			const stream = req.query.stream === "true";

			if (prefix) {
				const files = await listVerificationFiles(prefix, env);
				res.json({ files });
				return;
			}

			if (key) {
				if (stream) {
					const { body, contentType } = await getVerificationFileStream(key, env);
					res.setHeader("Content-Type", contentType);
					res.setHeader("Content-Length", body.length.toString());
					res.setHeader("Cache-Control", "private, max-age=3600");
					res.send(Buffer.from(body));
					return;
				}
				const presignedUrl = await getVerificationFileUrl(key, env);
				res.json({ url: presignedUrl });
				return;
			}

			throw new ApiError(400, "Missing prefix or key parameter");
		} catch (error) {
			next(error);
		}
	});

	return router;
}
