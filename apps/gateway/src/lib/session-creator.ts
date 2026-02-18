/**
 * Session Creator
 *
 * Handles session creation logic including:
 * - Creating session record in database
 * - Optionally creating sandbox immediately
 * - Setting up environment variables and secrets
 * - Generating LLM proxy JWT
 */

import { createLogger } from "@proliferate/logger";
import {
	automations,
	baseSnapshots,
	billing,
	configurations,
	integrations,
	sessions,
} from "@proliferate/services";
import {
	type ModelId,
	type RepoSpec,
	type SandboxProvider,
	getDefaultAgentConfig,
	isValidModelId,
	parseModelId,
	resolveSnapshotId,
} from "@proliferate/shared";
import { getModalAppName } from "@proliferate/shared/providers";
import {
	computeBaseSnapshotVersionKey,
	parseServiceCommands,
	resolveServiceCommands,
} from "@proliferate/shared/sandbox";
import type { GatewayEnv } from "./env";
import { type GitHubIntegration, getGitHubTokenForIntegration } from "./github-auth";

const logger = createLogger({ service: "gateway" }).child({ module: "session-creator" });

export type SessionType = "coding" | "setup" | "cli";
export type ClientType = "web" | "slack" | "cli" | "automation";
export type SandboxMode = "immediate" | "deferred";

export interface CreateSessionOptions {
	env: GatewayEnv;
	provider: SandboxProvider;

	// Required
	organizationId: string;
	configurationId: string;
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
	configurationId: string;
	status: "pending" | "starting" | "running";
	hasSnapshot: boolean;
	isNewConfiguration: boolean;
	sandbox?: {
		sandboxId: string;
		previewUrl: string | null;
		sshHost?: string;
		sshPort?: number;
	};
	/** Warnings for integrations that failed token resolution. */
	integrationWarnings?: IntegrationWarning[];
}

interface ConfigurationRepoRow {
	workspacePath: string;
	repo: {
		id: string;
		githubUrl: string;
		githubRepoName: string;
		defaultBranch: string | null;
		serviceCommands?: unknown;
	} | null;
}

/**
 * Create a new session
 */
