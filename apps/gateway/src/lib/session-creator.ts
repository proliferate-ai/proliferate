/**
 * Session Creator
 *
 * Handles session creation logic including:
 * - Creating session record in database
 * - Optionally creating sandbox immediately
 * - Setting up environment variables and secrets
 * - Generating LLM proxy JWT
 */

import { automations, integrations, prebuilds, sessions } from "@proliferate/services";
import {
	type CloneInstructions,
	type ModelId,
	type RepoSpec,
	type SandboxProvider,
	getDefaultAgentConfig,
	isValidModelId,
	parseModelId,
} from "@proliferate/shared";
import type { GatewayEnv } from "./env";
import { type GitHubIntegration, getGitHubTokenForIntegration } from "./github-auth";

const latencyPrefix = "[P-LATENCY]";
const logLatency = (event: string, data?: Record<string, unknown>) => {
	console.log(`${latencyPrefix} ${event}`, data || {});
};

export type SessionType = "coding" | "setup" | "cli";
export type ClientType = "web" | "slack" | "cli" | "automation";
export type SandboxMode = "immediate" | "deferred";

export interface CreateSessionOptions {
	env: GatewayEnv;
	provider: SandboxProvider;

	// Required
	organizationId: string;
	prebuildId: string;
	sessionType: SessionType;
	clientType: ClientType;

	// Optional
	userId?: string;
	snapshotId?: string | null;
	initialPrompt?: string;
	title?: string;
	clientMetadata?: Record<string, unknown>;
	agentConfig?: { modelId?: string };
	sandboxMode?: SandboxMode;
	automationId?: string;
	triggerId?: string;
	triggerEventId?: string;

	/** Explicit integration IDs for OAuth token injection.
	 * If not provided, will inherit from automationId's connections. */
	integrationIds?: string[];

	/** Trigger context written to .proliferate/trigger-context.json in sandbox */
	triggerContext?: Record<string, unknown>;

	// SSH access (can be enabled on any session type)
	sshOptions?: {
		publicKeys: string[];
		cloneInstructions?: CloneInstructions;
		localPath?: string;
		localPathHash?: string;
		gitToken?: string;
		envVars?: Record<string, string>;
	};
}

export interface IntegrationWarning {
	integrationId: string;
	message: string;
}

export interface CreateSessionResult {
	sessionId: string;
	prebuildId: string;
	status: "pending" | "starting" | "running";
	hasSnapshot: boolean;
	isNewPrebuild: boolean;
	sandbox?: {
		sandboxId: string;
		previewUrl: string | null;
		sshHost?: string;
		sshPort?: number;
	};
	/** Warnings for integrations that failed token resolution. */
	integrationWarnings?: IntegrationWarning[];
}

interface PrebuildRepoRow {
	workspacePath: string;
	repo: {
		id: string;
		githubUrl: string;
		githubRepoName: string;
		defaultBranch: string | null;
	} | null;
}

/**
 * Create a new session
 */
