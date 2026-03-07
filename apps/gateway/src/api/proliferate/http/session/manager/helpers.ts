import type { Logger } from "@proliferate/logger";
import { sessions, sourceReads, wakes, workers } from "@proliferate/services";
import type { ManagerToolContext } from "../../../../../harness/manager/tools/types";
import type { HubManager } from "../../../../../hub";
import { createInProcessManagerControlFacade } from "../../../../../hub/session/runtime/manager/manager-control-facade";
import { ApiError } from "../../../../../server/middleware/errors";
import type { AuthResult } from "../../../../../types";

const DEFAULT_MANAGER_MEMORY_DIR = "/workspace/.proliferate/manager-memory";
const DEFAULT_MANAGER_MEMORY_INDEX_PATH = `${DEFAULT_MANAGER_MEMORY_DIR}/memory.md`;

type SessionRecord = NonNullable<Awaited<ReturnType<typeof sessions.findSessionByIdInternal>>>;
type WorkerRunRecord = NonNullable<Awaited<ReturnType<typeof workers.findActiveRunByWorker>>>;

export interface ManagerRunClaimResponse {
	status: "idle" | "claimed";
	managerSessionId?: string;
	organizationId?: string;
	workerId?: string;
	workerRunId?: string;
	workerRunStatus?: string;
	managerMemoryDir?: string;
	managerMemoryIndexPath?: string;
	wakeEvent?: {
		id: string;
		status: string;
		source: string;
		payloadJson: unknown;
	};
	worker?: {
		id: string;
		name: string;
		objective: string | null;
	};
	deniedCapabilityKeys?: string[];
	pendingDirectives?: Array<{
		id: string;
		messageType: string;
		payloadJson: unknown;
		queuedAt: string;
		senderUserId: string | null;
	}>;
	wakePayloadSourceData?: string[];
}

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

export async function claimManagerRunContext(
	managerSession: ManagerControlSession,
	log: Logger,
): Promise<ManagerRunClaimResponse> {
	let activeRun = await workers.findActiveRunByWorker(
		managerSession.workerId,
		managerSession.organizationId,
	);
	if (!activeRun) {
		log.info({ workerId: managerSession.workerId }, "No active run; attempting to claim next wake");
		const orchestrated = await workers.orchestrateNextWakeAndCreateRun(
			managerSession.workerId,
			managerSession.organizationId,
		);
		if (!orchestrated) {
			return { status: "idle" };
		}
		activeRun = orchestrated.workerRun;
	}

	const wakeEvent = await wakes.findWakeEventById(
		activeRun.wakeEventId,
		managerSession.organizationId,
	);
	if (!wakeEvent) {
		log.error(
			{ workerRunId: activeRun.id, wakeEventId: activeRun.wakeEventId },
			"Wake event missing for active manager run",
		);
		await failManagerRun(
			managerSession,
			activeRun.id,
			"WAKE_EVENT_MISSING",
			"Wake event not found",
			log,
		);
		return { status: "idle" };
	}

	activeRun = await ensureManagerRunStarted(managerSession, activeRun, log);

	try {
		await workers.appendWorkerRunEvent({
			workerRunId: activeRun.id,
			workerId: managerSession.workerId,
			eventType: "manager_note",
			summaryText: "Manager memory contract active",
			payloadJson: {
				managerMemoryDir: DEFAULT_MANAGER_MEMORY_DIR,
				managerMemoryIndexPath: DEFAULT_MANAGER_MEMORY_INDEX_PATH,
			},
			dedupeKey: `manager-memory:${DEFAULT_MANAGER_MEMORY_DIR}:${DEFAULT_MANAGER_MEMORY_INDEX_PATH}`,
		});
	} catch (error) {
		log.warn({ err: error, workerRunId: activeRun.id }, "Failed to append manager memory event");
	}

	const worker = await workers.findWorkerById(
		managerSession.workerId,
		managerSession.organizationId,
	);
	const deniedCapabilityKeys = await loadDeniedCapabilityKeys(managerSession.id, log);
	const pendingDirectives = await loadPendingDirectives(managerSession.id, log);
	const wakePayloadSourceData = await loadWakePayloadSourceData(
		wakeEvent.payloadJson,
		managerSession.organizationId,
		log,
	);

	return {
		status: "claimed",
		managerSessionId: managerSession.id,
		organizationId: managerSession.organizationId,
		workerId: managerSession.workerId,
		workerRunId: activeRun.id,
		workerRunStatus: activeRun.status,
		managerMemoryDir: DEFAULT_MANAGER_MEMORY_DIR,
		managerMemoryIndexPath: DEFAULT_MANAGER_MEMORY_INDEX_PATH,
		wakeEvent: {
			id: wakeEvent.id,
			status: wakeEvent.status,
			source: wakeEvent.source,
			payloadJson: wakeEvent.payloadJson,
		},
		worker: {
			id: managerSession.workerId,
			name: worker?.name ?? "coworker",
			objective: worker?.objective ?? null,
		},
		deniedCapabilityKeys,
		pendingDirectives,
		wakePayloadSourceData,
	};
}

