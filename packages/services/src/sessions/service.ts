/**
 * Sessions service.
 *
 * Business logic that orchestrates DB operations.
 * Note: Pause, snapshot, and submit-env operations are in dedicated files
 * in this directory (pause.ts, snapshot.ts, submit-env.ts).
 */

import { randomUUID } from "crypto";
import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import type { AgentConfig, SandboxProviderType } from "@proliferate/shared";
import { getDefaultAgentConfig, isValidModelId, parseModelId } from "@proliferate/shared";
import type { Session } from "@proliferate/shared/contracts/sessions";
import {
	type SessionRuntimeStatus,
	isTerminalSessionRuntimeStatus,
} from "@proliferate/shared/contracts/sessions";
import { getSandboxProvider } from "@proliferate/shared/providers";
import { getBlockedReasonText, sanitizePromptSnippet } from "@proliferate/shared/sessions";
import * as billing from "../billing";
import * as configurations from "../configurations";
import { toIsoString } from "../db/serialize";
import { getServicesLogger } from "../logger";
import type {
	CreateSetupSessionInput,
	CreateSessionInput as DbCreateSessionInput,
	ListSessionsOptions,
	SessionStatus,
	UpdateSessionInput,
} from "../types/sessions";
import type { SessionRow } from "./db";
import * as sessionsDb from "./db";
import { createSessionEvent } from "./db";
import {
	ConfigurationNoReposError,
	ConfigurationNotFoundError,
	ConfigurationRepoUnauthorizedError,
	SessionAccessDeniedError,
	SessionKindError,
	SessionLimitError,
	SessionNotFoundError,
	SessionRuntimeStatusError,
	TaskSessionValidationError,
} from "./errors";
import { requestTitleGeneration } from "./generate-title";
import { toCanonicalStatus, toSession, toSessions } from "./mapper";

// Re-export all session errors so existing consumers of this module keep working.
export {
	ConfigurationNoReposError,
	ConfigurationNotFoundError,
	ConfigurationRepoUnauthorizedError,
	SessionAccessDeniedError,
	SessionKindError,
	SessionLimitError,
	SessionNotFoundError,
	SessionRuntimeStatusError,
	TaskSessionValidationError,
} from "./errors";

// ============================================
// Service functions
// ============================================

/**
 * List all sessions for an organization.
 */
export async function listSessions(
	orgId: string,
	options?: ListSessionsOptions,
): Promise<Session[]> {
	const rows = await sessionsDb.listByOrganization(orgId, {
		repoId: options?.repoId,
		status: options?.status,
		kinds: options?.kinds,
		limit: options?.limit,
		excludeSetup: options?.excludeSetup,
		excludeAutomation: options?.excludeAutomation,
		createdBy: options?.createdBy,
		userId: options?.userId,
		includeArchived: options?.includeArchived,
	});
	return toSessions(rows);
}

/**
 * List all sessions for an organization with enrichment data (unread, worker name, pending approvals).
 */
export async function listSessionsEnriched(
	orgId: string,
	userId: string,
	options?: ListSessionsOptions,
): Promise<Session[]> {
	const rows = await sessionsDb.listByOrganizationEnriched(orgId, userId, {
		repoId: options?.repoId,
		status: options?.status,
		kinds: options?.kinds,
		limit: options?.limit,
		excludeSetup: options?.excludeSetup,
		excludeAutomation: options?.excludeAutomation,
		createdBy: options?.createdBy,
	});
	return rows.map((row) => toSession(row));
}

/**
 * Get a single session by ID.
 */
export async function getSession(id: string, orgId: string): Promise<Session | null> {
	const row = await sessionsDb.findById(id, orgId);
	if (!row) return null;
	return toSession(row, { includeInitialPrompt: true });
}

/**
 * Get session status (no org check - used for public status endpoint).
 */
export async function getSessionStatus(id: string): Promise<SessionStatus | null> {
	const row = await sessionsDb.findByIdNoOrg(id);
	if (!row) return null;
	return toCanonicalStatus(row);
}

/**
 * Rename a session.
 */
export async function renameSession(
	id: string,
	orgId: string,
	title: string,
): Promise<Session | null> {
	// First verify it exists
	const session = await sessionsDb.findById(id, orgId);
	if (!session) return null;

	// Update the title
	await sessionsDb.updateWithOrgCheck(id, orgId, { title });

	// Return updated session
	return toSession({ ...session, title });
}

/**
 * Delete a session.
 */
export async function deleteSession(id: string, orgId: string): Promise<boolean> {
	await sessionsDb.deleteById(id, orgId);
	return true;
}

