import { sessions } from "@proliferate/services";
import type { ManagerToolContext } from "../../../../../harness/manager/tools/types";
import type { HubManager } from "../../../../../hub";
import { createInProcessManagerControlFacade } from "../../../../../hub/session/runtime/manager/manager-control-facade";
import { ApiError } from "../../../../../server/middleware/errors";
import type { AuthResult } from "../../../../../types";

type SessionRecord = NonNullable<Awaited<ReturnType<typeof sessions.findSessionByIdInternal>>>;

export type ManagerControlSession = SessionRecord & {
	kind: "manager";
	workerId: string;
};

export function requireManagerControlAuth(auth?: AuthResult): void {
	if (!auth || (auth.source !== "sandbox" && auth.source !== "service")) {
		throw new ApiError(403, "Manager control routes require sandbox or service authentication");
	}
}

export async function requireManagerControlSession(
	sessionId: string,
	auth?: AuthResult,
): Promise<ManagerControlSession> {
	requireManagerControlAuth(auth);
	if (auth?.source === "sandbox" && auth.sessionId && auth.sessionId !== sessionId) {
		throw new ApiError(403, "Sandbox token does not match the manager session");
	}

	const session = await sessions.findSessionByIdInternal(sessionId);
	if (!session) {
		throw new ApiError(404, "Session not found");
	}
	if (session.kind !== "manager") {
		throw new ApiError(409, "Session is not a manager session");
	}
	if (!session.workerId) {
		throw new ApiError(409, "Manager session is missing its worker binding");
	}

	return session as ManagerControlSession;
}

export function createManagerToolExecutionContext(params: {
	managerSession: ManagerControlSession;
	hubManager: HubManager;
}): ManagerToolContext {
	return {
		managerSessionId: params.managerSession.id,
		organizationId: params.managerSession.organizationId,
		workerId: params.managerSession.workerId,
		gatewayUrl: "http://localhost",
		serviceToken: "in-process",
		controlFacade: createInProcessManagerControlFacade({
			getOrCreateHub: (sessionId) => params.hubManager.getOrCreate(sessionId),
		}),
	};
}
