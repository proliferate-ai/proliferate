/**
 * Session creation handler.
 *
 * Creates a session record and returns immediately.
 * Sandbox provisioning is handled by the gateway when the client connects.
 *
 * Two paths:
 * - Prebuild-backed: existing flow with repo validation and snapshot resolution.
 * - Scratch: no prebuild, no repos. Only allowed for coding sessions.
 */

import { randomUUID } from "crypto";
import { logger } from "@/lib/logger";

const log = logger.child({ handler: "sessions-create" });
import { getSessionGatewayUrl } from "@/lib/gateway";
import { ORPCError } from "@orpc/server";
import { billing, prebuilds, sessions } from "@proliferate/services";
import {
	type AgentConfig,
	type SandboxProviderType,
	getDefaultAgentConfig,
	isValidModelId,
	parseModelId,
} from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

interface CreateSessionHandlerInput {
	prebuildId?: string;
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
	const { prebuildId, sessionType = "coding", modelId: requestedModelId, orgId, userId } = input;

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
	};

	// Scratch path: no prebuild, just boot from base snapshot
	if (!prebuildId) {
		return createScratchSession({ sessionType, agentConfig, orgId, userId });
	}

	// Prebuild-backed path: existing flow
	return createPrebuildSession({ prebuildId, sessionType, agentConfig, orgId, userId });
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
		await createSessionWithAdmission(orgId, {
			id: sessionId,
			prebuildId: null,
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

async function createPrebuildSession(input: {
	prebuildId: string;
	sessionType: string;
	agentConfig: AgentConfig;
	orgId: string;
	userId: string;
}): Promise<CreateSessionResult> {
	const { prebuildId, sessionType, agentConfig, orgId, userId } = input;

	// Get prebuild by ID
	const prebuild = await prebuilds.findByIdForSession(prebuildId);

	if (!prebuild) {
		throw new ORPCError("BAD_REQUEST", { message: "Prebuild not found" });
	}

	const prebuildProvider = prebuild.sandboxProvider;

	// Get repos from prebuild_repos junction table
	let prebuildRepos: prebuilds.PrebuildRepoDetailRow[];
	try {
		prebuildRepos = await prebuilds.getPrebuildReposWithDetails(prebuildId);
	} catch (err) {
		log.error({ err }, "Failed to fetch prebuild repos");
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to fetch prebuild repos" });
	}

	if (prebuildRepos.length === 0) {
		throw new ORPCError("BAD_REQUEST", { message: "Prebuild has no repos" });
	}

	const verifiedPrebuildRepos = prebuildRepos.map((pr) => {
		if (!pr.repo) {
			throw new ORPCError("BAD_REQUEST", { message: "Prebuild has missing repo data" });
		}
		if (pr.repo.organizationId !== orgId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized access to prebuild repos" });
		}
		return { ...pr, repo: pr.repo };
	});

	// Resolve provider and snapshot layering
	const providerType = prebuildProvider as SandboxProviderType | undefined;
	const provider = getSandboxProvider(providerType);

	const prebuildSnapshotId = prebuild.snapshotId;
	const eligibleRepos = verifiedPrebuildRepos;
	const repoSnapshotId =
		!prebuildSnapshotId &&
		provider.type === "modal" &&
		eligibleRepos.length === 1 &&
		eligibleRepos[0].workspacePath === "." &&
		eligibleRepos[0].repo.repoSnapshotStatus === "ready" &&
		eligibleRepos[0].repo.repoSnapshotId &&
		(!eligibleRepos[0].repo.repoSnapshotProvider ||
			eligibleRepos[0].repo.repoSnapshotProvider === "modal")
			? eligibleRepos[0].repo.repoSnapshotId
			: null;
	const snapshotId = prebuildSnapshotId || repoSnapshotId;

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
			prebuildId,
			organizationId: orgId,
			createdBy: userId,
			sessionType,
			status: "starting",
			sandboxProvider: provider.type,
			snapshotId,
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