/**
 * Check if a session exists and belongs to the organization.
 */
export async function sessionExists(id: string, orgId: string): Promise<boolean> {
	const session = await sessionsDb.findById(id, orgId);
	return session !== null;
}

/**
 * Get full session data for internal operations (pause/resume).
 * Returns the raw DB row for use with sandbox providers.
 */
export async function getFullSession(id: string, orgId: string): Promise<SessionRow | null> {
	return sessionsDb.findFullById(id, orgId);
}

/**
 * Update session status and sandbox info.
 */
export async function updateSession(id: string, updates: UpdateSessionInput): Promise<void> {
	await sessionsDb.update(id, updates);
}

/**
 * Update session with org check.
 */
export async function updateSessionWithOrgCheck(
	id: string,
	orgId: string,
	updates: UpdateSessionInput,
): Promise<void> {
	await sessionsDb.updateWithOrgCheck(id, orgId, updates);
}

/**
 * Find a session row by ID without org scoping.
 * Used by gateway/worker internal flows that already enforce auth context.
 */
export async function findSessionByIdInternal(id: string): Promise<SessionRow | null> {
	return sessionsDb.findByIdInternal(id);
}

export async function findSessionById(
	sessionId: string,
	organizationId: string,
): Promise<SessionRow | undefined> {
	return sessionsDb.findSessionById(sessionId, organizationId);
}

export async function listChildSessionsByRun(
	parentSessionId: string,
	workerRunId: string,
	organizationId: string,
): Promise<SessionRow[]> {
	return sessionsDb.listChildSessionsByRun(parentSessionId, workerRunId, organizationId);
}

export async function listAllChildSessions(
	parentSessionId: string,
	organizationId: string,
): Promise<SessionRow[]> {
	return sessionsDb.listAllChildSessions(parentSessionId, organizationId);
}

/**
 * Create a raw session row record.
 * Thin service boundary wrapper for callers outside the sessions module.
 */
export async function createSessionRecord(input: DbCreateSessionInput): Promise<SessionRow> {
	return sessionsDb.create(input);
}

/**
 * Atomic admission-guarded session create.
 */
export async function createSessionWithAdmissionGuard(
	input: DbCreateSessionInput,
	maxConcurrent: number,
): Promise<{ created: boolean }> {
	return sessionsDb.createWithAdmissionGuard(input, maxConcurrent);
}

/**
 * Create setup-session record with admission guard counterpart.
 */
export async function createSetupSessionRecord(input: CreateSetupSessionInput): Promise<void> {
	await sessionsDb.createSetupSession(input);
}

export async function createSetupSessionWithAdmissionGuard(
	input: CreateSetupSessionInput,
	maxConcurrent: number,
): Promise<{ created: boolean }> {
	return sessionsDb.createSetupSessionWithAdmissionGuard(input, maxConcurrent);
}

/**
 * Create/list session integration connections.
 */
export async function createSessionConnections(
	sessionId: string,
	integrationIds: string[],
): Promise<void> {
	await sessionsDb.createSessionConnections(sessionId, integrationIds);
}

export async function listSessionConnections(sessionId: string) {
	return sessionsDb.listSessionConnections(sessionId);
}

/**
 * CAS/fencing update constrained by expected sandbox ID.
 */
export async function updateSessionWhereSandboxIdMatches(
	id: string,
	expectedSandboxId: string,
	updates: UpdateSessionInput,
): Promise<number> {
	return sessionsDb.updateWhereSandboxIdMatches(id, expectedSandboxId, updates);
}

/**
 * Telemetry + lifecycle passthrough wrappers.
 */
export async function flushSessionTelemetry(
	sessionId: string,
	delta: { toolCalls: number; messagesExchanged: number; activeSeconds: number },
	newPrUrls: string[],
	latestTask: string | null,
): Promise<void> {
	await sessionsDb.flushTelemetry(sessionId, delta, newPrUrls, latestTask);
}

export async function markSessionStopped(sessionId: string): Promise<void> {
	await sessionsDb.markStopped(sessionId);
}

export async function listRunningSessionIds(): Promise<string[]> {
	return sessionsDb.listRunningSessionIds();
}

export async function listSessionCapabilities(sessionId: string) {
	return sessionsDb.listSessionCapabilities(sessionId);
}

export async function getSessionClientInfo(sessionId: string) {
	return sessionsDb.getSessionClientInfo(sessionId);
}

export async function findSessionBySlackThread(
	installationId: string,
	channelId: string,
	threadTs: string,
) {
	return sessionsDb.findBySlackThread(installationId, channelId, threadTs);
}

