import type { Request } from "express";
import { ApiError } from "../../../middleware/errors";

export function resolveOpenCodeUpstream(req: Request): string {
	const openCodeUrl = req.hub?.getOpenCodeUrl();
	if (!openCodeUrl) {
		throw new ApiError(503, "Sandbox not ready");
	}
	return openCodeUrl;
}