export async function createSession(
	options: CreateSessionOptions,
	isNewPrebuild = false,
): Promise<CreateSessionResult> {
	const {
		env,
		provider,
		organizationId,
		prebuildId,
		sessionType,
		clientType,
		userId,
		snapshotId,
		initialPrompt,
		title,
		clientMetadata,
		agentConfig,
		sandboxMode = "deferred",
		automationId,
		triggerId,
		triggerEventId,
		integrationIds: explicitIntegrationIds,
		triggerContext,
		sshOptions,
	} = options;

	const sessionId = crypto.randomUUID();
	const shortId = sessionId.slice(0, 8);
	const startMs = Date.now();

	console.log(`[SessionCreator:${shortId}] Creating session`, {
		sessionType,
		clientType,
		sandboxMode,
		hasSnapshot: Boolean(snapshotId),
		sshEnabled: Boolean(sshOptions),
		explicitIntegrations: explicitIntegrationIds?.length ?? 0,
	});
	logLatency("session_creator.create_session.start", {
		sessionId,
		shortId,
		sessionType,
		clientType,
		sandboxMode,
		isNewPrebuild,
		hasSnapshotId: Boolean(snapshotId),
		sshEnabled: Boolean(sshOptions),
		explicitIntegrations: explicitIntegrationIds?.length ?? 0,
	});

	// SSH sessions are always immediate (need to return SSH connection info)
	const effectiveSandboxMode = sshOptions ? "immediate" : sandboxMode;
	const initialStatus = effectiveSandboxMode === "immediate" ? "starting" : "pending";

	// Resolve integration IDs (explicit or inherited from automation)
	let resolvedIntegrationIds: string[] = [];
	if (explicitIntegrationIds?.length) {
		resolvedIntegrationIds = explicitIntegrationIds;
	} else if (automationId) {
		try {
			const listStartMs = Date.now();
			const automationConnections =
				await automations.listAutomationConnectionsInternal(automationId);
			logLatency("session_creator.create_session.integration_ids.resolve", {
				sessionId,
				shortId,
				durationMs: Date.now() - listStartMs,
				automationId,
				connectionCount: automationConnections.length,
			});
			resolvedIntegrationIds = automationConnections
				.filter((c) => c.integration?.status === "active")
				.map((c) => c.integrationId);
		} catch (err) {
			console.warn(`[SessionCreator:${shortId}] Failed to load automation connections:`, err);
		}
	}

	// Create session record via services
	try {
		const dbStartMs = Date.now();
		await sessions.create({
			id: sessionId,
			prebuildId,
			organizationId,
			sessionType,
			clientType,
			status: initialStatus,
			sandboxProvider: provider.type,
			createdBy: userId,
			snapshotId,
			initialPrompt,
			title,
			clientMetadata,
			agentConfig,
			localPathHash: sshOptions?.localPathHash,
			origin: sshOptions?.localPathHash ? "cli" : undefined,
			automationId,
			triggerId,
			triggerEventId,
		});
		logLatency("session_creator.create_session.db.create", {
			sessionId,
			shortId,
			durationMs: Date.now() - dbStartMs,
		});
	} catch (err) {
		console.error(`[SessionCreator:${shortId}] Failed to create session:`, err);
		logLatency("session_creator.create_session.error", {
			sessionId,
			shortId,
			durationMs: Date.now() - startMs,
			error: err instanceof Error ? err.message : String(err),
		});
		throw new Error(
			`Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Create session connections (record which integrations are associated)
	if (resolvedIntegrationIds.length > 0) {
		try {
			const connectionsStartMs = Date.now();
			await sessions.createSessionConnections(sessionId, resolvedIntegrationIds);
			logLatency("session_creator.create_session.db.create_connections", {
				sessionId,
				shortId,
				durationMs: Date.now() - connectionsStartMs,
				connectionCount: resolvedIntegrationIds.length,
			});
			console.log(
				`[SessionCreator:${shortId}] Recorded ${resolvedIntegrationIds.length} session connection(s)`,
			);
		} catch (err) {
			console.warn(`[SessionCreator:${shortId}] Failed to record session connections:`, err);
		}
	}

	console.log(`[SessionCreator:${shortId}] Session record created`);

	// If deferred, return immediately
	if (effectiveSandboxMode === "deferred") {
		logLatency("session_creator.create_session.complete", {
			sessionId,
			shortId,
			durationMs: Date.now() - startMs,
			mode: "deferred",
		});
		return {
			sessionId,
			prebuildId,
			status: "pending",
			hasSnapshot: Boolean(snapshotId),
			isNewPrebuild,
		};
	}

	// Create sandbox immediately
	let integrationWarnings: IntegrationWarning[] = [];
	try {
		const createSandboxStartMs = Date.now();
		const result = await createSandbox({
			env,
			provider,
			sessionId,
			prebuildId,
			organizationId,
			userId,
			snapshotId,
			agentConfig,
			integrationIds: resolvedIntegrationIds,
			triggerContext,
			sshOptions,
		});
		logLatency("session_creator.create_session.create_sandbox", {
			sessionId,
			shortId,
			provider: provider.type,
			durationMs: Date.now() - createSandboxStartMs,
			hasTunnelUrl: Boolean(result.tunnelUrl),
			hasPreviewUrl: Boolean(result.previewUrl),
			sshEnabled: Boolean(sshOptions),
			warningCount: result.integrationWarnings.length,
		});
		integrationWarnings = result.integrationWarnings;

		// Update session with sandbox info
		const updateStartMs = Date.now();
		await sessions.update(sessionId, {
			status: "running",
			sandboxId: result.sandboxId,
			openCodeTunnelUrl: result.tunnelUrl || null,
			previewTunnelUrl: result.previewUrl,
		});
		logLatency("session_creator.create_session.db.update_session", {
			sessionId,
			shortId,
			durationMs: Date.now() - updateStartMs,
		});

		logLatency("session_creator.create_session.complete", {
			sessionId,
			shortId,
			durationMs: Date.now() - startMs,
			mode: "immediate",
		});
		return {
			sessionId,
			prebuildId,
			status: "running",
			hasSnapshot: Boolean(snapshotId),
			isNewPrebuild,
			sandbox: {
				sandboxId: result.sandboxId,
				previewUrl: result.previewUrl,
				sshHost: result.sshHost,
				sshPort: result.sshPort,
			},
			integrationWarnings: integrationWarnings.length > 0 ? integrationWarnings : undefined,
		};
	} catch (err) {
		// Clean up session on sandbox creation failure
		console.error(`[SessionCreator:${shortId}] Sandbox creation failed:`, err);
		const deleteStartMs = Date.now();
		await sessions.deleteById(sessionId, organizationId);
		logLatency("session_creator.create_session.cleanup.delete_session", {
			sessionId,
			shortId,
			durationMs: Date.now() - deleteStartMs,
		});
		logLatency("session_creator.create_session.error", {
			sessionId,
			shortId,
			durationMs: Date.now() - startMs,
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	}
}

interface CreateSandboxParams {
	env: GatewayEnv;
	provider: SandboxProvider;
	sessionId: string;
	prebuildId: string;
	organizationId: string;
	userId?: string;
	snapshotId?: string | null;
	agentConfig?: { modelId?: string };
	/** Resolved integration IDs for token injection. */
	integrationIds?: string[];
	/** Trigger context written to .proliferate/trigger-context.json */
	triggerContext?: Record<string, unknown>;
	sshOptions?: CreateSessionOptions["sshOptions"];
}

interface CreateSandboxResult {
	sandboxId: string;
	tunnelUrl?: string;
	previewUrl: string;
	sshHost?: string;
	sshPort?: number;
	integrationWarnings: IntegrationWarning[];
}

/**
 * Create a sandbox with all options unified.
 * Handles both coding sessions (with repo cloning) and CLI sessions (with SSH).
 */
async function createSandbox(params: CreateSandboxParams): Promise<CreateSandboxResult> {
	const {
		env,
		provider,
		sessionId,
		prebuildId,
		organizationId,
		userId,
		snapshotId,
		agentConfig,
		integrationIds,
		triggerContext,
		sshOptions,
	} = params;

	const startMs = Date.now();
	const shortId = sessionId.slice(0, 8);
	logLatency("session_creator.create_sandbox.start", {
		sessionId,
		shortId,
		provider: provider.type,
		hasSnapshotId: Boolean(snapshotId),
		sshEnabled: Boolean(sshOptions),
		hasCloneInstructions: Boolean(sshOptions?.cloneInstructions),
		explicitIntegrationCount: integrationIds?.length ?? 0,
	});

	// SSH public key (concatenate all keys for authorized_keys)
	const sshPublicKey = sshOptions?.publicKeys?.join("\n");

	// Resolve integration tokens
	const integrationsStartMs = Date.now();
	const { envVars: integrationEnvVars, warnings: integrationWarnings } =
		await resolveIntegrationEnvVars(sessionId, organizationId, integrationIds);
	logLatency("session_creator.create_sandbox.integration_env_vars", {
		sessionId,
		shortId,
		durationMs: Date.now() - integrationsStartMs,
		envKeyCount: Object.keys(integrationEnvVars).length,
		warningCount: integrationWarnings.length,
	});

	// For CLI/SSH sessions, we don't need to load repos (sync via rsync)
	if (sshOptions && !sshOptions.cloneInstructions) {
		const envStartMs = Date.now();
		const baseEnvResult = await sessions.buildSandboxEnvVars({
			sessionId,
			orgId: organizationId,
			repoIds: [],
			repoSpecs: [],
			requireProxy: process.env.LLM_PROXY_REQUIRED === "true",
			directApiKey: env.anthropicApiKey,
		});
		logLatency("session_creator.create_sandbox.env_vars", {
			sessionId,
			shortId,
			durationMs: Date.now() - envStartMs,
			envKeyCount: Object.keys(baseEnvResult.envVars).length,
		});
		const mergedEnvVars = {
			...baseEnvResult.envVars,
			...integrationEnvVars,
			...(sshOptions.envVars || {}),
		};

		const providerStartMs = Date.now();
		const result = await provider.createSandbox({
			sessionId,
			repos: [],
			branch: "main",
			envVars: mergedEnvVars,
			systemPrompt: "CLI terminal session",
			snapshotId: snapshotId || undefined,
			sshPublicKey,
			triggerContext,
		});
		logLatency("session_creator.create_sandbox.provider.create_sandbox", {
			sessionId,
			shortId,
			provider: provider.type,
			durationMs: Date.now() - providerStartMs,
			isSsh: true,
			hasTunnelUrl: Boolean(result.tunnelUrl),
			hasPreviewUrl: Boolean(result.previewUrl),
		});

		logLatency("session_creator.create_sandbox.complete", {
			sessionId,
			shortId,
			durationMs: Date.now() - startMs,
			isSsh: true,
		});
		return {
			sandboxId: result.sandboxId,
			previewUrl: result.previewUrl,
			sshHost: result.sshHost,
			sshPort: result.sshPort,
			integrationWarnings,
		};
	}

	// Load prebuild repos for coding sessions
	const prebuildStartMs = Date.now();
	const prebuildRepoRows = await prebuilds.getPrebuildReposWithDetails(prebuildId);
	logLatency("session_creator.create_sandbox.prebuild_repos", {
		sessionId,
		shortId,
		durationMs: Date.now() - prebuildStartMs,
		count: prebuildRepoRows?.length ?? 0,
	});

	if (!prebuildRepoRows || prebuildRepoRows.length === 0) {
		throw new Error("Prebuild has no associated repos");
	}

	// Filter out repos with null values and convert to expected shape
	const typedPrebuildRepos: PrebuildRepoRow[] = prebuildRepoRows
		.filter((pr) => pr.repo !== null)
		.map((pr) => ({
			workspacePath: pr.workspacePath,
			repo: pr.repo,
		}));

	if (typedPrebuildRepos.length === 0) {
		throw new Error("Prebuild has no associated repos");
	}

	// Resolve GitHub tokens for each repo
	const githubStartMs = Date.now();
	const repoSpecs: RepoSpec[] = await Promise.all(
		typedPrebuildRepos.map(async (pr) => {
			const token = await resolveGitHubToken(env, organizationId, pr.repo!.id, userId);
			return {
				repoUrl: pr.repo!.githubUrl,
				token,
				workspacePath: pr.workspacePath,
				repoId: pr.repo!.id,
			};
		}),
	);
	logLatency("session_creator.create_sandbox.github_tokens", {
		sessionId,
		shortId,
		durationMs: Date.now() - githubStartMs,
		repoCount: repoSpecs.length,
		tokensPresent: repoSpecs.filter((r) => Boolean(r.token)).length,
	});

	// Build environment variables
	const envStartMs = Date.now();
	const envVars = await loadEnvironmentVariables(
		env,
		sessionId,
		organizationId,
		typedPrebuildRepos.map((pr) => pr.repo!.id),
		repoSpecs,
		integrationEnvVars,
	);
	logLatency("session_creator.create_sandbox.env_vars", {
		sessionId,
		shortId,
		durationMs: Date.now() - envStartMs,
		envKeyCount: Object.keys(envVars).length,
	});

	// Build system prompt
	const primaryRepo = typedPrebuildRepos[0].repo!;
	const systemPrompt = `You are an AI coding assistant. Help the user with their coding tasks in the ${primaryRepo.githubRepoName} repository.`;

	const defaultAgentConfig = getDefaultAgentConfig();
	const rawModelId = agentConfig?.modelId;
	const modelId: ModelId =
		rawModelId && isValidModelId(rawModelId)
			? rawModelId
			: rawModelId
				? parseModelId(rawModelId)
				: defaultAgentConfig.modelId;

	// Create sandbox with all options
	const providerStartMs = Date.now();
	const result = await provider.createSandbox({
		sessionId,
		repos: repoSpecs,
		branch: primaryRepo.defaultBranch || "main",
		envVars,
		systemPrompt,
		snapshotId: snapshotId || undefined,
		agentConfig: agentConfig
			? {
					agentType: "opencode" as const,
					modelId,
				}
			: undefined,
		sshPublicKey,
		triggerContext,
	});
	logLatency("session_creator.create_sandbox.provider.create_sandbox", {
		sessionId,
		shortId,
		provider: provider.type,
		durationMs: Date.now() - providerStartMs,
		isSsh: Boolean(sshOptions),
		hasTunnelUrl: Boolean(result.tunnelUrl),
		hasPreviewUrl: Boolean(result.previewUrl),
	});

	logLatency("session_creator.create_sandbox.complete", {
		sessionId,
		shortId,
		durationMs: Date.now() - startMs,
		isSsh: Boolean(sshOptions),
	});
	return {
		sandboxId: result.sandboxId,
		tunnelUrl: result.tunnelUrl,
		previewUrl: result.previewUrl,
		sshHost: result.sshHost,
		sshPort: result.sshPort,
		integrationWarnings,
	};
}

/**
 * Load environment variables for a session
 */
async function loadEnvironmentVariables(
	env: GatewayEnv,
	sessionId: string,
	orgId: string,
	repoIds: string[],
	repoSpecs: RepoSpec[],
	integrationEnvVars: Record<string, string>,
): Promise<Record<string, string>> {
	const result = await sessions.buildSandboxEnvVars({
		sessionId,
		orgId,
		repoIds,
		repoSpecs,
		requireProxy: process.env.LLM_PROXY_REQUIRED === "true",
		directApiKey: env.anthropicApiKey,
	});

	return {
		...result.envVars,
		...integrationEnvVars,
	};
}

/**
 * Resolve GitHub token for a repo
 */
async function resolveGitHubToken(
	env: GatewayEnv,
	orgId: string,
	repoId: string,
	userId: string | undefined,
): Promise<string> {
	try {
		// Get repo connections with integration details
		const repoConnections = await integrations.getRepoConnectionsWithIntegrations(repoId);

		const activeConnections = repoConnections.filter(
			(rc) => rc.integration && rc.integration.status === "active",
		);

		let selectedIntegration: GitHubIntegration | null = null;

		if (activeConnections.length > 0) {
			if (userId) {
				const userConnection = activeConnections.find((rc) => rc.integration?.createdBy === userId);
				if (userConnection?.integration) {
					selectedIntegration = {
						id: userConnection.integration.id,
						github_installation_id: userConnection.integration.githubInstallationId,
						connection_id: userConnection.integration.connectionId,
					};
				}
			}

			if (!selectedIntegration && activeConnections[0]?.integration) {
				const int = activeConnections[0].integration;
				selectedIntegration = {
					id: int.id,
					github_installation_id: int.githubInstallationId,
					connection_id: int.connectionId,
				};
			}
		}

		if (!selectedIntegration) {
			// Try GitHub App integration
			const githubAppIntegration = await integrations.findActiveGitHubApp(orgId);

			if (githubAppIntegration) {
				selectedIntegration = {
					id: githubAppIntegration.id,
					github_installation_id: githubAppIntegration.githubInstallationId,
					connection_id: githubAppIntegration.connectionId,
				};
			} else {
				// Try Nango GitHub integration
				if (env.nangoGithubIntegrationId) {
					const nangoIntegration = await integrations.findActiveNangoGitHub(
						orgId,
						env.nangoGithubIntegrationId,
					);

					if (nangoIntegration) {
						selectedIntegration = {
							id: nangoIntegration.id,
							github_installation_id: nangoIntegration.githubInstallationId,
							connection_id: nangoIntegration.connectionId,
						};
					}
				}
			}
		}

		if (!selectedIntegration) {
			return "";
		}

		return await getGitHubTokenForIntegration(env, selectedIntegration);
	} catch (err) {
		console.warn("Failed to resolve GitHub token:", err);
		return "";
	}
}

/**
 * Resolve integration tokens and return as env vars.
 */
async function resolveIntegrationEnvVars(
	sessionId: string,
	orgId: string,
	integrationIds?: string[],
): Promise<{ envVars: Record<string, string>; warnings: IntegrationWarning[] }> {
	if (!integrationIds?.length) {
		return { envVars: {}, warnings: [] };
	}

	try {
		const startMs = Date.now();
		const shortId = sessionId.slice(0, 8);
		logLatency("session_creator.integration_tokens.start", {
			sessionId,
			shortId,
			orgId: orgId.slice(0, 8),
			integrationCount: integrationIds.length,
		});
		// Fetch integration details for token resolution
		const fetchStartMs = Date.now();
		const integrationsForTokens = await integrations.getIntegrationsForTokens(
			integrationIds,
			orgId,
		);
		logLatency("session_creator.integration_tokens.fetch", {
			sessionId,
			shortId,
			durationMs: Date.now() - fetchStartMs,
			count: integrationsForTokens.length,
		});

		// Resolve tokens
		const resolveStartMs = Date.now();
		const { tokens, errors } = await integrations.resolveTokens(integrationsForTokens);
		logLatency("session_creator.integration_tokens.resolve", {
			sessionId,
			shortId,
			durationMs: Date.now() - resolveStartMs,
			tokenCount: tokens.length,
			errorCount: errors.length,
		});

		// Build env vars
		const envVars: Record<string, string> = {};
		for (const token of tokens) {
			const envVarName = integrations.getEnvVarName(token.integrationTypeId, token.integrationId);
			envVars[envVarName] = token.token;
			console.log(
				`[SessionCreator] Injected integration token: ${envVarName.replace(/_[^_]+$/, "_***")}`,
			);
		}

		// Convert errors to warnings
		const warnings: IntegrationWarning[] = errors.map((e) => ({
			integrationId: e.integrationId,
			message: e.message,
		}));

		if (warnings.length > 0) {
			console.warn(
				`[SessionCreator] Failed to resolve ${warnings.length} integration token(s):`,
				warnings.map((w) => w.message),
			);
		}

		logLatency("session_creator.integration_tokens.complete", {
			sessionId,
			shortId,
			durationMs: Date.now() - startMs,
			envKeyCount: Object.keys(envVars).length,
			warningCount: warnings.length,
		});
		return { envVars, warnings };
	} catch (err) {
		console.error("[SessionCreator] Error resolving integration tokens:", err);
		logLatency("session_creator.integration_tokens.error", {
			sessionId,
			shortId: sessionId.slice(0, 8),
			orgId: orgId.slice(0, 8),
			error: err instanceof Error ? err.message : String(err),
		});
		return { envVars: {}, warnings: [] };
	}
}