export async function updateSessionConfigurationId(
	sessionId: string,
	configurationId: string,
): Promise<void> {
	await sessionsDb.updateConfigurationId(sessionId, configurationId);
}

export async function updateLastVisibleUpdateAt(sessionId: string): Promise<void> {
	await sessionsDb.updateLastVisibleUpdateAt(sessionId);
}

/**
 * Count running sessions for an organization.
 */
export async function countRunningByOrganization(orgId: string): Promise<number> {
	return sessionsDb.countRunningByOrganization(orgId);
}

export async function countNullPauseReasonSessions(): Promise<number> {
	return sessionsDb.countNullPauseReasonSessions();
}

/**
 * Get session counts by status for an organization.
 */
export async function getSessionCountsByOrganization(
	orgId: string,
): Promise<{ running: number; paused: number }> {
	return sessionsDb.getSessionCountsByOrganization(orgId);
}

// ============================================
// Blocked Summary (Inbox)
// ============================================

export interface BlockedSummaryPreviewSession {
	id: string;
	title: string | null;
	promptSnippet: string | null;
	startedAt: string | null;
	pausedAt: string | null;
}

export interface BlockedSummaryGroup {
	reason: string;
	count: number;
	previewSessions: BlockedSummaryPreviewSession[];
}

export interface BlockedSummary {
	groups: BlockedSummaryGroup[];
}

/**
 * Get billing-blocked sessions grouped by reason for inbox display.
 */
export async function getBlockedSummary(orgId: string): Promise<BlockedSummary> {
	const rows = await sessionsDb.getBlockedSummary(orgId);
	return {
		groups: rows.map((row) => ({
			reason:
				getBlockedReasonText(row.reason, row.reason === "suspended" ? "suspended" : "paused") ??
				row.reason,
			count: row.count,
			previewSessions: row.previewSessions.map((s) => ({
				id: s.id,
				title: s.title,
				promptSnippet: sanitizePromptSnippet(s.initialPrompt),
				startedAt: toIsoString(s.startedAt),
				pausedAt: toIsoString(s.pausedAt),
			})),
		})),
	};
}

// ============================================
// Session Creation
// ============================================

const logger = getServicesLogger().child({ module: "sessions" });

export interface CreateSessionInput {
	configurationId?: string;
	sessionType?: "setup" | "coding";
	modelId?: string;
	reasoningEffort?: "quick" | "normal" | "deep";
	initialPrompt?: string;
	orgId: string;
	userId: string;
	/** Override for gateway URL. Defaults to env.NEXT_PUBLIC_GATEWAY_URL. */
	gatewayUrl?: string;
	/** Override for service-to-service token. Defaults to env.SERVICE_TO_SERVICE_AUTH_TOKEN. */
	serviceToken?: string;
	continuedFromSessionId?: string;
	rerunOfSessionId?: string;
}

export interface CreateSessionResult {
	sessionId: string;
	doUrl: string;
	tunnelUrl: string | null;
	previewUrl: string | null;
	sandboxId: string | null;
	warning: string | null;
}

/**
 * Create a new session.
 *
 * Handles both scratch (no configuration) and configuration-backed sessions.
 * Checks billing gates, creates the session record, enqueues title generation,
 * and triggers eager start via the gateway.
 *
 * @throws SessionLimitError if concurrent session limit is reached
 * @throws ConfigurationNotFoundError if the configurationId doesn't resolve
 * @throws ConfigurationNoReposError if the configuration has no repos
 * @throws ConfigurationRepoUnauthorizedError if repos don't belong to the org
 */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const {
		configurationId,
		sessionType = "coding",
		modelId: requestedModelId,
		reasoningEffort,
		initialPrompt,
		orgId,
		userId,
		gatewayUrl = env.NEXT_PUBLIC_GATEWAY_URL ?? "",
		serviceToken = env.SERVICE_TO_SERVICE_AUTH_TOKEN ?? "",
		continuedFromSessionId,
		rerunOfSessionId,
	} = input;

	// Check billing/credits before creating session
	await billing.assertBillingGateForOrg(orgId, "session_start");

	// Build agent config from request or defaults
	const agentConfig: AgentConfig = {
		agentType: "opencode",
		modelId:
			requestedModelId && isValidModelId(requestedModelId)
				? requestedModelId
				: requestedModelId
					? parseModelId(requestedModelId)
					: getDefaultAgentConfig().modelId,
		reasoningEffort: reasoningEffort && reasoningEffort !== "normal" ? reasoningEffort : undefined,
	};

	// Scratch path: no configuration, just boot from base snapshot
	if (!configurationId) {
		return createScratchSession({
			sessionType,
			agentConfig,
			initialPrompt,
			orgId,
			userId,
			gatewayUrl,
			serviceToken,
			continuedFromSessionId,
			rerunOfSessionId,
		});
	}

	logger.debug(
		{
			configurationId,
			sessionType,
			agentConfig,
			initialPrompt,
			orgId,
			userId,
			gatewayUrl,
			hasServiceToken: Boolean(serviceToken),
			continuedFromSessionId,
			rerunOfSessionId,
		},
		"Creating configuration-backed session",
	);
	// Configuration-backed path: existing flow
	return createConfigurationSession({
		configurationId,
		sessionType,
		agentConfig,
		initialPrompt,
		orgId,
		userId,
		gatewayUrl,
		serviceToken,
		continuedFromSessionId,
		rerunOfSessionId,
	});
}

