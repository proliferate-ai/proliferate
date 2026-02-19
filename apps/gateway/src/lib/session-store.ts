import { createLogger } from "@proliferate/logger";
import { cli, configurations, integrations, sessions } from "@proliferate/services";
import {
	type AgentConfig,
	type ModelId,
	type RepoSpec,
	getAutomationSystemPrompt,
	getCodingSystemPrompt,
	getDefaultAgentConfig,
	getScratchSystemPrompt,
	getSetupSystemPrompt,
	isValidModelId,
	parseModelId,
} from "@proliferate/shared";
import type { ConfigurationServiceCommand } from "@proliferate/shared";
import { parseServiceCommands, resolveServiceCommands } from "@proliferate/shared/sandbox";
import type { GatewayEnv } from "./env";
import { type GitHubIntegration, getGitHubTokenForIntegration } from "./github-auth";

const logger = createLogger({ service: "gateway" }).child({ module: "session-store" });

export interface RepoRecord {
	id: string;
	github_url: string;
	github_repo_name: string;
	default_branch: string | null;
	service_commands?: unknown;
}

export interface SessionRecord {
	id: string;
	organization_id: string;
	created_by: string | null;
	configuration_id: string | null;
	session_type: string | null;
	sandbox_id: string | null;
	sandbox_provider: string | null;
	snapshot_id: string | null;
	sandbox_expires_at?: string | null;
	branch_name: string | null;
	base_commit_sha: string | null;
	coding_agent_session_id?: string | null;
	open_code_tunnel_url?: string | null;
	preview_tunnel_url?: string | null;
	agent_config?: { modelId?: string; tools?: string[]; reasoningEffort?: string } | null;
	system_prompt?: string | null;
	status?: string | null;
	client_type?: string | null;
	client_metadata?: unknown | null;
}

export interface SessionContext {
	session: SessionRecord;
	repos: RepoSpec[];
	primaryRepo: RepoRecord;
	systemPrompt: string;
	agentConfig: AgentConfig & { tools?: string[] };
	envVars: Record<string, string>;
	/** SSH public key for CLI sessions (for rsync access) */
	sshPublicKey?: string;
	/** True if the snapshot includes installed dependencies. Gates service command auto-start. */
	snapshotHasDeps: boolean;
	/** Resolved service commands (configuration-level or fallback from repos). */
	serviceCommands?: ConfigurationServiceCommand[];
}

interface ConfigurationRepoRow {
	workspace_path: string;
	repo: RepoRecord;
}

function buildSystemPrompt(
	sessionType: string | null,
	repoName: string,
	clientType: string | null,
): string {
	if (sessionType === "setup") {
		return getSetupSystemPrompt(repoName);
	}
	if (clientType === "automation") {
		return getAutomationSystemPrompt(repoName);
	}
	return getCodingSystemPrompt(repoName);
}