export async function createSession(
	options: CreateSessionOptions,
	isNewConfiguration = false,
): Promise<CreateSessionResult> {
	const {
		env,
		provider,
		organizationId,
		configurationId,
		sessionType,
		clientType,
		userId,
		snapshotId: inputSnapshotId,
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
	const startMs = Date.now();

	const log = logger.child({ sessionId });
	log.info(
		{
			sessionType,
			clientType,
			sandboxMode,
			hasSnapshot: Boolean(inputSnapshotId),
			sshEnabled: Boolean(sshOptions),
			explicitIntegrations: explicitIntegrationIds?.length ?? 0,
		},
		"Creating session",
	);
	log.debug(
		{ isNewConfiguration, hasSnapshotId: Boolean(inputSnapshotId) },
		"session_creator.create_session.start",
	);

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
			log.debug(
				{
					durationMs: Date.now() - listStartMs,
					automationId,
					connectionCount: automationConnections.length,
				},
				"session_creator.create_session.integration_ids.resolve",
			);
			resolvedIntegrationIds = automationConnections
				.filter((c) => c.integration?.status === "active")
				.map((c) => c.integrationId);
		} catch (err) {
			log.warn({ err }, "Failed to load automation connections");
		}
	}

	// Resolve snapshotId via layering (configuration snapshot → repo snapshot → null).
	// Repo snapshots are only eligible for Modal provider, non-CLI sessions.
	let snapshotId = inputSnapshotId ?? null;
	if (!snapshotId && provider.type === "modal" && sessionType !== "cli") {
		try {
			const configurationRepoRows =
				await configurations.getConfigurationReposWithDetails(configurationId);
			snapshotId = resolveSnapshotId({
				configurationSnapshotId: null,
				sandboxProvider: provider.type,
				configurationRepos: configurationRepoRows,
			});
			if (snapshotId) {
				log.info({ snapshotId }, "Using repo snapshot");
			}
		} catch (err) {
			log.warn({ err }, "Failed to resolve repo snapshot (non-fatal)");
		}
	}

	// Create session record via services (with atomic concurrent admission guard)
	try {
		const dbStartMs = Date.now();
		const sessionInput = {
			id: sessionId,
			configurationId,
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
		};

		const planLimits = await billing.getOrgPlanLimits(organizationId);
		if (planLimits) {
			const { created } = await sessions.createWithAdmissionGuard(
				sessionInput,
				planLimits.maxConcurrentSessions,
			);
			if (!created) {
				throw new Error(
					`Concurrent session limit reached. Your plan allows ${planLimits.maxConcurrentSessions} concurrent session${planLimits.maxConcurrentSessions === 1 ? "" : "s"}.`,
				);
			}
		} else {
			await sessions.create(sessionInput);
		}
		log.debug({ durationMs: Date.now() - dbStartMs }, "session_creator.create_session.db.create");
	} catch (err) {
		log.error({ err, durationMs: Date.now() - startMs }, "Failed to create session");
		throw new Error(
			`Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Create session connections (record which integrations are associated)
	if (resolvedIntegrationIds.length > 0) {
		try {
			const connectionsStartMs = Date.now();
			await sessions.createSessionConnections(sessionId, resolvedIntegrationIds);
			log.debug(
				{
					durationMs: Date.now() - connectionsStartMs,
					connectionCount: resolvedIntegrationIds.length,
				},
				"session_creator.create_session.db.create_connections",
			);
			log.info({ connectionCount: resolvedIntegrationIds.length }, "Recorded session connections");
		} catch (err) {
			log.warn({ err }, "Failed to record session connections");
		}
	}

	log.info("Session record created");

	// If deferred, return immediately
	if (effectiveSandboxMode === "deferred") {
		log.info(
			{ durationMs: Date.now() - startMs, mode: "deferred" },
			"session_creator.create_session.complete",
		);
		return {
			sessionId,
			configurationId,
			status: "pending",
			hasSnapshot: Boolean(snapshotId),
			isNewConfiguration,
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
			configurationId,
			organizationId,
			sessionType,
			userId,
			snapshotId,
			agentConfig,
			integrationIds: resolvedIntegrationIds,
			triggerContext,
			sshOptions,
		});
		log.debug(
			{
				provider: provider.type,
				durationMs: Date.now() - createSandboxStartMs,
				hasTunnelUrl: Boolean(result.tunnelUrl),
				hasPreviewUrl: Boolean(result.previewUrl),
				sshEnabled: Boolean(sshOptions),
				warningCount: result.integrationWarnings.length,
			},
			"session_creator.create_session.create_sandbox",
		);
		integrationWarnings = result.integrationWarnings;

		// Update session with sandbox info
		const updateStartMs = Date.now();
		await sessions.update(sessionId, {
			status: "running",
			sandboxId: result.sandboxId,
			openCodeTunnelUrl: result.tunnelUrl || null,
			previewTunnelUrl: result.previewUrl,
		});
		log.debug(
			{ durationMs: Date.now() - updateStartMs },
			"session_creator.create_session.db.update_session",
		);

		log.info(
			{ durationMs: Date.now() - startMs, mode: "immediate" },
			"session_creator.create_session.complete",
		);
		return {
			sessionId,
			configurationId,
			status: "running",
			hasSnapshot: Boolean(snapshotId),
			isNewConfiguration,
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
		log.error({ err }, "Sandbox creation failed");
		const deleteStartMs = Date.now();
		await sessions.deleteById(sessionId, organizationId);
		log.debug(
			{ durationMs: Date.now() - deleteStartMs },
			"session_creator.create_session.cleanup.delete_session",
		);
		log.debug({ durationMs: Date.now() - startMs }, "session_creator.create_session.error");
		throw err;
	}
}

interface CreateSandboxParams {
	env: GatewayEnv;
	provider: SandboxProvider;
	sessionId: string;
	configurationId: string;
	organizationId: string;
	sessionType: SessionType;
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
		configurationId,
		organizationId,
		sessionType,
		userId,
		snapshotId,
		agentConfig,
		integrationIds,
		triggerContext,
		sshOptions,
	} = params;

	const startMs = Date.now();
	const log = logger.child({ sessionId });
	log.debug(
		{
			provider: provider.type,
			hasSnapshotId: Boolean(snapshotId),
			sshEnabled: Boolean(sshOptions),
			explicitIntegrationCount: integrationIds?.length ?? 0,
		},
		"session_creator.create_sandbox.start",
	);

	// Resolve base snapshot from DB for Modal provider
	let baseSnapshotId: string | undefined;
	if (provider.type === "modal") {
		try {
			const versionKey = computeBaseSnapshotVersionKey();
			const modalAppName = getModalAppName();
			const dbSnapshotId = await baseSnapshots.getReadySnapshotId(
				versionKey,
				"modal",
				modalAppName,
			);
			if (dbSnapshotId) {
				baseSnapshotId = dbSnapshotId;
				log.info(
					{ baseSnapshotId, versionKey: versionKey.slice(0, 12) },
					"Base snapshot resolved from DB",
				);
			} else {
				log.debug(
					{ versionKey: versionKey.slice(0, 12) },
					"No ready base snapshot in DB, using env fallback",
				);
			}
		} catch (err) {
			log.warn({ err }, "Failed to resolve base snapshot from DB (non-fatal)");
		}
	}

	// SSH public key (concatenate all keys for authorized_keys)
	const sshPublicKey = sshOptions?.publicKeys?.join("\n");

	// Resolve integration tokens
	const integrationsStartMs = Date.now();
	const { envVars: integrationEnvVars, warnings: integrationWarnings } =
		await resolveIntegrationEnvVars(sessionId, organizationId, integrationIds);
	log.debug(
		{
			durationMs: Date.now() - integrationsStartMs,
			envKeyCount: Object.keys(integrationEnvVars).length,
			warningCount: integrationWarnings.length,
		},
		"session_creator.create_sandbox.integration_env_vars",
	);

	// For CLI/SSH sessions, we don't need to load repos (sync via rsync)
	if (sshOptions) {
		const envStartMs = Date.now();
		const baseEnvResult = await sessions.buildSandboxEnvVars({
			sessionId,
			orgId: organizationId,
			repoIds: [],
			repoSpecs: [],
			requireProxy: process.env.LLM_PROXY_REQUIRED === "true",
			directApiKey: env.anthropicApiKey,
		});
		log.debug(
			{
				durationMs: Date.now() - envStartMs,
				envKeyCount: Object.keys(baseEnvResult.envVars).length,
			},
			"session_creator.create_sandbox.env_vars",
		);
		const mergedEnvVars = {
			...baseEnvResult.envVars,
			...(process.env.ACTIONS_PLANE_LEGACY_TOKENS === "true" ? integrationEnvVars : {}),
			...(sshOptions.envVars || {}),
		};

		const providerStartMs = Date.now();
		const result = await provider.createSandbox({
			sessionId,
			sessionType,
			repos: [],
			branch: "main",
			envVars: mergedEnvVars,
			systemPrompt: "CLI terminal session",
			snapshotId: snapshotId || undefined,
			baseSnapshotId,
			sshPublicKey,
			triggerContext,
		});
		log.debug(
			{
				provider: provider.type,
				durationMs: Date.now() - providerStartMs,
				isSsh: true,
				hasTunnelUrl: Boolean(result.tunnelUrl),
				hasPreviewUrl: Boolean(result.previewUrl),
			},
			"session_creator.create_sandbox.provider.create_sandbox",
		);

		log.info(
			{ durationMs: Date.now() - startMs, isSsh: true },
			"session_creator.create_sandbox.complete",
		);
		return {
			sandboxId: result.sandboxId,
			previewUrl: result.previewUrl,
			sshHost: result.sshHost,
			sshPort: result.sshPort,
			integrationWarnings,
		};
	}

	// Load configuration repos for coding sessions
	const configStartMs = Date.now();
	const configurationRepoRows =
		await configurations.getConfigurationReposWithDetails(configurationId);
	log.info(
		{
			durationMs: Date.now() - configStartMs,
			count: configurationRepoRows?.length ?? 0,
			repos: configurationRepoRows?.map((r) => r.repo?.githubRepoName).filter(Boolean),
		},
		"session_creator.create_sandbox.configuration_repos",
	);

	if (!configurationRepoRows || configurationRepoRows.length === 0) {
		throw new Error("Configuration has no associated repos");
	}

	// Filter out repos with null values and convert to expected shape
	const typedConfigurationRepos: ConfigurationRepoRow[] = configurationRepoRows
		.filter((pr) => pr.repo !== null)
		.map((pr) => ({
			workspacePath: pr.workspacePath,
			repo: pr.repo,
		}));

	if (typedConfigurationRepos.length === 0) {
		throw new Error("Configuration has no associated repos");
	}

	// Resolve GitHub tokens for each repo
	const githubStartMs = Date.now();
	const repoSpecs: RepoSpec[] = await Promise.all(
		typedConfigurationRepos.map(async (pr) => {
			const token = await resolveGitHubToken(env, organizationId, pr.repo!.id, userId);
			const serviceCommands = parseServiceCommands(pr.repo!.serviceCommands);
			return {
				repoUrl: pr.repo!.githubUrl,
				token,
				workspacePath: pr.workspacePath,
				repoId: pr.repo!.id,
				...(serviceCommands.length > 0 ? { serviceCommands } : {}),
			};
		}),
	);
	log.info(
		{
			durationMs: Date.now() - githubStartMs,
			repoCount: repoSpecs.length,
			tokensPresent: repoSpecs.filter((r) => Boolean(r.token)).length,
			repos: repoSpecs.map((r) => ({
				url: r.repoUrl,
				hasToken: Boolean(r.token),
				workspacePath: r.workspacePath,
			})),
		},
		"session_creator.create_sandbox.github_tokens",
	);

	// Derive snapshotHasDeps: true when snapshot includes installed deps.
	// Repo snapshots (clone-only) don't have deps; configuration/session/pause snapshots do.
	const repoSnapshotFallback =
		configurationRepoRows.length === 1 &&
		configurationRepoRows[0].repo?.repoSnapshotStatus === "ready" &&
		configurationRepoRows[0].repo?.repoSnapshotId
			? configurationRepoRows[0].repo.repoSnapshotId
			: null;
	const snapshotHasDeps = Boolean(snapshotId) && snapshotId !== repoSnapshotFallback;

	// Resolve service commands: configuration-level first, then per-repo fallback
	const configSvcRow = await configurations.getConfigurationServiceCommands(configurationId);
	const resolvedServiceCommands = resolveServiceCommands(configSvcRow?.serviceCommands, repoSpecs);

	// Load env file generation spec (if configured)
	const configEnvFiles = await configurations.getConfigurationEnvFiles(configurationId);
	const configList = Array.isArray(configEnvFiles) ? configEnvFiles : [];
	const envFiles = configList.length > 0 ? configList : undefined;

	// Build environment variables
	const envStartMs = Date.now();
	const envVars = await loadEnvironmentVariables(
		env,
		sessionId,
		organizationId,
		typedConfigurationRepos.map((pr) => pr.repo!.id),
		repoSpecs,
		integrationEnvVars,
	);
	log.debug(
		{
			durationMs: Date.now() - envStartMs,
			envKeyCount: Object.keys(envVars).length,
		},
		"session_creator.create_sandbox.env_vars",
	);

	// Build system prompt
	const primaryRepo = typedConfigurationRepos[0].repo!;
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
		sessionType,
		repos: repoSpecs,
		branch: primaryRepo.defaultBranch || "main",
		envVars,
		systemPrompt,
		snapshotId: snapshotId || undefined,
		baseSnapshotId,
		agentConfig: agentConfig
			? {
					agentType: "opencode" as const,
					modelId,
				}
			: undefined,
		sshPublicKey,
		triggerContext,
		snapshotHasDeps,
		serviceCommands: resolvedServiceCommands.length > 0 ? resolvedServiceCommands : undefined,
		envFiles,
	});
	log.debug(
		{
			provider: provider.type,
			durationMs: Date.now() - providerStartMs,
			isSsh: Boolean(sshOptions),
			hasTunnelUrl: Boolean(result.tunnelUrl),
			hasPreviewUrl: Boolean(result.previewUrl),
		},
		"session_creator.create_sandbox.provider.create_sandbox",
	);

	log.info(
		{ durationMs: Date.now() - startMs, isSsh: Boolean(sshOptions) },
		"session_creator.create_sandbox.complete",
	);
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
		...(process.env.ACTIONS_PLANE_LEGACY_TOKENS === "true" ? integrationEnvVars : {}),
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
		logger.warn({ err }, "Failed to resolve GitHub token");
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
		const log = logger.child({ sessionId });
		log.debug(
			{ integrationCount: integrationIds.length },
			"session_creator.integration_tokens.start",
		);
		// Fetch integration details for token resolution
		const fetchStartMs = Date.now();
		const integrationsForTokens = await integrations.getIntegrationsForTokens(
			integrationIds,
			orgId,
		);
		log.debug(
			{ durationMs: Date.now() - fetchStartMs, count: integrationsForTokens.length },
			"session_creator.integration_tokens.fetch",
		);

		// Resolve tokens
		const resolveStartMs = Date.now();
		const { tokens, errors } = await integrations.resolveTokens(integrationsForTokens);
		log.debug(
			{
				durationMs: Date.now() - resolveStartMs,
				tokenCount: tokens.length,
				errorCount: errors.length,
			},
			"session_creator.integration_tokens.resolve",
		);

		// Build env vars
		const envVars: Record<string, string> = {};
		for (const token of tokens) {
			const envVarName = integrations.getEnvVarName(token.integrationTypeId, token.integrationId);
			envVars[envVarName] = token.token;
			log.info({ envVarName: envVarName.replace(/_[^_]+$/, "_***") }, "Injected integration token");
		}

		// Convert errors to warnings
		const warnings: IntegrationWarning[] = errors.map((e) => ({
			integrationId: e.integrationId,
			message: e.message,
		}));

		if (warnings.length > 0) {
			log.warn(
				{ warningCount: warnings.length, warnings: warnings.map((w) => w.message) },
				"Failed to resolve integration tokens",
			);
		}

		log.debug(
			{
				durationMs: Date.now() - startMs,
				envKeyCount: Object.keys(envVars).length,
				warningCount: warnings.length,
			},
			"session_creator.integration_tokens.complete",
		);
		return { envVars, warnings };
	} catch (err) {
		logger.error({ err, sessionId }, "Error resolving integration tokens");
		return { envVars: {}, warnings: [] };
	}
}