async function createScratchSession(input: {
	sessionType: string;
	agentConfig: AgentConfig;
	initialPrompt?: string;
	orgId: string;
	userId: string;
	gatewayUrl: string;
	serviceToken: string;
	continuedFromSessionId?: string;
	rerunOfSessionId?: string;
}): Promise<CreateSessionResult> {
	const {
		sessionType,
		agentConfig,
		initialPrompt,
		orgId,
		userId,
		gatewayUrl,
		serviceToken,
		continuedFromSessionId,
		rerunOfSessionId,
	} = input;

	const provider = getSandboxProvider();
	const sessionId = randomUUID();
	const reqLog = logger.child({ sessionId });
	const doUrl = `${gatewayUrl}/session/${sessionId}`;
	reqLog.info({ sessionType }, "Creating scratch session");

	// K2: Scratch sessions have no repo/worker linkage — kind=null (ad-hoc)
	await createSessionWithAdmission(orgId, {
		id: sessionId,
		configurationId: null,
		organizationId: orgId,
		createdBy: userId,
		sessionType,
		status: "starting",
		sandboxProvider: provider.type,
		snapshotId: null,
		initialPrompt,
		kind: null,
		visibility: "private",
		...(initialPrompt ? { titleStatus: "generating" } : {}),
		agentConfig: {
			modelId: agentConfig.modelId,
			...(agentConfig.reasoningEffort && { reasoningEffort: agentConfig.reasoningEffort }),
		},
		continuedFromSessionId: continuedFromSessionId ?? null,
		rerunOfSessionId: rerunOfSessionId ?? null,
	});

	reqLog.info("Scratch session record created");

	// K5: Record session_created lifecycle event (best-effort)
	createSessionEvent({ sessionId, eventType: "session_created" }).catch((err) => {
		reqLog.warn({ err }, "Failed to record session_created event");
	});

	// Enqueue async title generation (fire-and-forget)
	if (initialPrompt) {
		void requestTitleGeneration(sessionId, orgId, initialPrompt);
		triggerEagerStart(sessionId, gatewayUrl, serviceToken);
	}

	return {
		sessionId,
		doUrl,
		tunnelUrl: null,
		previewUrl: null,
		sandboxId: null,
		warning: null,
	};
}

