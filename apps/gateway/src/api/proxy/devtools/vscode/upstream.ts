import { createLogger } from "@proliferate/logger";
import type { Request } from "express";
import { ApiError } from "../../../../middleware/errors";

const logger = createLogger({ service: "gateway" }).child({ module: "proxy-devtools-vscode" });

export function resolveVscodeUpstream(req: Request): string {
	const previewUrl = req.hub?.getPreviewUrl();
	if (!previewUrl) {
		logger.warn({ sessionId: req.proliferateSessionId }, "No preview URL for vscode proxy");
		throw new ApiError(503, "Sandbox not ready");
	}
	return previewUrl;
}
