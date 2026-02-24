/**
 * Sessions service.
 *
 * Business logic that orchestrates DB operations.
 * Note: Pause and resume operations remain in the API routes
 * due to sandbox provider state management.
 */

import { randomUUID } from "crypto";
import { createSyncClient } from "@proliferate/gateway-clients";
import type { AgentConfig, Session, SandboxProviderType } from "@proliferate/shared";
import { getDefaultAgentConfig, isValidModelId, parseModelId } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import { getBlockedReasonText, sanitizePromptSnippet } from "@proliferate/shared/sessions";
import * as billing from "../billing";
import * as configurations from "../configurations";
import { toIsoString } from "../db/serialize";
import { getServicesLogger } from "../logger";
import type { CreateSessionInput as DbCreateSessionInput, ListSessionsOptions, SessionStatus, UpdateSessionInput } from "../types/sessions";
import type { SessionRow } from "./db";
import * as sessionsDb from "./db";
import { requestTitleGeneration } from "./generate-title";
import { toSession, toSessions } from "./mapper";

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
		limit: options?.limit,
		excludeSetup: options?.excludeSetup,
		excludeCli: options?.excludeCli,
		excludeAutomation: options?.excludeAutomation,
		createdBy: options?.createdBy,
	});
	return toSessions(rows);
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

	const status = row.status ?? "unknown";
	return {
		status,
		isComplete: status === "stopped",
	};
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
 * Count running sessions for an organization.
 */
export async function countRunningByOrganization(orgId: string): Promise<number> {
	return sessionsDb.countRunningByOrganization(orgId);
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

export class SessionLimitError extends Error {
	constructor(public maxSessions: number) {
		super(
			`Concurrent session limit reached. Your plan allows ${maxSessions} concurrent session${maxSessions === 1 ? "" : "s"}.`,
		);
		this.name = "SessionLimitError";
	}
}

export class ConfigurationNotFoundError extends Error {
	constructor() {
		super("Configuration not found");
		this.name = "ConfigurationNotFoundError";
	}
}

export class ConfigurationNoReposError extends Error {
	constructor() {
		super("Configuration has no repos");
		this.name = "ConfigurationNoReposError";
	}
}

export class ConfigurationRepoUnauthorizedError extends Error {
	constructor() {
		super("Unauthorized access to configuration repos");
		this.name = "ConfigurationRepoUnauthorizedError";
	}
}

export interface CreateSessionInput {
	configurationId?: string;
	sessionType?: "setup" | "coding";
	modelId?: string;
	reasoningEffort?: "quick" | "normal" | "deep";
	initialPrompt?: string;
	orgId: string;
	userId: string;
	gatewayUrl: string;
	serviceToken: string;
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
		gatewayUrl,
		serviceToken,
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
		});
	}

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
}): Promise<CreateSessionResult> {
	const { sessionType, agentConfig, initialPrompt, orgId, userId, gatewayUrl, serviceToken } =
		input;

	const provider = getSandboxProvider();
	const sessionId = randomUUID();
	const reqLog = logger.child({ sessionId });
	const doUrl = `${gatewayUrl}/session/${sessionId}`;
	reqLog.info({ sessionType }, "Creating scratch session");

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
		...(initialPrompt ? { titleStatus: "generating" } : {}),
		agentConfig: {
			modelId: agentConfig.modelId,
			...(agentConfig.reasoningEffort && { reasoningEffort: agentConfig.reasoningEffort }),
		},
	});

	reqLog.info("Scratch session record created");

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
	} = input;

	// Get configuration by ID
	const configuration = await configurations.findByIdForSession(configurationId);
	if (!configuration) {
		throw new ConfigurationNotFoundError();
	}

	const configurationProvider = configuration.sandboxProvider;

	// Get repos from configuration_repos junction table
	const configurationRepos =
		await configurations.getConfigurationReposWithDetails(configurationId);

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

	// Create session record and return immediately.
	// Sandbox provisioning is handled by the gateway when the client connects.
	await createSessionWithAdmission(orgId, {
		id: sessionId,
		configurationId,
		organizationId: orgId,
		createdBy: userId,
		sessionType,
		status: "starting",
		sandboxProvider: provider.type,
		snapshotId,
		initialPrompt,
		...(initialPrompt ? { titleStatus: "generating" } : {}),
		agentConfig: {
			modelId: agentConfig.modelId,
			...(agentConfig.reasoningEffort && { reasoningEffort: agentConfig.reasoningEffort }),
		},
	});

	reqLog.info("Session record created, returning immediately");

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
		logger.warn(
			{ sessionId },
			"Skipping eager start: missing gatewayUrl or serviceToken",
		);
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