async function createConfigurationSession(input: {
	configurationId: string;
	sessionType: string;
	agentConfig: AgentConfig;
	initialPrompt?: string;
	orgId: string;
	userId: string;
	gatewayUrl: string;
	serviceToken: string;
	continuedFromSessionId?: string;
	rerunOfSessionId?: string;
}): Promise<CreateSessionResult> {
	const {
		configurationId,
		sessionType,
		agentConfig,
		initialPrompt,
		orgId,
		userId,
		gatewayUrl,
		serviceToken,
		continuedFromSessionId,
		rerunOfSessionId,
	} = input;

	// Get configuration by ID
	const configuration = await configurations.findByIdForSession(configurationId);
	if (!configuration) {
		throw new ConfigurationNotFoundError();
	}

	const configurationProvider = configuration.sandboxProvider;

	// Get repos from configuration_repos junction table
	const configurationRepos = await configurations.getConfigurationReposWithDetails(configurationId);

	if (configurationRepos.length === 0) {
		throw new ConfigurationNoReposError();
	}

	for (const pr of configurationRepos) {
		if (!pr.repo) {
			throw new ConfigurationNoReposError();
		}
		if (pr.repo.organizationId !== orgId) {
			throw new ConfigurationRepoUnauthorizedError();
		}
	}

	// Resolve provider and snapshot layering
	const providerType = configurationProvider as SandboxProviderType | undefined;
	const provider = getSandboxProvider(providerType);

	const snapshotId = configuration.snapshotId ?? null;

	// Generate IDs
	const sessionId = randomUUID();
	const reqLog = logger.child({ sessionId });
	const doUrl = `${gatewayUrl}/session/${sessionId}`;
	reqLog.info("Session creation started");

	// K2: Visibility defaults by kind/origin — setup sessions are org-visible, ad-hoc tasks are private
	const visibility: "private" | "org" = sessionType === "setup" ? "org" : "private";
	const kind: "task" | "setup" = sessionType === "setup" ? "setup" : "task";

	// Resolve primary repo from configuration
	const primaryRepoId = configurationRepos[0]?.repo?.id ?? null;

	// Create session record and return immediately.
	// Sandbox provisioning is handled by the gateway when the client connects.
	await createSessionWithAdmission(orgId, {
		id: sessionId,
		configurationId,
		organizationId: orgId,
		repoId: primaryRepoId,
		createdBy: userId,
		sessionType,
		status: "starting",
		sandboxProvider: provider.type,
		snapshotId,
		initialPrompt,
		visibility,
		kind,
		...(initialPrompt ? { titleStatus: "generating" } : {}),
		agentConfig: {
			modelId: agentConfig.modelId,
			...(agentConfig.reasoningEffort && { reasoningEffort: agentConfig.reasoningEffort }),
		},
		continuedFromSessionId: continuedFromSessionId ?? null,
		rerunOfSessionId: rerunOfSessionId ?? null,
	});

	reqLog.info("Session record created, returning immediately");

	createSessionEvent({ sessionId, eventType: "session_created" }).catch((err) => {
		reqLog.warn({ err }, "Failed to record session_created event");
	});

	// Enqueue async title generation (fire-and-forget)
	if (initialPrompt) {
		void requestTitleGeneration(sessionId, orgId, initialPrompt);
		triggerEagerStart(sessionId, gatewayUrl, serviceToken);
	}

	return {
		sessionId,
		doUrl,
		tunnelUrl: null,
		previewUrl: null,
		sandboxId: null,
		warning: null,
	};
}

/**
 * Trigger eager session start via the gateway (fire-and-forget).
 * Boots the sandbox and sends the initial prompt in the background.
 */
function triggerEagerStart(sessionId: string, gatewayUrl: string, serviceToken: string): void {
	if (!gatewayUrl || !serviceToken) {
		logger.warn({ sessionId }, "Skipping eager start: missing gatewayUrl or serviceToken");
		return;
	}

	const gateway = createSyncClient({
		baseUrl: gatewayUrl,
		auth: {
			type: "service",
			name: "web-session-create",
			secret: serviceToken,
		},
	});

	gateway.eagerStart(sessionId).catch((err: unknown) => {
		logger.warn({ err, sessionId }, "Eager start request failed (session will start on connect)");
	});
}

/**
 * Create a session with atomic concurrent admission guard when billing is enabled.
 * Falls back to plain insert when billing is disabled.
 *
 * @throws SessionLimitError if concurrent session limit is reached
 */
async function createSessionWithAdmission(
	orgId: string,
	input: DbCreateSessionInput,
): Promise<void> {
	const planLimits = await billing.getOrgPlanLimits(orgId);
	if (planLimits) {
		const { created } = await sessionsDb.createWithAdmissionGuard(
			input,
			planLimits.maxConcurrentSessions,
		);
		if (!created) {
			throw new SessionLimitError(planLimits.maxConcurrentSessions);
		}
	} else {
		await sessionsDb.create(input);
	}
}

// ============================================
// Task session creation
// ============================================

export interface CreateUnifiedTaskSessionInput extends sessionsDb.CreateTaskSessionInput {}

export async function createUnifiedTaskSession(
	input: CreateUnifiedTaskSessionInput,
): Promise<sessionsDb.SessionRow> {
	// Configured task sessions require full repo linkage for baseline diffing,
	// UNLESS they're spawned by a manager (parentSessionId set) — those only
	// need configurationId for snapshot/repo resolution, not baseline tracking.
	if (
		input.configurationId &&
		!input.parentSessionId &&
		(!input.repoId || !input.repoBaselineId || !input.repoBaselineTargetId)
	) {
		throw new TaskSessionValidationError(
			"Configured task session requires repo + baseline + baseline target linkage",
		);
	}

	return sessionsDb.createTaskSession({
		id: input.id ?? randomUUID(),
		organizationId: input.organizationId,
		createdBy: input.createdBy,
		repoId: input.repoId,
		repoBaselineId: input.repoBaselineId,
		repoBaselineTargetId: input.repoBaselineTargetId,
		workerId: input.workerId ?? null,
		workerRunId: input.workerRunId ?? null,
		parentSessionId: input.parentSessionId ?? null,
		continuedFromSessionId: input.continuedFromSessionId ?? null,
		rerunOfSessionId: input.rerunOfSessionId ?? null,
		configurationId: input.configurationId ?? null,
		visibility: input.visibility ?? "private",
		initialPrompt: input.initialPrompt ?? null,
		title: input.title ?? null,
		sandboxProvider: input.sandboxProvider,
	});
}

