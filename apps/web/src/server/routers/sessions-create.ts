/**
 * Session creation handler.
 *
 * Complex operation that provisions a sandbox from a prebuild.
 * Extracted from ts-rest router for use in oRPC.
 */

import { randomUUID } from "crypto";
import { checkCanStartSession } from "@/lib/billing";
import { logger } from "@/lib/logger";

const log = logger.child({ handler: "sessions-create" });
import { getSessionGatewayUrl } from "@/lib/gateway";
import { type GitHubIntegration, getGitHubTokenForIntegration } from "@/lib/github";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { integrations, prebuilds, sessions } from "@proliferate/services";
import {
	type AgentConfig,
	type RepoSpec,
	type SandboxProviderType,
	getCodingSystemPrompt,
	getDefaultAgentConfig,
	getSetupSystemPrompt,
	isValidModelId,
	parseModelId,
} from "@proliferate/shared";
import {
	generateSessionAPIKey,
	getLLMProxyURL,
	isLLMProxyEnabled,
} from "@proliferate/shared/llm-proxy";
import { getSandboxProvider } from "@proliferate/shared/providers";

// Provider constants
const NANGO_GITHUB_PROVIDER = "github-app";

interface CreateSessionHandlerInput {
	prebuildId: string;
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

	// Primary repo (first one) for system prompt
	const primaryRepo = verifiedPrebuildRepos[0]?.repo;

	// Create sandbox via provider
	const providerType = prebuildProvider as SandboxProviderType | undefined;
	const provider = getSandboxProvider(providerType);

	// Resolve snapshot layering:
	// 1) Prebuild snapshot (explicit environment/config snapshot)
	// 2) Repo snapshot (deterministic clone-only baseline, single-repo prebuilds only)
	// 3) No snapshot (base snapshot/base image + live clone)
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

	// Build repos to clone list
	const reposToClone = verifiedPrebuildRepos.map((pr) => ({
		repoId: pr.repo.id,
		repoUrl: pr.repo.githubUrl,
		workspacePath: pr.workspacePath,
		defaultBranch: pr.repo.defaultBranch,
	}));

	// Helper to get token for a single repo
	async function getTokenForRepo(targetRepoId: string): Promise<string> {
		try {
			// First, try to get connections linked to this repo via junction table
			const repoConnections = await integrations.getRepoConnectionsWithIntegrations(targetRepoId);

			// Filter to active connections with valid GitHub credentials
			const activeConnections = repoConnections.filter(
				(rc) =>
					rc.integration !== null &&
					rc.integration.status === "active" &&
					(rc.integration.githubInstallationId !== null || rc.integration.connectionId !== null),
			);

			// Prefer current user's connection
			let selectedIntegration: GitHubIntegration | null = null;

			const userConnection = activeConnections.find((rc) => rc.integration?.createdBy === userId);
			if (userConnection?.integration) {
				selectedIntegration = {
					id: userConnection.integration.id,
					githubInstallationId: userConnection.integration.githubInstallationId,
					connectionId: userConnection.integration.connectionId,
				};
			} else if (activeConnections.length > 0 && activeConnections[0].integration) {
				const firstConn = activeConnections[0].integration;
				selectedIntegration = {
					id: firstConn.id,
					githubInstallationId: firstConn.githubInstallationId,
					connectionId: firstConn.connectionId,
				};
			}

			// If no repo-specific connection, fall back to any org GitHub connection
			if (!selectedIntegration) {
				const githubAppIntegration = await integrations.findActiveGitHubApp(orgId);

				if (githubAppIntegration) {
					selectedIntegration = githubAppIntegration;
				} else {
					const nangoIntegration = await integrations.findActiveNangoGitHub(
						orgId,
						NANGO_GITHUB_PROVIDER,
					);
					selectedIntegration = nangoIntegration;
				}
			}

			if (selectedIntegration) {
				return await getGitHubTokenForIntegration(selectedIntegration);
			}

			// Mark repo as orphaned if no connections available
			await integrations.markRepoOrphaned(targetRepoId);
			return "";
		} catch (err) {
			log.warn({ err, repoId: targetRepoId }, "Failed to get GitHub token for repo");
			return "";
		}
	}

