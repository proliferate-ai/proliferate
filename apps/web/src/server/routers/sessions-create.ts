/**
 * Session creation handler.
 *
 * Creates a session record and returns immediately.
 * Sandbox provisioning is handled by the gateway when the client connects.
 *
 * Two paths:
 * - Configuration-backed: existing flow with repo validation and snapshot selection.
 * - Scratch: no configuration, no repos. Only allowed for coding sessions.
 */

import { randomUUID } from "crypto";
import { checkCanStartSession } from "@/lib/billing";
import { logger } from "@/lib/logger";

const log = logger.child({ handler: "sessions-create" });
import { getSessionGatewayUrl } from "@/lib/gateway";
import { ORPCError } from "@orpc/server";
import { configurations, sessions, snapshots } from "@proliferate/services";
import {
	type AgentConfig,
	type SandboxProviderType,
	getDefaultAgentConfig,
	isValidModelId,
	parseModelId,
} from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

interface CreateSessionHandlerInput {
	configurationId?: string;
	sessionType?: "setup" | "coding";
	modelId?: string;
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
		orgId,
		userId,
	} = input;

	// Check billing/credits before creating session
	const billingCheck = await checkCanStartSession(orgId);
	if (!billingCheck.allowed) {
		throw new ORPCError("PAYMENT_REQUIRED", {
			message: billingCheck.message || "Insufficient credits",
			data: { billingCode: billingCheck.code },
		});
	}

	// Build agent config from request or defaults
	const agentConfig: AgentConfig = {
		agentType: "opencode",
		modelId:
			requestedModelId && isValidModelId(requestedModelId)
				? requestedModelId
				: requestedModelId
					? parseModelId(requestedModelId)
					: getDefaultAgentConfig().modelId,
	};

	// Scratch path: no configuration, just boot from base snapshot
	if (!configurationId) {
		return createScratchSession({ sessionType, agentConfig, orgId, userId });
	}

	// Configuration-backed path: existing flow
	return createConfigurationSession({ configurationId, sessionType, agentConfig, orgId, userId });
}

async function createScratchSession(input: {
	sessionType: string;
	agentConfig: AgentConfig;
	orgId: string;
	userId: string;
}): Promise<CreateSessionResult> {
	const { sessionType, agentConfig, orgId, userId } = input;

	const provider = getSandboxProvider();
	const sessionId = randomUUID();
	const reqLog = log.child({ sessionId });
	const doUrl = getSessionGatewayUrl(sessionId);
	reqLog.info({ sessionType }, "Creating scratch session");

	try {
		const recheck = await checkCanStartSession(orgId);
		if (!recheck.allowed) {
			throw new ORPCError("PAYMENT_REQUIRED", {
				message: recheck.message || "Insufficient credits",
				data: { billingCode: recheck.code },
			});
		}

		await sessions.createSessionRecord({
			id: sessionId,
			configurationId: null,
			organizationId: orgId,
			createdBy: userId,
			sessionType,
			status: "starting",
			sandboxProvider: provider.type,
			snapshotId: null,
			agentConfig: { modelId: agentConfig.modelId },
		});
	} catch (err) {
		if (err instanceof ORPCError) throw err;
		reqLog.error({ err }, "Failed to create scratch session");
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" });
	}

	reqLog.info("Scratch session record created");

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
	orgId: string;
	userId: string;
}): Promise<CreateSessionResult> {
	const { configurationId, sessionType, agentConfig, orgId, userId } = input;

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

	// Resolve provider
	const providerType = configurationProvider as SandboxProviderType | undefined;
	const provider = getSandboxProvider(providerType);

	// Snapshot selection is handled by the gateway when the client connects.

	// Generate IDs
	const sessionId = randomUUID();
	const reqLog = log.child({ sessionId });
	const doUrl = getSessionGatewayUrl(sessionId);
	reqLog.info("Session creation started");

	// Create session record and return immediately.
	// Sandbox provisioning is handled by the gateway when the client connects.
	try {
		const recheck = await checkCanStartSession(orgId);
		if (!recheck.allowed) {
			throw new ORPCError("PAYMENT_REQUIRED", {
				message: recheck.message || "Insufficient credits",
				data: { billingCode: recheck.code },
			});
		}

		await sessions.createSessionRecord({
			id: sessionId,
			configurationId,
			organizationId: orgId,
			createdBy: userId,
			sessionType,
			status: "starting",
			sandboxProvider: provider.type,
			snapshotId: null,
			agentConfig: { modelId: agentConfig.modelId },
		});
	} catch (err) {
		if (err instanceof ORPCError) throw err;
		reqLog.error({ err }, "Failed to create session");
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" });
	}

	reqLog.info("Session record created, returning immediately");

	return {
		sessionId,
		doUrl,
		tunnelUrl: null,
		previewUrl: null,
		sandboxId: null,
		warning: null,
	};
}
