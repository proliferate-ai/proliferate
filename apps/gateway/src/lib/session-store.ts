import { cli, integrations, prebuilds, sessions } from "@proliferate/services";
import {
	type AgentConfig,
	type ModelId,
	type RepoSpec,
	getAutomationSystemPrompt,
	getCodingSystemPrompt,
	getDefaultAgentConfig,
	getSetupSystemPrompt,
	isValidModelId,
} from "@proliferate/shared";
import type { GatewayEnv } from "./env";
import { type GitHubIntegration, getGitHubTokenForIntegration } from "./github-auth";

export interface RepoRecord {
	id: string;
	github_url: string;
	github_repo_name: string;
	default_branch: string | null;
}

export interface SessionRecord {
	id: string;
	organization_id: string;
	created_by: string | null;
	prebuild_id: string | null;
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
	agent_config?: { modelId?: string; tools?: string[] } | null;
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
}

interface PrebuildRepoRow {
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
	const shortId = sessionId.slice(0, 8);
	const startMs = Date.now();
	console.log("[P-LATENCY] store.load_context.start", { sessionId, shortId });
	const log = (msg: string, data?: Record<string, unknown>) => {
		const dataStr = data ? ` ${JSON.stringify(data)}` : "";
		console.log(`[Store:${shortId}] ${msg}${dataStr}`);
	};

	// Load session without repo relationship (repos now come from prebuild_repos)
	log("Loading session from database...", { fullSessionId: sessionId, idLength: sessionId.length });
	const sessionRowStartMs = Date.now();
	const sessionRow = await sessions.findByIdInternal(sessionId);
	console.log("[P-LATENCY] store.load_context.session_row", {
		sessionId,
		shortId,
		durationMs: Date.now() - sessionRowStartMs,
		found: Boolean(sessionRow),
	});

	if (!sessionRow) {
		log("Session not found", { fullId: sessionId });
		throw new Error("Session not found");
	}

	// Convert from camelCase to snake_case for SessionRecord compatibility
	const session: SessionRecord = {
		id: sessionRow.id,
		organization_id: sessionRow.organizationId,
		created_by: sessionRow.createdBy,
		prebuild_id: sessionRow.prebuildId,
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

	log("Session loaded", {
		prebuildId: session.prebuild_id,
		sandboxId: session.sandbox_id,
		status: session.status,
		sessionType: session.session_type,
	});

	if (!session.prebuild_id) {
		throw new Error("Session has no associated prebuild");
	}

	// Load repos via prebuild_repos junction table
	log("Loading repos from prebuild_repos...", { prebuildId: session.prebuild_id });
	const prebuildReposStartMs = Date.now();
	const prebuildRepoRows = await prebuilds.getPrebuildReposWithDetails(session.prebuild_id);
	console.log("[P-LATENCY] store.load_context.prebuild_repos", {
		sessionId,
		shortId,
		durationMs: Date.now() - prebuildReposStartMs,
		count: prebuildRepoRows?.length ?? 0,
	});

	if (!prebuildRepoRows || prebuildRepoRows.length === 0) {
		log("Prebuild has no repos");
		throw new Error("Prebuild has no associated repos");
	}

	// Convert to the expected shape
	const typedPrebuildRepos: PrebuildRepoRow[] = prebuildRepoRows
		.filter((pr) => pr.repo !== null)
		.map((pr) => ({
			workspace_path: pr.workspacePath,
			repo: {
				id: pr.repo!.id,
				github_url: pr.repo!.githubUrl,
				github_repo_name: pr.repo!.githubRepoName,
				default_branch: pr.repo!.defaultBranch,
			},
		}));

	log("Prebuild repos loaded", {
		count: typedPrebuildRepos.length,
		repos: typedPrebuildRepos.map((pr) => ({
			name: pr.repo.github_repo_name,
			path: pr.workspace_path,
		})),
	});

	// Primary repo (first one) for system prompt context
	const primaryRepo = typedPrebuildRepos[0].repo;

	// Resolve GitHub token for each repo (may differ per installation)
	log("Resolving GitHub tokens for repos...");
	const tokenResolutionStartMs = Date.now();
	const repoSpecs: RepoSpec[] = await Promise.all(
		typedPrebuildRepos.map(async (pr) => {
			const token = await resolveGitHubToken(
				env,
				session.organization_id,
				pr.repo.id,
				session.created_by,
			);
			log("Token resolved for repo", {
				repo: pr.repo.github_repo_name,
				hasToken: Boolean(token),
			});
			return {
				repoUrl: pr.repo.github_url,
				token,
				workspacePath: pr.workspace_path,
				repoId: pr.repo.id,
			};
		}),
	);
	console.log("[P-LATENCY] store.load_context.github_tokens", {
		sessionId,
		shortId,
		durationMs: Date.now() - tokenResolutionStartMs,
		repoCount: repoSpecs.length,
		tokensPresent: repoSpecs.filter((r) => Boolean(r.token)).length,
	});

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
		rawModelId && isValidModelId(rawModelId) ? rawModelId : defaultAgentConfig.modelId;
	const agentConfig = {
		agentType: "opencode" as const,
		modelId,
		tools: session.agent_config?.tools,
	};

	// Load env vars for all repos in the prebuild
	const repoIds = typedPrebuildRepos.map((pr) => pr.repo.id);
	log("Loading environment variables...", { repoIds });
	const envVarsStartMs = Date.now();
	const envVars = await loadEnvironmentVariables(
		env,
		session.id,
		session.organization_id,
		repoIds,
		repoSpecs,
	);
	console.log("[P-LATENCY] store.load_context.env_vars", {
		sessionId,
		shortId,
		durationMs: Date.now() - envVarsStartMs,
		keyCount: Object.keys(envVars).length,
	});
	log("Environment variables loaded", {
		count: Object.keys(envVars).length,
		keys: Object.keys(envVars).filter((k) => k !== "ANTHROPIC_API_KEY"),
	});

	// Load SSH public key for CLI sessions
	let sshPublicKey: string | undefined;
	if (session.session_type === "cli" && session.created_by) {
		log("Loading SSH public key for CLI session...");
		const sshStartMs = Date.now();
		const sshKeys = await cli.getSshPublicKeys(session.created_by);
		console.log("[P-LATENCY] store.load_context.ssh_keys", {
			sessionId,
			shortId,
			durationMs: Date.now() - sshStartMs,
			count: sshKeys?.length ?? 0,
		});

		const publicKey = sshKeys?.[0];
		if (publicKey) {
			sshPublicKey = publicKey;
			log("SSH public key loaded", { fingerprint: `${publicKey.slice(0, 50)}...` });
		} else {
			log("No SSH public key found for user");
		}
	}

	log("Session context ready");
	console.log("[P-LATENCY] store.load_context.complete", {
		sessionId,
		shortId,
		durationMs: Date.now() - startMs,
		repoCount: repoSpecs.length,
	});
	return {
		session,
		repos: repoSpecs,
		primaryRepo,
		systemPrompt,
		agentConfig,
		envVars,
		sshPublicKey,
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
		console.warn("Failed to resolve GitHub token:", err);
		return "";
	}
}
