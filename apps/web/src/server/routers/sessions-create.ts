/**
 * Session creation handler.
 *
 * Complex operation that provisions a sandbox from a prebuild.
 * Extracted from ts-rest router for use in oRPC.
 */

import { randomUUID } from "crypto";
import { checkCanStartSession } from "@/lib/billing";
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

	// For coding sessions, prebuild must have a snapshot
	if (sessionType === "coding" && !prebuild.snapshotId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Prebuild has no snapshot. Complete setup first.",
		});
	}

	const snapshotId = prebuild.snapshotId;
	const prebuildProvider = prebuild.sandboxProvider;

	// Get repos from prebuild_repos junction table
	let prebuildRepos: prebuilds.PrebuildRepoDetailRow[];
	try {
		prebuildRepos = await prebuilds.getPrebuildReposWithDetails(prebuildId);
	} catch (err) {
		console.error("Failed to fetch prebuild repos:", err);
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to fetch prebuild repos" });
	}

	if (prebuildRepos.length === 0) {
		throw new ORPCError("BAD_REQUEST", { message: "Prebuild has no repos" });
	}

	// Verify all repos belong to this org
	for (const pr of prebuildRepos) {
		if (pr.repo?.organizationId !== orgId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized access to prebuild repos" });
		}
	}

	// Primary repo (first one) for system prompt
	const primaryRepo = prebuildRepos[0]?.repo;

	// Build repos to clone list
	const reposToClone = prebuildRepos.map((pr) => ({
		repoId: pr.repo?.id ?? "",
		repoUrl: pr.repo?.githubUrl ?? "",
		workspacePath: pr.workspacePath,
		defaultBranch: pr.repo?.defaultBranch ?? null,
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
			console.warn(`Failed to get GitHub token for repo ${targetRepoId}:`, err);
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
	const doUrl = getSessionGatewayUrl(sessionId);
	const startTime = Date.now();
	console.log(`[Timing] Session ${sessionId.slice(0, 8)} creation started`);

	// Create sandbox via provider
	const providerType = prebuildProvider as SandboxProviderType | undefined;
	const provider = getSandboxProvider(providerType);

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
		console.error("Failed to create session:", err);
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" });
	}
	console.log(`[Timing] +${Date.now() - startTime}ms DB insert complete`);

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
		console.log(
			`[Session] LLM proxy config: url=${
				envResult.usesProxy ? "SET" : "NOT SET"
			}, required=${env.LLM_PROXY_REQUIRED}`,
		);
		if (envResult.usesProxy) {
			console.log(`[Session] LLM proxy enabled: ${env.LLM_PROXY_URL}`);
		} else {
			const hasDirectKey = !!envVars.ANTHROPIC_API_KEY;
			console.log(
				`[Session] WARNING: LLM proxy not configured, using direct API key: ${
					hasDirectKey ? "SET" : "NOT SET"
				}`,
			);
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
		console.log(`[Timing] +${Date.now() - startTime}ms calling ${provider.type} provider`);
		const providerStartTime = Date.now();

		console.log(`[Session] Using model: ${agentConfig.modelId}`);
		console.log(`[Session] Cloning ${repoSpecs.length} repo(s)`);
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
		console.log(
			`[Timing] +${Date.now() - startTime}ms ${provider.type} returned (${Date.now() - providerStartTime}ms for provider)`,
		);

		// Update session with sandbox info
		await sessions.updateSessionRecord(sessionId, {
			status: "running",
			sandboxId,
			openCodeTunnelUrl: tunnelUrl,
			previewTunnelUrl: previewUrl,
			codingAgentSessionId: null,
		});
		console.log(`[Timing] +${Date.now() - startTime}ms session status updated to running`);

		// For setup sessions: take initial snapshot async (don't block)
		if (sessionType === "setup" && sandboxId && !snapshotId) {
			const snapshotStartTime = Date.now();
			provider
				.snapshot(sessionId, sandboxId)
				.then(async (snapshotResult) => {
					// Only update if snapshot_id is still null
					const updated = await prebuilds.updateSnapshotIdIfNull(
						prebuildId,
						snapshotResult.snapshotId,
					);

					if (updated) {
						console.log(
							`[Session] Initial snapshot saved for prebuild ${prebuildId.slice(0, 8)} in ${Date.now() - snapshotStartTime}ms`,
						);
					}
				})
				.catch((err) => {
					console.warn("[Session] Failed to take initial snapshot (non-fatal):", err);
				});
		}
	} catch (err) {
		console.error("Sandbox provider error:", err);

		if (err instanceof Error) {
			console.error("Error message:", err.message);
			console.error("Stack trace:", err.stack);
			if (Object.keys(err).length > 0) {
				console.error("Error fields:", JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
			}
			warning = `Sandbox creation failed: ${err.message}`;
		} else {
			console.error("Non-Error thrown:", err);
			warning = `Sandbox creation failed: ${typeof err === "string" ? err : "Unknown error"}`;
		}
	}

	console.log("returning response");
	console.log({ sessionId, doUrl, tunnelUrl, previewUrl, sandboxId, warning });

	return { sessionId, doUrl, tunnelUrl, previewUrl, sandboxId, warning };
}
