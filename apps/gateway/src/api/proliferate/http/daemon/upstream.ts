import { createLogger } from "@proliferate/logger";
import type { Request } from "express";
import { deriveSandboxMcpToken } from "../../../../middleware/auth";

const logger = createLogger({ service: "gateway" }).child({ module: "daemon-upstream" });

export function getDaemonUrl(req: Request): string | null {
	const hub = req.hub;
	if (!hub) return null;
	return hub.getPreviewUrl() || null;
}

export async function daemonFetch(
	previewUrl: string,
	daemonPath: string,
	opts: {
		method?: string;
		body?: string;
		serviceToken: string;
		sessionId: string;
		timeoutMs?: number;
	},
): Promise<globalThis.Response> {
	const token = deriveSandboxMcpToken(opts.serviceToken, opts.sessionId);
	const url = `${previewUrl}${daemonPath}`;
	logger.debug({ url, method: opts.method ?? "GET", sessionId: opts.sessionId }, "daemonFetch");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
	try {
		return await fetch(url, {
			method: opts.method ?? "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: opts.body,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}
}