// ============================================
// Task follow-up routing
// ============================================

export interface SendTaskFollowupInput {
	sessionId: string;
	organizationId: string;
	userId: string;
	messageType: string;
	payloadJson: unknown;
	dedupeKey?: string;
	deliverAfter?: Date;
	terminalMode?: "continuation" | "rerun";
}

export interface SendTaskFollowupResult {
	deliverySessionId: string;
	mode: "same_session" | "continuation" | "rerun";
	sessionMessage: sessionsDb.SessionMessageRow;
}

/**
 * Follow-up contract:
 * - Live task session => follow-up stays in the same task session.
 * - Terminal task session => create ad-hoc continuation by default (`workerId=null`, `workerRunId=null`).
 * - Rerun mode is opt-in (`terminalMode="rerun"`).
 */
export async function sendTaskFollowup(
	input: SendTaskFollowupInput,
): Promise<SendTaskFollowupResult> {
	const source = await sessionsDb.findSessionById(input.sessionId, input.organizationId);
	if (!source) {
		throw new SessionNotFoundError(input.sessionId);
	}
	if (source.kind !== "task") {
		throw new SessionKindError("task", source.kind);
	}

	const runtimeStatus = (source.runtimeStatus ?? "starting") as SessionRuntimeStatus;
	if (!isTerminalSessionRuntimeStatus(runtimeStatus)) {
		const sameSessionMessage = await sessionsDb.enqueueSessionMessage({
			sessionId: source.id,
			direction: "user_to_task",
			messageType: input.messageType,
			payloadJson: input.payloadJson,
			dedupeKey: input.dedupeKey,
			deliverAfter: input.deliverAfter,
			senderUserId: input.userId,
		});

		return {
			deliverySessionId: source.id,
			mode: "same_session",
			sessionMessage: sameSessionMessage,
		};
	}

	if (!source.repoId || !source.repoBaselineId || !source.repoBaselineTargetId) {
		throw new SessionRuntimeStatusError(
			"Terminal task follow-up requires repo + baseline linkage on the source session",
		);
	}

	const mode: SendTaskFollowupResult["mode"] =
		input.terminalMode === "rerun" ? "rerun" : "continuation";
	if (input.dedupeKey) {
		const existing = await sessionsDb.findTerminalFollowupMessageByDedupe({
			organizationId: input.organizationId,
			sourceSessionId: source.id,
			dedupeKey: input.dedupeKey,
			mode,
		});
		if (existing) {
			return {
				deliverySessionId: existing.deliverySessionId,
				mode,
				sessionMessage: existing.sessionMessage,
			};
		}

		const existingFollowupSession = await sessionsDb.findLatestTerminalFollowupSession({
			organizationId: input.organizationId,
			sourceSessionId: source.id,
			mode,
		});
		if (existingFollowupSession) {
			const existingFollowupMessage = await sessionsDb.enqueueSessionMessage({
				sessionId: existingFollowupSession.id,
				direction: "user_to_task",
				messageType: input.messageType,
				payloadJson: input.payloadJson,
				dedupeKey: input.dedupeKey,
				deliverAfter: input.deliverAfter,
				senderUserId: input.userId,
			});
			return {
				deliverySessionId: existingFollowupSession.id,
				mode,
				sessionMessage: existingFollowupMessage,
			};
		}
	}

	const nextTask = await createUnifiedTaskSession({
		organizationId: input.organizationId,
		createdBy: input.userId,
		repoId: source.repoId,
		repoBaselineId: source.repoBaselineId,
		repoBaselineTargetId: source.repoBaselineTargetId,
		visibility: (source.visibility as "private" | "shared" | "org") ?? "private",
		continuedFromSessionId: mode === "continuation" ? source.id : null,
		rerunOfSessionId: mode === "rerun" ? source.id : null,
		workerId: null,
		workerRunId: null,
		initialPrompt: null,
	});

	const nextSessionMessage = await sessionsDb.enqueueSessionMessage({
		sessionId: nextTask.id,
		direction: "user_to_task",
		messageType: input.messageType,
		payloadJson: input.payloadJson,
		dedupeKey: input.dedupeKey,
		deliverAfter: input.deliverAfter,
		senderUserId: input.userId,
	});

	return {
		deliverySessionId: nextTask.id,
		mode,
		sessionMessage: nextSessionMessage,
	};
}