export async function requireActiveManagerRun(
	managerSession: ManagerControlSession,
	workerRunId: string,
): Promise<WorkerRunRecord> {
	const activeRun = await workers.findActiveRunByWorker(
		managerSession.workerId,
		managerSession.organizationId,
	);
	if (!activeRun) {
		throw new ApiError(409, "No active worker run for this manager session");
	}
	if (activeRun.id !== workerRunId) {
		throw new ApiError(409, "Requested worker run is not active for this manager session");
	}
	return activeRun;
}

export function createManagerToolExecutionContext(params: {
	managerSession: ManagerControlSession;
	activeRun: WorkerRunRecord;
	hubManager: HubManager;
}): ManagerToolContext {
	return {
		managerSessionId: params.managerSession.id,
		organizationId: params.managerSession.organizationId,
		workerId: params.activeRun.workerId,
		workerRunId: params.activeRun.id,
		gatewayUrl: "http://localhost",
		serviceToken: "in-process",
		controlFacade: createInProcessManagerControlFacade({
			getOrCreateHub: (sessionId) => params.hubManager.getOrCreate(sessionId),
		}),
	};
}

async function ensureManagerRunStarted(
	managerSession: ManagerControlSession,
	activeRun: WorkerRunRecord,
	log: Logger,
): Promise<WorkerRunRecord> {
	if (activeRun.status !== "queued") {
		return activeRun;
	}

	try {
		return await workers.startWorkerRun(activeRun.id, managerSession.organizationId);
	} catch (error) {
		if (!(error instanceof workers.WorkerRunTransitionError)) {
			throw error;
		}

		const refreshed = await workers.findActiveRunByWorker(
			managerSession.workerId,
			managerSession.organizationId,
		);
		if (refreshed?.id === activeRun.id) {
			return refreshed;
		}

		log.warn(
			{ err: error, workerRunId: activeRun.id },
			"Manager run start raced with another controller",
		);
		throw error;
	}
}

async function failManagerRun(
	managerSession: ManagerControlSession,
	workerRunId: string,
	errorCode: string,
	errorMessage: string,
	log: Logger,
): Promise<void> {
	try {
		await workers.failWorkerRun({
			workerRunId,
			organizationId: managerSession.organizationId,
			errorCode,
			errorMessage,
		});
	} catch (error) {
		log.error({ err: error, workerRunId }, "Failed to fail manager run");
	}
}

async function loadDeniedCapabilityKeys(sessionId: string, log: Logger): Promise<string[]> {
	try {
		const capabilities = await sessions.listSessionCapabilities(sessionId);
		return capabilities
			.filter((capability) => capability.mode === "deny")
			.map((capability) => capability.capabilityKey);
	} catch (error) {
		log.warn({ err: error, sessionId }, "Failed to load denied manager capabilities");
		return [];
	}
}

async function loadPendingDirectives(
	managerSessionId: string,
	log: Logger,
): Promise<ManagerRunClaimResponse["pendingDirectives"]> {
	try {
		const directives = await workers.listPendingDirectives(managerSessionId);
		return directives.map((directive) => ({
			id: directive.id,
			messageType: directive.messageType,
			payloadJson: directive.payloadJson,
			queuedAt: directive.queuedAt.toISOString(),
			senderUserId: directive.senderUserId,
		}));
	} catch (error) {
		log.warn({ err: error, managerSessionId }, "Failed to load pending directives");
		return [];
	}
}

async function loadWakePayloadSourceData(
	wakePayload: unknown,
	organizationId: string,
	log: Logger,
): Promise<string[]> {
	const payload =
		wakePayload && typeof wakePayload === "object"
			? (wakePayload as Record<string, unknown>)
			: null;
	const sourceRefs = Array.isArray(payload?.sourceRefs)
		? (payload.sourceRefs as Array<Record<string, unknown>>)
		: [];
	if (sourceRefs.length === 0) {
		return [];
	}

	log.debug({ refCount: sourceRefs.length }, "Enriching claimed manager wake payload");
	const parts: string[] = [];

	for (const sourceRef of sourceRefs.slice(0, 10)) {
		const bindingId =
			typeof sourceRef.bindingId === "string" && sourceRef.bindingId.length > 0
				? sourceRef.bindingId
				: null;
		const itemRef =
			typeof sourceRef.itemRef === "string" && sourceRef.itemRef.length > 0
				? sourceRef.itemRef
				: null;
		const sourceType =
			typeof sourceRef.sourceType === "string" && sourceRef.sourceType.length > 0
				? sourceRef.sourceType
				: "unknown";

		if (!bindingId || !itemRef) {
			continue;
		}

		try {
			const item = await sourceReads.getSourceItem(bindingId, organizationId, itemRef);
			if (!item) {
				continue;
			}

			parts.push(
				`### [${item.sourceType}] ${item.title}`,
				`- Status: ${item.status ?? "unknown"}`,
				`- Severity: ${item.severity ?? "none"}`,
				`- URL: ${item.url ?? "N/A"}`,
			);
			if (item.body) {
				const truncated = item.body.length > 500 ? `${item.body.slice(0, 500)}...` : item.body;
				parts.push(`- Description: ${truncated}`);
			}
			parts.push("");
		} catch (error) {
			log.warn({ err: error, bindingId, itemRef }, "Failed to enrich claimed source ref");
			parts.push(`### Source ref (fetch failed): ${sourceType}`);
		}
	}

	return parts;
}
