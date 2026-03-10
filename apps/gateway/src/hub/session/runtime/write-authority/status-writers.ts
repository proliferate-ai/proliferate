import type { Logger } from "@proliferate/logger";
import { projectSessionState } from "../../session-lifecycle";

export function projectRuntimeRunning(input: {
	sessionId: string;
	organizationId: string;
	logger: Logger;
}): Promise<void> {
	return projectSessionState({
		sessionId: input.sessionId,
		sandboxState: "running",
		logger: input.logger,
	});
}