export async function claimQueuedSessionMessagesForDelivery(
	sessionId: string,
	limit = 50,
): Promise<sessionsDb.SessionMessageRow[]> {
	return sessionsDb.claimDeliverableSessionMessages(sessionId, limit);
}

export async function markSessionMessageConsumed(
	sessionMessageId: string,
): Promise<sessionsDb.SessionMessageRow | undefined> {
	return sessionsDb.transitionSessionMessageDeliveryState({
		id: sessionMessageId,
		fromStates: ["delivered"],
		toState: "consumed",
		fields: {
			consumedAt: new Date(),
		},
	});
}

export async function markSessionMessageFailed(input: {
	sessionMessageId: string;
	failureReason: string;
}): Promise<sessionsDb.SessionMessageRow | undefined> {
	return sessionsDb.transitionSessionMessageDeliveryState({
		id: input.sessionMessageId,
		fromStates: ["queued", "delivered"],
		toState: "failed",
		fields: {
			failedAt: new Date(),
			failureReason: input.failureReason,
		},
	});
}

export async function persistTerminalTaskOutcome(input: {
	sessionId: string;
	organizationId: string;
	outcomeJson: unknown;
	outcomeVersion?: number;
}): Promise<{
	outcomeJson: unknown;
	outcomeVersion: number | null;
	outcomePersistedAt: Date | null;
}> {
	const session = await sessionsDb.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	if (session.kind !== "task") {
		throw new SessionKindError("task", session.kind);
	}
	if (!isTerminalSessionRuntimeStatus(session.runtimeStatus as SessionRuntimeStatus)) {
		throw new SessionRuntimeStatusError(
			`Session ${input.sessionId} is not terminal (runtimeStatus=${session.runtimeStatus})`,
		);
	}

	const outcome = await sessionsDb.persistSessionOutcome({
		sessionId: input.sessionId,
		outcomeJson: input.outcomeJson,
		outcomeVersion: input.outcomeVersion,
	});
	return {
		outcomeJson: outcome.outcomeJson,
		outcomeVersion: outcome.outcomeVersion ?? null,
		outcomePersistedAt: outcome.outcomePersistedAt ?? null,
	};
}

// ============================================
// K2: Session access check
// ============================================

/**
 * Check if a user can access a session based on visibility + ACL.
 * - Creator always has access.
 * - org visibility: all org members can view.
 * - shared visibility: explicit ACL only.
 * - private visibility: creator + explicit ACL only.
 *
 * Returns the user's effective role or null if no access.
 */
export async function getSessionAccessRole(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
}): Promise<string | null> {
	const session = await sessionsDb.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		return null;
	}

	if (session.createdBy === input.userId) {
		return "owner";
	}

	const aclRole = await sessionsDb.getSessionAclRole(input.sessionId, input.userId);
	if (aclRole) {
		return aclRole;
	}

	if (session.visibility === "org") {
		return "viewer";
	}

	return null;
}

/**
 * Assert that a user can access a session. Throws if denied.
 */
export async function assertSessionAccess(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
	requiredRole?: string;
}): Promise<string> {
	const role = await getSessionAccessRole({
		sessionId: input.sessionId,
		organizationId: input.organizationId,
		userId: input.userId,
	});
	if (!role) {
		throw new SessionAccessDeniedError(input.sessionId);
	}
	if (input.requiredRole) {
		const roleHierarchy: Record<string, number> = {
			viewer: 1,
			editor: 2,
			reviewer: 3,
			owner: 4,
		};
		if ((roleHierarchy[role] ?? 0) < (roleHierarchy[input.requiredRole] ?? 0)) {
			throw new SessionAccessDeniedError(input.sessionId);
		}
	}
	return role;
}

/**
 * Grant a user access to a session with a specific role.
 * Session creator always has owner access (not stored in ACL).
 */
export async function grantSessionAccess(input: {
	sessionId: string;
	organizationId: string;
	targetUserId: string;
	role: string;
	grantedBy: string;
}): Promise<void> {
	const session = await sessionsDb.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	await sessionsDb.grantSessionAcl({
		sessionId: input.sessionId,
		userId: input.targetUserId,
		role: input.role,
		grantedBy: input.grantedBy,
	});
	if (session.visibility === "private") {
		await sessionsDb.updateSessionVisibility(input.sessionId, "shared");
	}
}

// ============================================
// K3: Mark session viewed
// ============================================

