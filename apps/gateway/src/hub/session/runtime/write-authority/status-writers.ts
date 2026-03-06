import type { Logger } from "@proliferate/logger";
import { projectOperatorStatus } from "../../session-lifecycle";

export function projectRuntimeRunning(input: {
	sessionId: string;
	organizationId: string;
	logger: Logger;
}): Promise<string> {
	return projectOperatorStatus({
		sessionId: input.sessionId,
		organizationId: input.organizationId,
		runtimeStatus: "running",
		hasPendingApproval: false,
		logger: input.logger,
	});
}
