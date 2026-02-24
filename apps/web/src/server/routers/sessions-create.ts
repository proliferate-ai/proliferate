/**
 * Session creation handler.
 *
 * Thin wrapper that delegates to the sessions service.
 */

import { GATEWAY_URL } from "@/lib/gateway";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { sessions } from "@proliferate/services";

export async function createSessionHandler(input: {
	configurationId?: string;
	sessionType?: "setup" | "coding";
	modelId?: string;
	reasoningEffort?: "quick" | "normal" | "deep";
	initialPrompt?: string;
	orgId: string;
	userId: string;
}): Promise<sessions.CreateSessionResult> {
	try {
		return await sessions.createSession({
			...input,
			gatewayUrl: GATEWAY_URL ?? "",
			serviceToken: env.SERVICE_TO_SERVICE_AUTH_TOKEN ?? "",
		});
	} catch (err) {
		if (err instanceof sessions.SessionLimitError) {
			throw new ORPCError("FORBIDDEN", { message: err.message });
		}
		if (err instanceof sessions.ConfigurationNotFoundError) {
			throw new ORPCError("BAD_REQUEST", { message: err.message });
		}
		if (err instanceof sessions.ConfigurationNoReposError) {
			throw new ORPCError("BAD_REQUEST", { message: err.message });
		}
		if (err instanceof sessions.ConfigurationRepoUnauthorizedError) {
			throw new ORPCError("UNAUTHORIZED", { message: err.message });
		}
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: err instanceof Error ? err.message : "Failed to create session",
		});
	}
}