export async function loadSessionContext(
	env: GatewayEnv,
	sessionId: string,
): Promise<SessionContext> {
	const startMs = Date.now();
	const log = logger.child({ sessionId });
	log.debug("store.load_context.start");

	// Load session without repo relationship (repos now come from configuration_repos)
	log.info("Loading session from database...");
	const sessionRowStartMs = Date.now();
	const sessionRow = await sessions.findByIdInternal(sessionId);
	log.debug(
		{ durationMs: Date.now() - sessionRowStartMs, found: Boolean(sessionRow) },
		"store.load_context.session_row",
	);

	if (!sessionRow) {
		log.warn("Session not found");
		throw new Error("Session not found");
	}

	// Convert from camelCase to snake_case for SessionRecord compatibility
	const session: SessionRecord = {
		id: sessionRow.id,
		organization_id: sessionRow.organizationId,
		created_by: sessionRow.createdBy,
		configuration_id: sessionRow.configurationId,
		session_type: sessionRow.sessionType,
		sandbox_id: sessionRow.sandboxId,
		sandbox_provider: sessionRow.sandboxProvider,
		snapshot_id: sessionRow.snapshotId,
		sandbox_expires_at: sessionRow.sandboxExpiresAt?.toISOString() ?? null,
		branch_name: sessionRow.branchName,
		base_commit_sha: sessionRow.baseCommitSha,
		coding_agent_session_id: sessionRow.codingAgentSessionId,
		open_code_tunnel_url: sessionRow.openCodeTunnelUrl,
		preview_tunnel_url: sessionRow.previewTunnelUrl,
		agent_config: sessionRow.agentConfig as SessionRecord["agent_config"],
		system_prompt: sessionRow.systemPrompt,
		status: sessionRow.status,
		client_type: sessionRow.clientType,
		client_metadata: sessionRow.clientMetadata,
	};

	log.info(
		{
			configurationId: session.configuration_id,
			sandboxId: session.sandbox_id,
			status: session.status,
			sessionType: session.session_type,
		},
		"Session loaded",
	);

	// Scratch session: no configuration, no repos — boot from base snapshot only
	if (!session.configuration_id) {
		log.info("Scratch session (no configuration)");

		const scratchPrimaryRepo: RepoRecord = {
			id: "scratch",
			github_url: "",
			github_repo_name: "scratch",
			default_branch: "main",
		};

		const defaultAgentConfig = getDefaultAgentConfig();
		const rawModelId = session.agent_config?.modelId;
		const modelId: ModelId =
			rawModelId && isValidModelId(rawModelId)
				? rawModelId
				: rawModelId
					? parseModelId(rawModelId)
					: defaultAgentConfig.modelId;

		const envVars = await loadEnvironmentVariables(
			env,
			session.id,
			session.organization_id,
			[],
			[],
		);

		log.info("Scratch session context ready");
		log.debug({ durationMs: Date.now() - startMs }, "store.load_context.complete");
		return {
			session,
			repos: [],
			primaryRepo: scratchPrimaryRepo,
			systemPrompt: session.system_prompt || getScratchSystemPrompt(),
			agentConfig: {
				agentType: "opencode" as const,
				modelId,
				tools: session.agent_config?.tools,
				...(session.agent_config?.reasoningEffort && {
					reasoningEffort: session.agent_config.reasoningEffort as AgentConfig["reasoningEffort"],
				}),
			},
			envVars,
			snapshotHasDeps: false,
		};
	}

	// Configuration-backed session: load repos, tokens, service commands
	log.info(
		{ configurationId: session.configuration_id },
		"Loading repos from configuration_repos...",
	);
	const configurationReposStartMs = Date.now();
	const configurationRepoRows = await configurations.getConfigurationReposWithDetails(
		session.configuration_id,
	);
	log.debug(
		{
			durationMs: Date.now() - configurationReposStartMs,
			count: configurationRepoRows?.length ?? 0,
		},
		"store.load_context.configuration_repos",
	);

	if (!configurationRepoRows || configurationRepoRows.length === 0) {
		log.warn("Configuration has no repos");
		throw new Error("Configuration has no associated repos");
	}

	// Convert to the expected shape
	const typedConfigurationRepos: ConfigurationRepoRow[] = configurationRepoRows
		.filter((pr) => pr.repo !== null)
		.map((pr) => ({
			workspace_path: pr.workspacePath,
			repo: {
				id: pr.repo!.id,
				github_url: pr.repo!.githubUrl,
				github_repo_name: pr.repo!.githubRepoName,
				default_branch: pr.repo!.defaultBranch,
				service_commands: pr.repo!.serviceCommands,
			},
		}));

	log.info(
		{
			count: typedConfigurationRepos.length,
			repos: typedConfigurationRepos.map((pr) => ({
				name: pr.repo.github_repo_name,
				path: pr.workspace_path,
			})),
		},
		"Configuration repos loaded",
	);

	// Primary repo (first one) for system prompt context
	const primaryRepo = typedConfigurationRepos[0].repo;

	// Resolve GitHub token for each repo (may differ per installation)
	log.info("Resolving GitHub tokens for repos...");
	const tokenResolutionStartMs = Date.now();
	const repoSpecs: RepoSpec[] = await Promise.all(
		typedConfigurationRepos.map(async (pr) => {
			const token = await resolveGitHubToken(
				env,
				session.organization_id,
				pr.repo.id,
				session.created_by,
			);
			log.info(
				{ repo: pr.repo.github_repo_name, hasToken: Boolean(token) },
				"Token resolved for repo",
			);
			const serviceCommands = parseServiceCommands(pr.repo.service_commands);
			return {
				repoUrl: pr.repo.github_url,
				token,
				workspacePath: pr.workspace_path,
				repoId: pr.repo.id,
				...(serviceCommands.length > 0 ? { serviceCommands } : {}),
			};
		}),
	);
	log.debug(
		{
			durationMs: Date.now() - tokenResolutionStartMs,
			repoCount: repoSpecs.length,
			tokensPresent: repoSpecs.filter((r) => Boolean(r.token)).length,
		},
		"store.load_context.github_tokens",
	);

	const systemPrompt =
		session.system_prompt ||
		buildSystemPrompt(
			session.session_type,
			primaryRepo.github_repo_name,
			session.client_type ?? null,
		);

	const defaultAgentConfig = getDefaultAgentConfig();
	const rawModelId = session.agent_config?.modelId;
	const modelId: ModelId =
		rawModelId && isValidModelId(rawModelId)
			? rawModelId
			: rawModelId
				? parseModelId(rawModelId)
				: defaultAgentConfig.modelId;
	const agentConfig = {
		agentType: "opencode" as const,
		modelId,
		tools: session.agent_config?.tools,
		...(session.agent_config?.reasoningEffort && {
			reasoningEffort: session.agent_config.reasoningEffort as AgentConfig["reasoningEffort"],
		}),
	};

	// Load env vars for all repos in the configuration
	const repoIds = typedConfigurationRepos.map((pr) => pr.repo.id);
	log.info({ repoIds }, "Loading environment variables...");
	const envVarsStartMs = Date.now();
	const envVars = await loadEnvironmentVariables(
		env,
		session.id,
		session.organization_id,
		repoIds,
		repoSpecs,
	);
	log.debug(
		{
			durationMs: Date.now() - envVarsStartMs,
			keyCount: Object.keys(envVars).length,
		},
		"store.load_context.env_vars",
	);
	log.info(
		{
			count: Object.keys(envVars).length,
			keys: Object.keys(envVars).filter((k) => k !== "ANTHROPIC_API_KEY"),
		},
		"Environment variables loaded",
	);

	// Load SSH public key for CLI sessions
	let sshPublicKey: string | undefined;
	if (session.session_type === "cli" && session.created_by) {
		log.info("Loading SSH public key for CLI session...");
		const sshStartMs = Date.now();
		const sshKeys = await cli.getSshPublicKeys(session.created_by);
		log.debug(
			{ durationMs: Date.now() - sshStartMs, count: sshKeys?.length ?? 0 },
			"store.load_context.ssh_keys",
		);

		const publicKey = sshKeys?.[0];
		if (publicKey) {
			sshPublicKey = publicKey;
			log.info({ fingerprint: `${publicKey.slice(0, 50)}...` }, "SSH public key loaded");
		} else {
			log.info("No SSH public key found for user");
		}
	}

	// Derive snapshotHasDeps: true only when snapshot includes installed deps.
	// - Pause snapshots always have deps (they capture full state after user work).
	// - "default" configuration snapshots are clone-only (no deps).
	// - "ready" configuration snapshots have deps.
	// - Legacy repo snapshots don't have deps.
	const wasPaused = Boolean(sessionRow.pausedAt);
	const repoSnapshotFallback =
		configurationRepoRows.length === 1 &&
		configurationRepoRows[0].repo?.repoSnapshotStatus === "ready" &&
		configurationRepoRows[0].repo?.repoSnapshotId
			? configurationRepoRows[0].repo.repoSnapshotId
			: null;
	let snapshotHasDeps: boolean;
	if (!session.snapshot_id) {
		snapshotHasDeps = false;
	} else if (session.snapshot_id === repoSnapshotFallback) {
		snapshotHasDeps = false;
	} else if (wasPaused) {
		// Pause snapshot always captures full state (deps installed, env applied)
		snapshotHasDeps = true;
	} else {
		// Creation snapshot — check current configuration status
		const configInfo = await configurations.findByIdForSession(session.configuration_id);
		snapshotHasDeps = configInfo?.status === "ready";
	}

	// Resolve service commands: configuration-level first, then per-repo fallback
	const configSvcRow = await configurations.getConfigurationServiceCommands(
		session.configuration_id,
	);
	const resolvedServiceCommands = resolveServiceCommands(configSvcRow?.serviceCommands, repoSpecs);

	log.info("Session context ready");
	log.debug(
		{ durationMs: Date.now() - startMs, repoCount: repoSpecs.length, snapshotHasDeps },
		"store.load_context.complete",
	);
	return {
		session,
		repos: repoSpecs,
		primaryRepo,
		systemPrompt,
		agentConfig,
		envVars,
		sshPublicKey,
		snapshotHasDeps,
		serviceCommands: resolvedServiceCommands.length > 0 ? resolvedServiceCommands : undefined,
	};
}

async function loadEnvironmentVariables(
	env: GatewayEnv,
	sessionId: string,
	orgId: string,
	repoIds: string[],
	repoSpecs: RepoSpec[],
): Promise<Record<string, string>> {
	const result = await sessions.buildSandboxEnvVars({
		sessionId,
		orgId,
		repoIds,
		repoSpecs,
		requireProxy: process.env.LLM_PROXY_REQUIRED === "true",
		directApiKey: env.anthropicApiKey,
	});

	return result.envVars;
}

async function resolveGitHubToken(
	env: GatewayEnv,
	orgId: string,
	repoId: string,
	userId: string | null,
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
