/**
 * Session creation handler.
 *
 * Creates a session record and, when an initial prompt is provided,
 * triggers eager start via the gateway so the sandbox boots and the
 * prompt is sent immediately (without waiting for a WebSocket client).
 *
 * Two paths:
 * - Configuration-backed: existing flow with repo validation and snapshot resolution.
 * - Scratch: no configuration, no repos. Only allowed for coding sessions.
 */

import { randomUUID } from "crypto";
import { GATEWAY_URL, getSessionGatewayUrl } from "@/lib/gateway";
import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import { billing, configurations, sessions } from "@proliferate/services";
import {
	type AgentConfig,
	type SandboxProviderType,
	getDefaultAgentConfig,
	isValidModelId,
	parseModelId,
} from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

const log = logger.child({ handler: "sessions-create" });

interface CreateSessionHandlerInput {
	configurationId?: string;
	sessionType?: "setup" | "coding";
	modelId?: string;
	reasoningEffort?: "quick" | "normal" | "deep";
	initialPrompt?: string;
	orgId: string;
	userId: string;
}

interface CreateSessionResult {
	sessionId: string;
	doUrl: string;
	tunnelUrl: string | null;
	previewUrl: string | null;
	sandboxId: string | null;
	warning: string | null;
}

export async function createSessionHandler(
	input: CreateSessionHandlerInput,
): Promise<CreateSessionResult> {
	const {
		configurationId,
		sessionType = "coding",
		modelId: requestedModelId,
		reasoningEffort,
		initialPrompt,
		orgId,
		userId,
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
		return createScratchSession({ sessionType, agentConfig, initialPrompt, orgId, userId });
	}

	// Configuration-backed path: existing flow
	return createConfigurationSession({
		configurationId,
		sessionType,
		agentConfig,
		initialPrompt,
		orgId,
		userId,
	});
}

async function createScratchSession(input: {
	sessionType: string;
	agentConfig: AgentConfig;
	initialPrompt?: string;
	orgId: string;
	userId: string;
}): Promise<CreateSessionResult> {
	const { sessionType, agentConfig, initialPrompt, orgId, userId } = input;

	const provider = getSandboxProvider();
	const sessionId = randomUUID();
	const reqLog = log.child({ sessionId });
	const doUrl = getSessionGatewayUrl(sessionId);
	reqLog.info({ sessionType }, "Creating scratch session");

	try {
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
	} catch (err) {
		if (err instanceof ORPCError) throw err;
		reqLog.error({ err }, "Failed to create scratch session");
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" });
	}

	reqLog.info("Scratch session record created");

	// Enqueue async title generation (fire-and-forget)
	if (initialPrompt) {
		void sessions.requestTitleGeneration(sessionId, orgId, initialPrompt);
		triggerEagerStart(sessionId);
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
}): Promise<CreateSessionResult> {
	const { configurationId, sessionType, agentConfig, initialPrompt, orgId, userId } = input;

	// Get configuration by ID
	const configuration = await configurations.findByIdForSession(configurationId);

	if (!configuration) {
		throw new ORPCError("BAD_REQUEST", { message: "Configuration not found" });
	}

	const configurationProvider = configuration.sandboxProvider;

	// Get repos from configuration_repos junction table
	let configurationRepos: configurations.ConfigurationRepoDetailRow[];
	try {
		configurationRepos = await configurations.getConfigurationReposWithDetails(configurationId);
	} catch (err) {
		log.error({ err }, "Failed to fetch configuration repos");
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Failed to fetch configuration repos",
		});
	}

	if (configurationRepos.length === 0) {
		throw new ORPCError("BAD_REQUEST", { message: "Configuration has no repos" });
	}

	const verifiedConfigurationRepos = configurationRepos.map((pr) => {
		if (!pr.repo) {
			throw new ORPCError("BAD_REQUEST", { message: "Configuration has missing repo data" });
		}
		if (pr.repo.organizationId !== orgId) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "Unauthorized access to configuration repos",
			});
		}
		return { ...pr, repo: pr.repo };
	});

	// Resolve provider and snapshot layering
	const providerType = configurationProvider as SandboxProviderType | undefined;
	const provider = getSandboxProvider(providerType);

	const snapshotId = configuration.snapshotId ?? null;

	// Generate IDs
	const sessionId = randomUUID();
	const reqLog = log.child({ sessionId });
	const doUrl = getSessionGatewayUrl(sessionId);
	reqLog.info("Session creation started");

	// Create session record and return immediately.
	// Sandbox provisioning is handled by the gateway when the client connects.
	try {
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
	} catch (err) {
		if (err instanceof ORPCError) throw err;
		reqLog.error({ err }, "Failed to create session");
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" });
	}

	reqLog.info("Session record created, returning immediately");

	// Enqueue async title generation (fire-and-forget)
	if (initialPrompt) {
		void sessions.requestTitleGeneration(sessionId, orgId, initialPrompt);
		triggerEagerStart(sessionId);
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
function triggerEagerStart(sessionId: string): void {
	if (!GATEWAY_URL || !env.SERVICE_TO_SERVICE_AUTH_TOKEN) {
		log.warn(
			{ sessionId },
			"Skipping eager start: missing GATEWAY_URL or SERVICE_TO_SERVICE_AUTH_TOKEN",
		);
		return;
	}

	const gateway = createSyncClient({
		baseUrl: GATEWAY_URL,
		auth: {
			type: "service",
			name: "web-session-create",
			secret: env.SERVICE_TO_SERVICE_AUTH_TOKEN,
		},
	});

	gateway.eagerStart(sessionId).catch((err) => {
		log.warn({ err, sessionId }, "Eager start request failed (session will start on connect)");
	});
}

/**
 * Create a session with atomic concurrent admission guard when billing is enabled.
 * Falls back to plain insert when billing is disabled.
 */
async function createSessionWithAdmission(
	orgId: string,
	input: sessions.DbCreateSessionInput,
): Promise<void> {
	const planLimits = await billing.getOrgPlanLimits(orgId);
	if (planLimits) {
		const { created } = await sessions.createWithAdmissionGuard(
			input,
			planLimits.maxConcurrentSessions,
		);
		if (!created) {
			throw new ORPCError("FORBIDDEN", {
				message: `Concurrent session limit reached. Your plan allows ${planLimits.maxConcurrentSessions} concurrent session${planLimits.maxConcurrentSessions === 1 ? "" : "s"}.`,
			});
		}
	} else {
		await sessions.createSessionRecord(input);
	}
}
