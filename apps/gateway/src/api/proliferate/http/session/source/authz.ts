import { sessions } from "@proliferate/services";
import { ApiError } from "../../../../../middleware/errors";

export async function resolveSessionWorker(sessionId: string, authOrgId?: string) {
	const session = await sessions.findByIdInternal(sessionId);
	if (!session) {
		throw new ApiError(404, "Session not found");
	}

	if (authOrgId && authOrgId !== session.organizationId) {
		throw new ApiError(403, "You do not have access to this session");
	}

	if (!session.workerId) {
		throw new ApiError(400, "Session is not associated with a worker");
	}

	return { workerId: session.workerId, organizationId: session.organizationId };
}