	// Resolve tokens for all repos (in parallel for efficiency)
	const repoSpecs: RepoSpec[] = await Promise.all(
		reposToClone.map(async (r) => ({
			repoUrl: r.repoUrl,
			token: await getTokenForRepo(r.repoId),
			workspacePath: r.workspacePath,
			repoId: r.repoId,
		})),
	);

	// Determine system prompt based on session type
	const systemPrompt =
		sessionType === "setup"
			? getSetupSystemPrompt(primaryRepo?.githubRepoName ?? "repo")
			: getCodingSystemPrompt(primaryRepo?.githubRepoName ?? "repo");

	// Generate IDs
	const sessionId = randomUUID();
	const reqLog = log.child({ sessionId });
	const doUrl = getSessionGatewayUrl(sessionId);
	const startTime = Date.now();
	reqLog.info("Session creation started");

	// Create session record
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
			prebuildId,
			organizationId: orgId,
			createdBy: userId,
			sessionType,
			status: "starting",
			sandboxProvider: provider.type,
			snapshotId,
		});
	} catch (err) {
		reqLog.error({ err }, "Failed to create session");
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" });
	}
	reqLog.info({ durationMs: Date.now() - startTime }, "DB insert complete");

	// Prepare environment variables for sandbox (shared logic with gateway)
	const repoIds = reposToClone.map((r) => r.repoId);
	let envVars: Record<string, string>;
	try {
		const envResult = await sessions.buildSandboxEnvVars({
			sessionId,
			orgId,
			repoIds,
			repoSpecs,
			requireProxy:
				env.LLM_PROXY_REQUIRED === true ||
				env.LLM_PROXY_REQUIRED === ("true" as unknown as boolean),
		});
		envVars = envResult.envVars;
		reqLog.info(
			{ usesProxy: envResult.usesProxy, proxyRequired: env.LLM_PROXY_REQUIRED },
			"LLM proxy config",
		);
		if (envResult.usesProxy) {
			reqLog.info("LLM proxy enabled");
		} else {
			const hasDirectKey = !!envVars.ANTHROPIC_API_KEY;
			reqLog.warn({ hasDirectKey }, "LLM proxy not configured, using direct API key");
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
	}

	// Create sandbox via provider
	let tunnelUrl: string | null = null;
	let previewUrl: string | null = null;
	let sandboxId: string | null = null;
	let warning: string | null = null;

	try {
		reqLog.info(
			{ durationMs: Date.now() - startTime, provider: provider.type },
			"Calling sandbox provider",
		);
		const providerStartTime = Date.now();

		reqLog.info({ modelId: agentConfig.modelId }, "Using model");
		reqLog.info({ repoCount: repoSpecs.length }, "Cloning repos");
		const result = await provider.createSandbox({
			sessionId,
			repos: repoSpecs,
			branch: primaryRepo?.defaultBranch || "main",
			envVars,
			systemPrompt,
			snapshotId: snapshotId || undefined,
			agentConfig,
		});

		tunnelUrl = result.tunnelUrl;
		previewUrl = result.previewUrl;
		sandboxId = result.sandboxId;
		reqLog.info(
			{
				durationMs: Date.now() - startTime,
				providerDurationMs: Date.now() - providerStartTime,
				provider: provider.type,
			},
			"Provider returned",
		);

		// Update session with sandbox info
		await sessions.updateSessionRecord(sessionId, {
			status: "running",
			sandboxId,
			openCodeTunnelUrl: tunnelUrl,
			previewTunnelUrl: previewUrl,
			codingAgentSessionId: null,
		});
		reqLog.info({ durationMs: Date.now() - startTime }, "Session status updated to running");

	} catch (err) {
		reqLog.error({ err }, "Sandbox provider error");

		if (err instanceof Error) {
			warning = `Sandbox creation failed: ${err.message}`;
		} else {
			reqLog.error({ thrown: err }, "Non-Error thrown from sandbox provider");
			warning = `Sandbox creation failed: ${typeof err === "string" ? err : "Unknown error"}`;
		}
	}

	reqLog.info({ doUrl, tunnelUrl, previewUrl, sandboxId, warning }, "Returning response");

	return { sessionId, doUrl, tunnelUrl, previewUrl, sandboxId, warning };
}