export async function markSessionViewed(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	await sessionsDb.upsertSessionUserState({
		sessionId: input.sessionId,
		userId: input.userId,
		lastViewedAt: new Date(),
	});
}

// ============================================
// K4: Operator status projection
// ============================================

export async function updateSessionOperatorStatus(input: {
	sessionId: string;
	organizationId: string;
	operatorStatus: string;
}): Promise<void> {
	await sessionsDb.updateOperatorStatus(input.sessionId, input.operatorStatus);
}

// ============================================
// K5: Session lifecycle events
// ============================================

export async function recordSessionEvent(input: {
	sessionId: string;
	eventType: string;
	actorUserId?: string | null;
	payloadJson?: unknown;
}): Promise<void> {
	await sessionsDb.createSessionEvent({
		sessionId: input.sessionId,
		eventType: input.eventType,
		actorUserId: input.actorUserId,
		payloadJson: input.payloadJson,
	});
}

export async function getSessionEvents(sessionId: string) {
	return sessionsDb.listSessionEvents(sessionId);
}

export interface SessionLifecycleEvent {
	id: string;
	eventType: string;
	actorUserId: string | null;
	createdAt: Date;
}

export async function getSessionEventsForOrg(
	sessionId: string,
	orgId: string,
): Promise<SessionLifecycleEvent[]> {
	const session = await getSession(sessionId, orgId);
	if (!session) {
		throw new SessionNotFoundError(sessionId);
	}
	const events = await getSessionEvents(sessionId);
	return events.map((event) => ({
		id: event.id,
		eventType: event.eventType,
		actorUserId: event.actorUserId,
		createdAt: event.createdAt,
	}));
}

// ============================================
// K6: Archive and delete
// ============================================

export async function archiveSession(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
}): Promise<void> {
	const session = await sessionsDb.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	await sessionsDb.archiveSession(input.sessionId, input.userId);
}

export async function unarchiveSession(input: {
	sessionId: string;
	organizationId: string;
}): Promise<void> {
	const session = await sessionsDb.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	await sessionsDb.unarchiveSession(input.sessionId);
}

export async function softDeleteSession(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
}): Promise<void> {
	const session = await sessionsDb.findSessionById(input.sessionId, input.organizationId);
	if (!session) {
		throw new SessionNotFoundError(input.sessionId);
	}
	await sessionsDb.softDeleteSession(input.sessionId, input.userId);
}

export async function archiveSessionForUser(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	await sessionsDb.archiveSessionForUser(input);
}

export async function unarchiveSessionForUser(input: {
	sessionId: string;
	userId: string;
}): Promise<void> {
	await sessionsDb.unarchiveSessionForUser(input);
}

// ============================================
// K7: Follow-up — send back to coworker
// ============================================

export async function sendBackToCoworker(input: {
	sessionId: string;
	organizationId: string;
	userId: string;
	workerId: string;
	workerRunId: string;
	messageType: string;
	payloadJson: unknown;
	dedupeKey?: string;
}): Promise<SendTaskFollowupResult> {
	const source = await sessionsDb.findSessionById(input.sessionId, input.organizationId);
	if (!source) {
		throw new SessionNotFoundError(input.sessionId);
	}
	if (source.kind !== "task") {
		throw new SessionKindError("task", source.kind);
	}
	if (
		!isTerminalSessionRuntimeStatus((source.runtimeStatus ?? "starting") as SessionRuntimeStatus)
	) {
		throw new SessionRuntimeStatusError(
			`Session ${input.sessionId} is not terminal — cannot send back to coworker`,
		);
	}
	if (!source.repoId || !source.repoBaselineId || !source.repoBaselineTargetId) {
		throw new SessionRuntimeStatusError(
			"Send-back-to-coworker requires repo + baseline linkage on the source session",
		);
	}

	const nextTask = await createUnifiedTaskSession({
		organizationId: input.organizationId,
		createdBy: input.userId,
		repoId: source.repoId,
		repoBaselineId: source.repoBaselineId,
		repoBaselineTargetId: source.repoBaselineTargetId,
		visibility: (source.visibility as "private" | "shared" | "org") ?? "private",
		continuedFromSessionId: source.id,
		workerId: input.workerId,
		workerRunId: input.workerRunId,
	});

	const nextSessionMessage = await sessionsDb.enqueueSessionMessage({
		sessionId: nextTask.id,
		direction: "user_to_task",
		messageType: input.messageType,
		payloadJson: input.payloadJson,
		dedupeKey: input.dedupeKey,
		senderUserId: input.userId,
	});

	return {
		deliverySessionId: nextTask.id,
		mode: "continuation",
		sessionMessage: nextSessionMessage,
	};
}
