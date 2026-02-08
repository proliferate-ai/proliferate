import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import { FileType, Sandbox, type SandboxApiOpts, type SandboxConnectOpts } from "e2b";
import { getDefaultAgentConfig, toOpencodeModelId } from "../agents";
import { getLLMProxyBaseURL } from "../llm-proxy";
import { getSharedLogger } from "../logger";
import {
	AUTOMATION_COMPLETE_DESCRIPTION,
	AUTOMATION_COMPLETE_TOOL,
	ENV_FILE,
	REQUEST_ENV_VARIABLES_DESCRIPTION,
	REQUEST_ENV_VARIABLES_TOOL,
	SAVE_SERVICE_COMMANDS_DESCRIPTION,
	SAVE_SERVICE_COMMANDS_TOOL,
	SAVE_SNAPSHOT_DESCRIPTION,
	SAVE_SNAPSHOT_TOOL,
	VERIFY_TOOL,
	VERIFY_TOOL_DESCRIPTION,
} from "../opencode-tools";
import {
	DEFAULT_CADDYFILE,
	ENV_INSTRUCTIONS,
	PLUGIN_MJS,
	SANDBOX_PATHS,
	SANDBOX_TIMEOUT_MS,
	SandboxProviderError,
	type SessionMetadata,
	capOutput,
	getOpencodeConfig,
	shellEscape,
	waitForOpenCodeReady,
} from "../sandbox";
import type {
	AutoStartOutputEntry,
	CreateSandboxOpts,
	CreateSandboxResult,
	EnsureSandboxResult,
	FileContent,
	PauseResult,
	PrebuildServiceCommand,
	SandboxProvider,
	SnapshotResult,
} from "../sandbox-provider";

/**
 * E2B Sandbox Provider
 *
 * Uses the E2B TypeScript SDK directly to manage sandboxes.
 * Provides full Docker support.
 *
 * Prerequisites:
 * 1. Build the template: `cd packages/e2b-sandbox && e2b template build`
 * 2. Set E2B_API_KEY environment variable
 *
 * For self-hosted E2B:
 * - Set E2B_DOMAIN to your custom domain (e.g., "e2b.company.com")
 * - Build template with: E2B_DOMAIN=e2b.company.com e2b template build
 */

// Configuration from environment
const E2B_TEMPLATE = env.E2B_TEMPLATE;
const E2B_DOMAIN = env.E2B_DOMAIN;

const providerLogger = getSharedLogger().child({ module: "e2b" });
const logLatency = (event: string, data?: Record<string, unknown>) => {
	providerLogger.info(data ?? {}, event);
};

const getE2BApiOpts = (): SandboxApiOpts => ({
	domain: E2B_DOMAIN,
});

const getE2BConnectOpts = (): SandboxConnectOpts => ({
	...getE2BApiOpts(),
	timeoutMs: SANDBOX_TIMEOUT_MS,
});

// Re-export shared configs for backwards compatibility with existing tests
export {
	DEFAULT_CADDYFILE,
	ENV_INSTRUCTIONS,
	PLUGIN_MJS,
	getOpencodeConfig,
	waitForOpenCodeReady,
} from "../sandbox";

export class E2BProvider implements SandboxProvider {
	readonly type = "e2b" as const;
	readonly supportsPause = true;
	readonly supportsAutoPause = true;

	async createSandbox(opts: CreateSandboxOpts): Promise<CreateSandboxResult> {
		const startTime = Date.now();
		const log = providerLogger.child({ sessionId: opts.sessionId });

		logLatency("provider.create_sandbox.start", {
			provider: this.type,
			sessionId: opts.sessionId,
			repoCount: opts.repos.length,
			hasSnapshotId: Boolean(opts.snapshotId),
			timeoutMs: SANDBOX_TIMEOUT_MS,
		});

		log.debug(
			{ repoCount: opts.repos.length, snapshotId: opts.snapshotId || "none" },
			"Creating session",
		);

		// LLM Proxy configuration - when set, sandboxes route through proxy instead of direct API
		// This avoids exposing real API keys in sandboxes
		const llmProxyBaseUrl = getLLMProxyBaseURL();
		const llmProxyApiKey = opts.envVars.LLM_PROXY_API_KEY; // Virtual key for this session

		// Build environment variables - don't include real API keys when using proxy
		const envs: Record<string, string> = {
			SESSION_ID: opts.sessionId,
		};

		// Only include ANTHROPIC_API_KEY if NOT using proxy (backward compatibility)
		if (llmProxyBaseUrl && llmProxyApiKey) {
			log.debug({ llmProxyBaseUrl, hasApiKey: !!llmProxyApiKey }, "Using LLM proxy");
			envs.ANTHROPIC_API_KEY = llmProxyApiKey;
			envs.ANTHROPIC_BASE_URL = llmProxyBaseUrl;
		} else {
			const hasDirectKey = !!opts.envVars.ANTHROPIC_API_KEY;
			log.warn({ hasDirectKey }, "No LLM proxy, using direct key");
			envs.ANTHROPIC_API_KEY = opts.envVars.ANTHROPIC_API_KEY || "";
		}

		// Add other env vars (but filter out sensitive keys when using proxy)
		for (const [key, value] of Object.entries(opts.envVars)) {
			// Skip proxy-specific and sensitive keys (they're handled separately)
			if (
				key === "ANTHROPIC_API_KEY" ||
				key === "LLM_PROXY_API_KEY" ||
				key === "ANTHROPIC_BASE_URL"
			)
				continue;
			envs[key] = value;
		}

		// Disable default OpenCode plugins for snapshot stability (parity with Modal)
		envs.OPENCODE_DISABLE_DEFAULT_PLUGINS = "true";

		let isSnapshot = !!opts.snapshotId;

		// Calculate expiration time before creating sandbox
		const sandboxCreatedAt = Date.now();

		// Build sandbox options (supports self-hosted via E2B_DOMAIN)
		const sandboxOpts: Parameters<typeof Sandbox.create>[1] = {
			timeoutMs: SANDBOX_TIMEOUT_MS,
			envs,
		};
		if (E2B_DOMAIN) {
			sandboxOpts.domain = E2B_DOMAIN;
		}

		let sandbox: Sandbox | null = null;

		if (isSnapshot) {
			try {
				// Resume from paused sandbox - connecting auto-resumes
				log.debug({ snapshotId: opts.snapshotId }, "Resuming from snapshot");
				const connectStartMs = Date.now();
				sandbox = await Sandbox.connect(opts.snapshotId!, getE2BConnectOpts());
				logLatency("provider.create_sandbox.resume.connect", {
					provider: this.type,
					sessionId: opts.sessionId,
					durationMs: Date.now() - connectStartMs,
				});
				log.debug({ sandboxId: sandbox.sandboxId }, "Sandbox resumed");

				// Re-inject environment variables (they don't persist across pause/resume)
				// Using JSON file approach to avoid shell escaping issues (security)
				log.debug("Re-injecting environment variables");
				let envsForProfile = { ...envs };
				if (llmProxyBaseUrl && llmProxyApiKey) {
					const {
						ANTHROPIC_API_KEY: _apiKey,
						ANTHROPIC_BASE_URL: _baseUrl,
						...rest
					} = envsForProfile;
					envsForProfile = rest;
				}
				const envWriteStartMs = Date.now();
				await sandbox.files.write(SANDBOX_PATHS.envProfileFile, JSON.stringify(envsForProfile));
				logLatency("provider.create_sandbox.resume.env_write", {
					provider: this.type,
					sessionId: opts.sessionId,
					keyCount: Object.keys(envsForProfile).length,
					durationMs: Date.now() - envWriteStartMs,
				});
				// Use jq to safely export env vars from JSON (handles special chars properly)
				const envExportStartMs = Date.now();
				await sandbox.commands.run(
					`for key in $(jq -r 'keys[]' ${SANDBOX_PATHS.envProfileFile}); do export "$key=$(jq -r --arg k "$key" '.[$k]' ${SANDBOX_PATHS.envProfileFile})"; done`,
					{ timeoutMs: 10000 },
				);
				logLatency("provider.create_sandbox.resume.env_export", {
					provider: this.type,
					sessionId: opts.sessionId,
					timeoutMs: 10000,
					durationMs: Date.now() - envExportStartMs,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				log.warn({ err }, "Snapshot resume failed, falling back to fresh sandbox");
				logLatency("provider.create_sandbox.resume.fallback", {
					provider: this.type,
					sessionId: opts.sessionId,
					error: message,
				});
				isSnapshot = false;
			}
		}

		if (!isSnapshot) {
			// Create fresh sandbox
			log.debug("Creating fresh sandbox (no snapshot)");
			if (!opts.repos || opts.repos.length === 0) {
				throw new Error("repos[] is required");
			}
			if (!E2B_TEMPLATE) {
				throw new Error("E2B_TEMPLATE is required to create a sandbox");
			}
			const createStartMs = Date.now();
			sandbox = await Sandbox.create(E2B_TEMPLATE, sandboxOpts);
			logLatency("provider.create_sandbox.fresh.create", {
				provider: this.type,
				sessionId: opts.sessionId,
				durationMs: Date.now() - createStartMs,
			});
			log.debug({ sandboxId: sandbox.sandboxId }, "Sandbox created");
		}

		if (!sandbox) {
			throw new Error("Failed to initialize sandbox");
		}

		// Setup the sandbox (clone repos or restore from snapshot)
		const setupWorkspaceStartMs = Date.now();
		const repoDir = await this.setupSandbox(sandbox, opts, isSnapshot, log);
		logLatency("provider.create_sandbox.setup_workspace", {
			provider: this.type,
			sessionId: opts.sessionId,
			isSnapshot,
			durationMs: Date.now() - setupWorkspaceStartMs,
		});

		// Setup essential dependencies (blocking - must complete before API returns)
		const setupEssentialStartMs = Date.now();
		await this.setupEssentialDependencies(
			sandbox,
			repoDir,
			opts,
			log,
			llmProxyBaseUrl,
			llmProxyApiKey,
		);
		logLatency("provider.create_sandbox.setup_essential", {
			provider: this.type,
			sessionId: opts.sessionId,
			durationMs: Date.now() - setupEssentialStartMs,
		});

		// Setup additional dependencies (async - fire and forget)
		logLatency("provider.create_sandbox.setup_additional.start_async", {
			provider: this.type,
			sessionId: opts.sessionId,
		});
		this.setupAdditionalDependencies(sandbox, opts, log).catch((err) => {
			log.warn({ err }, "Additional dependencies setup failed");
			logLatency("provider.create_sandbox.setup_additional.error", {
				provider: this.type,
				sessionId: opts.sessionId,
				error: err instanceof Error ? err.message : String(err),
			});
		});

		// Get tunnel URLs
		log.debug("Getting tunnel URLs");
		const tunnelsStartMs = Date.now();
		const tunnelHost = sandbox.getHost(4096);
		const previewHost = sandbox.getHost(20000);

		const tunnelUrl = tunnelHost ? `https://${tunnelHost}` : "";
		const previewUrl = previewHost ? `https://${previewHost}` : "";
		logLatency("provider.create_sandbox.tunnels", {
			provider: this.type,
			sessionId: opts.sessionId,
			durationMs: Date.now() - tunnelsStartMs,
			hasTunnelUrl: Boolean(tunnelUrl),
			hasPreviewUrl: Boolean(previewUrl),
		});

		log.debug({ tunnelUrl, previewUrl }, "Tunnel URLs resolved");

		// Wait for OpenCode to be ready (with exponential backoff)
		if (tunnelUrl) {
			log.debug("Waiting for OpenCode readiness");
			try {
				const readyStartMs = Date.now();
				await waitForOpenCodeReady(tunnelUrl, 30000, (msg) => log.debug(msg));
				logLatency("provider.create_sandbox.opencode_ready", {
					provider: this.type,
					sessionId: opts.sessionId,
					durationMs: Date.now() - readyStartMs,
					timeoutMs: 30000,
				});
			} catch (error) {
				// Log but don't fail - client can retry connection
				logLatency("provider.create_sandbox.opencode_ready.warn", {
					provider: this.type,
					sessionId: opts.sessionId,
					timeoutMs: 30000,
					error: error instanceof Error ? error.message : String(error),
				});
				log.warn({ err: error }, "OpenCode readiness check failed");
			}
		}

		log.info(
			{ sandboxId: sandbox.sandboxId, elapsedMs: Date.now() - startTime },
			"Sandbox creation complete",
		);
		logLatency("provider.create_sandbox.complete", {
			provider: this.type,
			sessionId: opts.sessionId,
			durationMs: Date.now() - startTime,
			isSnapshot,
		});
		return {
			sandboxId: sandbox.sandboxId,
			tunnelUrl,
			previewUrl,
			expiresAt: sandboxCreatedAt + SANDBOX_TIMEOUT_MS,
		};
	}

	async ensureSandbox(opts: CreateSandboxOpts): Promise<EnsureSandboxResult> {
		providerLogger.debug({ sessionId: opts.sessionId }, "Ensuring sandbox");
		const startMs = Date.now();
		logLatency("provider.ensure_sandbox.start", {
			provider: this.type,
			sessionId: opts.sessionId,
			hasCurrentSandboxId: Boolean(opts.currentSandboxId),
			hasSnapshotId: Boolean(opts.snapshotId),
		});

		// For E2B, we use currentSandboxId from DB as the identifier
		// (E2B auto-generates IDs, unlike Modal where we set sessionId as the name)
		const findStartMs = Date.now();
		const existingSandboxId = await this.findSandbox(opts.currentSandboxId);
		logLatency("provider.ensure_sandbox.find_existing", {
			provider: this.type,
			sessionId: opts.sessionId,
			durationMs: Date.now() - findStartMs,
			found: Boolean(existingSandboxId),
		});

		if (existingSandboxId) {
			providerLogger.debug({ sandboxId: existingSandboxId }, "Found existing sandbox");
			const resolveStartMs = Date.now();
			const tunnels = await this.resolveTunnels(existingSandboxId);
			logLatency("provider.ensure_sandbox.resolve_tunnels", {
				provider: this.type,
				sessionId: opts.sessionId,
				durationMs: Date.now() - resolveStartMs,
				hasTunnelUrl: Boolean(tunnels.openCodeUrl),
				hasPreviewUrl: Boolean(tunnels.previewUrl),
			});
			logLatency("provider.ensure_sandbox.complete", {
				provider: this.type,
				sessionId: opts.sessionId,
				recovered: true,
				durationMs: Date.now() - startMs,
			});
			return {
				sandboxId: existingSandboxId,
				tunnelUrl: tunnels.openCodeUrl,
				previewUrl: tunnels.previewUrl,
				recovered: true,
			};
		}

		providerLogger.debug("No existing sandbox found, creating new");
		const result = await this.createSandbox(opts);
		logLatency("provider.ensure_sandbox.complete", {
			provider: this.type,
			sessionId: opts.sessionId,
			recovered: false,
			durationMs: Date.now() - startMs,
		});
		return { ...result, recovered: false };
	}

	/**
	 * Find a running sandbox by its ID.
	 * Uses Sandbox.getInfo() to check if sandbox exists without connecting.
	 */
	private async findSandbox(sandboxId: string | undefined): Promise<string | null> {
		if (!sandboxId) return null;

		try {
			const info = await Sandbox.getInfo(sandboxId, getE2BApiOpts());
			// Check if sandbox is still running (not ended)
			return info.endAt ? null : info.sandboxId;
		} catch {
			// Sandbox not found
			return null;
		}
	}

	/**
	 * Setup the sandbox workspace:
	 * - For fresh sandboxes: Clone repositories and save metadata
	 * - For snapshots: Read metadata to get existing repoDir (repos already in snapshot)
	 *
	 * @returns The repoDir path
	 */
	private async setupSandbox(
		sandbox: Sandbox,
		opts: CreateSandboxOpts,
		isSnapshot: boolean,
		log: Logger,
	): Promise<string> {
		const workspaceDir = "/home/user/workspace";

		if (isSnapshot) {
			// Snapshot restore: repos are already in the filesystem, just read metadata
			log.debug("Restoring from snapshot - reading metadata");
			try {
				const metadataStr = await sandbox.files.read(SANDBOX_PATHS.metadataFile);
				const metadata: SessionMetadata = JSON.parse(metadataStr);
				log.debug({ repoDir: metadata.repoDir }, "Found repo from metadata");
				return metadata.repoDir;
			} catch {
				// Fallback to find command if metadata doesn't exist (legacy snapshots)
				log.debug("Metadata not found, falling back to find command");
				const findResult = await sandbox.commands.run(
					"find /home/user -maxdepth 5 -name '.git' -type d 2>/dev/null | head -1",
					{ timeoutMs: 30000 },
				);

				if (findResult.stdout.trim()) {
					const gitDir = findResult.stdout.trim();
					const repoDir = gitDir.replace("/.git", "");
					log.debug({ repoDir }, "Found repo");
					return repoDir;
				}

				// Last resort fallback
				const lsResult = await sandbox.commands.run(
					"ls -d /home/user/workspace/*/repo 2>/dev/null | head -1",
					{ timeoutMs: 10000 },
				);
				const repoDir = lsResult.stdout.trim() || "/home/user";
				log.debug({ repoDir }, "Using repo fallback");
				return repoDir;
			}
		}

		// Fresh sandbox: clone repositories
		log.debug("Setting up workspace");
		await sandbox.commands.run(`mkdir -p ${workspaceDir}`, {
			timeoutMs: 10000,
		});

		// Write git credentials file for per-repo auth (used by git-credential-proliferate helper)
		const gitCredentials: Record<string, string> = {};
		for (const repo of opts.repos) {
			if (repo.token) {
				// Store both with and without .git suffix for flexibility
				gitCredentials[repo.repoUrl] = repo.token;
				gitCredentials[repo.repoUrl.replace(/\.git$/, "")] = repo.token;
			}
		}
		if (Object.keys(gitCredentials).length > 0) {
			log.debug({ repoCount: opts.repos.length }, "Writing git credentials");
			await sandbox.files.write("/tmp/.git-credentials.json", JSON.stringify(gitCredentials));
		}

		// Clone each repo
		let firstRepoDir: string | null = null;
		for (let i = 0; i < opts.repos.length; i++) {
			const repo = opts.repos[i];
			const targetDir = `${workspaceDir}/${repo.workspacePath}`;
			if (firstRepoDir === null) {
				firstRepoDir = targetDir;
			}

			// Build clone URL with token if provided
			let cloneUrl = repo.repoUrl;
			if (repo.token) {
				cloneUrl = repo.repoUrl.replace("https://", `https://x-access-token:${repo.token}@`);
			}

			log.debug(
				{ repo: repo.workspacePath, index: i + 1, total: opts.repos.length },
				"Cloning repo",
			);
			try {
				await sandbox.commands.run(
					`git clone --depth 1 --branch ${opts.branch} '${cloneUrl}' ${targetDir}`,
					{ timeoutMs: 120000 },
				);
			} catch {
				// Try without branch
				log.debug({ repo: repo.workspacePath }, "Branch clone failed, trying default");
				await sandbox.commands.run(`git clone --depth 1 '${cloneUrl}' ${targetDir}`, {
					timeoutMs: 120000,
				});
			}
		}

		// Set repoDir (first repo for single, workspace root for multi)
		const repoDir = opts.repos.length > 1 ? workspaceDir : firstRepoDir || workspaceDir;
		log.debug("All repositories cloned");

		// Save session metadata for robust state tracking across pause/resume
		const metadata: SessionMetadata = {
			sessionId: opts.sessionId,
			repoDir,
			createdAt: Date.now(),
		};
		await sandbox.files.write(SANDBOX_PATHS.metadataFile, JSON.stringify(metadata, null, 2));
		log.debug("Session metadata saved");

		return repoDir;
	}

	/**
	 * Setup essential dependencies (blocking - must complete before API returns):
	 * - Write all config files in parallel (each ensures its directory exists)
	 * - Copy pre-installed tool dependencies
	 * - Start OpenCode server
	 */
	private async setupEssentialDependencies(
		sandbox: Sandbox,
		repoDir: string,
		opts: CreateSandboxOpts,
		log: Logger,
		llmProxyBaseUrl?: string,
		llmProxyApiKey?: string,
	): Promise<void> {
		const globalOpencodeDir = SANDBOX_PATHS.globalOpencodeDir;
		const globalPluginDir = SANDBOX_PATHS.globalPluginDir;
		const localOpencodeDir = `${repoDir}/.opencode`;
		const localToolDir = `${localOpencodeDir}/tool`;

		// Prepare config content
		const agentConfig = opts.agentConfig || getDefaultAgentConfig();
		const opencodeModelId = toOpencodeModelId(agentConfig.modelId);
		let opencodeConfig: string;
		if (llmProxyBaseUrl && llmProxyApiKey) {
			log.debug({ llmProxyBaseUrl }, "Using LLM proxy");
			opencodeConfig = getOpencodeConfig(opencodeModelId, llmProxyBaseUrl);
		} else {
			log.debug("Direct API mode (no proxy)");
			opencodeConfig = getOpencodeConfig(opencodeModelId);
		}
		log.debug({ modelId: agentConfig.modelId, opencodeModelId }, "Using model");

		const basePrompt = opts.systemPrompt || "You are a senior engineer working on this codebase.";
		const instructions = `${basePrompt}\n\n${ENV_INSTRUCTIONS}`;

		// Helper to write a file (ensures parent directory exists to avoid race conditions)
		const writeFile = async (path: string, content: string) => {
			const dir = path.substring(0, path.lastIndexOf("/"));
			await sandbox.commands.run(`mkdir -p ${dir}`, { timeoutMs: 10000 });
			await sandbox.files.write(path, content);
		};

		// Write all files in parallel (each write ensures its directory exists)
		log.debug("Writing OpenCode files (parallel)");
		await Promise.all([
			// Plugin
			writeFile(`${globalPluginDir}/proliferate.mjs`, PLUGIN_MJS),
			// Tools (6 files)
			writeFile(`${localToolDir}/verify.ts`, VERIFY_TOOL),
			writeFile(`${localToolDir}/verify.txt`, VERIFY_TOOL_DESCRIPTION),
			writeFile(`${localToolDir}/request_env_variables.ts`, REQUEST_ENV_VARIABLES_TOOL),
			writeFile(`${localToolDir}/request_env_variables.txt`, REQUEST_ENV_VARIABLES_DESCRIPTION),
			writeFile(`${localToolDir}/save_snapshot.ts`, SAVE_SNAPSHOT_TOOL),
			writeFile(`${localToolDir}/save_snapshot.txt`, SAVE_SNAPSHOT_DESCRIPTION),
			writeFile(`${localToolDir}/automation_complete.ts`, AUTOMATION_COMPLETE_TOOL),
			writeFile(`${localToolDir}/automation_complete.txt`, AUTOMATION_COMPLETE_DESCRIPTION),
			writeFile(`${localToolDir}/save_service_commands.ts`, SAVE_SERVICE_COMMANDS_TOOL),
			writeFile(`${localToolDir}/save_service_commands.txt`, SAVE_SERVICE_COMMANDS_DESCRIPTION),
			// Config (2 files)
			writeFile(`${globalOpencodeDir}/opencode.json`, opencodeConfig),
			writeFile(`${repoDir}/opencode.json`, opencodeConfig),
			// Instructions
			writeFile(`${localOpencodeDir}/instructions.md`, instructions),
			// Copy pre-installed tool dependencies (runs in parallel with file writes)
			(async () => {
				await sandbox.commands.run(`mkdir -p ${localToolDir}`, { timeoutMs: 10000 });
				await sandbox.commands.run(
					`cp ${SANDBOX_PATHS.preinstalledToolsDir}/package.json ${localToolDir}/ && ` +
						`cp -r ${SANDBOX_PATHS.preinstalledToolsDir}/node_modules ${localToolDir}/`,
					{ timeoutMs: 30000 },
				);
			})(),
		]);

		// Start OpenCode server in background
		log.debug("Starting OpenCode server");
		const opencodeEnv: Record<string, string> = {
			SESSION_ID: opts.sessionId,
			OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
		};
		if (llmProxyBaseUrl && llmProxyApiKey) {
			log.debug({ llmProxyBaseUrl, hasApiKey: !!llmProxyApiKey }, "OpenCode using LLM proxy");
			opencodeEnv.ANTHROPIC_API_KEY = llmProxyApiKey;
			opencodeEnv.ANTHROPIC_BASE_URL = llmProxyBaseUrl;
		} else if (opts.envVars.ANTHROPIC_API_KEY) {
			log.warn("OpenCode using direct key (no LLM proxy)");
			opencodeEnv.ANTHROPIC_API_KEY = opts.envVars.ANTHROPIC_API_KEY;
		} else {
			log.warn("OpenCode has no LLM proxy AND no direct key");
		}
		sandbox.commands
			.run(
				`cd ${repoDir} && opencode serve --print-logs --log-level ERROR --port 4096 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1`,
				{ timeoutMs: 3600000, envs: opencodeEnv }, // Long timeout, runs in background
			)
			.catch((err: unknown) => {
				providerLogger.debug({ err }, "OpenCode process ended");
			});
		// Don't await - let it run in background
	}

	/**
	 * Setup additional dependencies (async - fire and forget):
	 * - Start services (Postgres, Redis, Mailcatcher)
	 * - Start Caddy preview proxy
	 * - Run per-repo service commands (if snapshot has deps)
	 */
	private async setupAdditionalDependencies(
		sandbox: Sandbox,
		opts: CreateSandboxOpts,
		log: Logger,
	): Promise<void> {
		// Start services (PostgreSQL, Redis, Mailcatcher)
		log.debug("Starting services (async)");
		await sandbox.commands.run("/usr/local/bin/start-services.sh", {
			timeoutMs: 30000,
		});

		// Start Caddy for preview proxy (run in background, non-blocking)
		log.debug("Starting Caddy preview proxy (async)");
		await sandbox.files.write(SANDBOX_PATHS.caddyfile, DEFAULT_CADDYFILE);
		sandbox.commands
			.run(`caddy run --config ${SANDBOX_PATHS.caddyfile}`, {
				timeoutMs: 3600000,
			})
			.catch((err: unknown) => {
				providerLogger.debug({ err }, "Caddy process ended");
			});
		// Don't await - runs in background

		// Run per-repo service commands (only when snapshot includes deps)
		if (opts.snapshotHasDeps) {
			this.runServiceCommands(sandbox, opts, log);
		}
	}

	/**
	 * Run service commands in the background.
	 * Prefers top-level resolved commands (prebuild-level); falls back to per-repo.
	 * Each command is fire-and-forget with output redirected to /tmp/svc-*.log.
	 */
	private runServiceCommands(sandbox: Sandbox, opts: CreateSandboxOpts, log: Logger): void {
		const workspaceDir = "/home/user/workspace";

		// Prefer top-level prebuild-resolved commands
		if (opts.serviceCommands?.length) {
			for (let i = 0; i < opts.serviceCommands.length; i++) {
				const cmd = opts.serviceCommands[i];
				const baseDir =
					cmd.workspacePath && cmd.workspacePath !== "."
						? `${workspaceDir}/${cmd.workspacePath}`
						: workspaceDir;
				const cwd = cmd.cwd ? `${baseDir}/${cmd.cwd}` : baseDir;
				const slug = cmd.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
				const wpSlug = (cmd.workspacePath || "root").replace(/[/.]/g, "_");
				const logFile = `/tmp/svc-${wpSlug}-${i}-${slug}.log`;

				log.info({ name: cmd.name, cwd, logFile }, "Starting service command");

				sandbox.commands
					.run(
						`cd ${shellEscape(cwd)} && exec sh -c ${shellEscape(cmd.command)} > ${shellEscape(logFile)} 2>&1`,
						{
							timeoutMs: 3600000,
						},
					)
					.catch(() => {
						// Expected - runs until sandbox terminates
					});
			}
			return;
		}

		// Fallback: per-repo service commands (backwards compat)
		for (const repo of opts.repos) {
			if (!repo.serviceCommands?.length) continue;

			const repoDir =
				opts.repos.length === 1 && repo.workspacePath === "."
					? workspaceDir
					: `${workspaceDir}/${repo.workspacePath}`;

			for (let i = 0; i < repo.serviceCommands.length; i++) {
				const cmd = repo.serviceCommands[i];
				const slug = cmd.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
				const logFile = `/tmp/svc-${repo.workspacePath.replace(/[/.]/g, "_")}-${i}-${slug}.log`;
				const cwd = cmd.cwd ? `${repoDir}/${cmd.cwd}` : repoDir;

				log.info({ name: cmd.name, cwd, logFile }, "Starting service command");

				sandbox.commands
					.run(
						`cd ${shellEscape(cwd)} && exec sh -c ${shellEscape(cmd.command)} > ${shellEscape(logFile)} 2>&1`,
						{
							timeoutMs: 3600000,
						},
					)
					.catch(() => {
						// Expected - runs until sandbox terminates
					});
			}
		}
	}

	async testServiceCommands(
		sandboxId: string,
		commands: PrebuildServiceCommand[],
		opts: { timeoutMs: number; runId: string },
	): Promise<AutoStartOutputEntry[]> {
		const log = providerLogger.child({ sandboxId: sandboxId.slice(0, 16), runId: opts.runId });
		log.info({ commandCount: commands.length }, "Testing service commands");

		const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
		const workspaceDir = "/home/user/workspace";
		const entries: AutoStartOutputEntry[] = [];

		for (let i = 0; i < commands.length; i++) {
			const cmd = commands[i];
			const baseDir =
				cmd.workspacePath && cmd.workspacePath !== "."
					? `${workspaceDir}/${cmd.workspacePath}`
					: workspaceDir;
			const cwd = cmd.cwd ? `${baseDir}/${cmd.cwd}` : baseDir;
			const slug = cmd.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
			const wpSlug = (cmd.workspacePath || "root").replace(/[/.]/g, "_");
			const logFile = `/tmp/auto-start-test-${opts.runId}-${i}-${slug}.log`;

			log.info({ name: cmd.name, cwd, logFile }, "Running test command");

			try {
				const result = await sandbox.commands.run(
					`cd ${shellEscape(cwd)} && sh -c ${shellEscape(cmd.command)} > ${shellEscape(logFile)} 2>&1; EXIT_CODE=$?; cat ${shellEscape(logFile)}; exit $EXIT_CODE`,
					{ timeoutMs: opts.timeoutMs },
				);
				entries.push({
					name: cmd.name,
					workspacePath: cmd.workspacePath,
					cwd,
					output: capOutput(result.stdout + result.stderr),
					exitCode: result.exitCode,
					logFile,
				});
			} catch (err) {
				log.error({ err, name: cmd.name }, "Test command failed");
				entries.push({
					name: cmd.name,
					workspacePath: cmd.workspacePath,
					cwd,
					output: err instanceof Error ? err.message : "Command execution failed",
					exitCode: 1,
					logFile,
				});
			}
		}

		return entries;
	}

	async snapshot(sessionId: string, sandboxId: string): Promise<SnapshotResult> {
		providerLogger.info({ sessionId }, "Taking snapshot");
		return this.pause(sessionId, sandboxId);
	}

	async pause(sessionId: string, sandboxId: string): Promise<PauseResult> {
		providerLogger.info({ sessionId }, "Pausing sandbox");
		const startMs = Date.now();

		// The sandboxId becomes the snapshot ID for E2B (can resume with connect)
		providerLogger.debug({ sandboxId }, "Pausing sandbox (creating snapshot)");
		await Sandbox.betaPause(sandboxId, getE2BApiOpts());

		providerLogger.info({ sandboxId }, "Snapshot created");
		logLatency("provider.pause.complete", {
			provider: this.type,
			sessionId,
			durationMs: Date.now() - startMs,
		});
		return { snapshotId: sandboxId };
	}

	async terminate(sessionId: string, sandboxId?: string): Promise<void> {
		providerLogger.info({ sessionId }, "Terminating session");
		const startMs = Date.now();

		if (!sandboxId) {
			throw new SandboxProviderError({
				provider: "e2b",
				operation: "terminate",
				message: "sandboxId is required for terminate",
				isRetryable: false,
			});
		}

		try {
			const killStartMs = Date.now();
			await Sandbox.kill(sandboxId, getE2BApiOpts());
			providerLogger.info({ sandboxId }, "Sandbox terminated");
			logLatency("provider.terminate.complete", {
				provider: this.type,
				sessionId,
				durationMs: Date.now() - killStartMs,
			});
		} catch (error) {
			// Check if it's a "not found" error - sandbox already terminated is idempotent
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (
				errorMessage.includes("not found") ||
				errorMessage.includes("404") ||
				errorMessage.includes("does not exist")
			) {
				providerLogger.debug({ sandboxId }, "Sandbox already terminated (idempotent)");
				logLatency("provider.terminate.idempotent", {
					provider: this.type,
					sessionId,
					durationMs: Date.now() - startMs,
				});
				return;
			}

			throw SandboxProviderError.fromError(error, "e2b", "terminate");
		}
	}

	async writeEnvFile(sandboxId: string, envVars: Record<string, string>): Promise<void> {
		providerLogger.debug({ sandboxId: sandboxId.slice(0, 16) }, "Writing env vars to sandbox");
		const startMs = Date.now();

		const connectStartMs = Date.now();
		const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
		logLatency("provider.write_env_file.connect", {
			provider: this.type,
			sandboxId,
			durationMs: Date.now() - connectStartMs,
		});

		// Merge with existing env vars if any
		let existing: Record<string, string> = {};
		try {
			const readStartMs = Date.now();
			const existingJson = await sandbox.files.read(ENV_FILE);
			logLatency("provider.write_env_file.read_existing", {
				provider: this.type,
				sandboxId,
				durationMs: Date.now() - readStartMs,
			});
			if (existingJson.trim()) {
				existing = JSON.parse(existingJson);
			}
		} catch {
			// File doesn't exist yet
		}

		const merged = { ...existing, ...envVars };
		const writeStartMs = Date.now();
		await sandbox.files.write(ENV_FILE, JSON.stringify(merged));
		logLatency("provider.write_env_file.write", {
			provider: this.type,
			sandboxId,
			keyCount: Object.keys(envVars).length,
			durationMs: Date.now() - writeStartMs,
		});

		providerLogger.debug({ keyCount: Object.keys(envVars).length }, "Wrote env vars to sandbox");
		logLatency("provider.write_env_file.complete", {
			provider: this.type,
			sandboxId,
			keyCount: Object.keys(envVars).length,
			durationMs: Date.now() - startMs,
		});
	}

	async health(): Promise<boolean> {
		// E2B health is determined by whether we can make API calls
		// Actually call the API to validate the key
		try {
			// Check if we have the required env var first
			if (!env.E2B_API_KEY) {
				providerLogger.warn("Health check failed: E2B_API_KEY not set");
				return false;
			}

			// Call Sandbox.list() to validate the API key works
			// This makes a real API call without creating or modifying any sandboxes
			await Sandbox.list(getE2BApiOpts());
			return true;
		} catch (error) {
			providerLogger.warn({ err: error }, "Health check failed");
			return false;
		}
	}

	async resolveTunnels(sandboxId: string): Promise<{ openCodeUrl: string; previewUrl: string }> {
		const startMs = Date.now();
		const connectStartMs = Date.now();
		const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
		logLatency("provider.resolve_tunnels.connect", {
			provider: this.type,
			sandboxId,
			durationMs: Date.now() - connectStartMs,
		});
		const hostStartMs = Date.now();
		const tunnelHost = sandbox.getHost(4096);
		const previewHost = sandbox.getHost(20000);
		logLatency("provider.resolve_tunnels.get_host", {
			provider: this.type,
			sandboxId,
			durationMs: Date.now() - hostStartMs,
		});

		const result = {
			openCodeUrl: tunnelHost ? `https://${tunnelHost}` : "",
			previewUrl: previewHost ? `https://${previewHost}` : "",
		};
		logLatency("provider.resolve_tunnels.complete", {
			provider: this.type,
			sandboxId,
			durationMs: Date.now() - startMs,
			hasTunnelUrl: Boolean(result.openCodeUrl),
			hasPreviewUrl: Boolean(result.previewUrl),
		});
		return result;
	}

	/**
	 * Read files from a folder in the sandbox filesystem.
	 * Used by the verify tool to upload verification evidence.
	 */
	async readFiles(sandboxId: string, folderPath: string): Promise<FileContent[]> {
		providerLogger.debug(
			{ folderPath, sandboxId: sandboxId.slice(0, 16) },
			"Reading files from sandbox",
		);
		const startMs = Date.now();

		const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
		const exists = await sandbox.files.exists(folderPath);

		if (!exists) {
			providerLogger.debug({ folderPath }, "Folder does not exist");
			logLatency("provider.read_files.missing", {
				provider: this.type,
				sandboxId,
				folderPath,
				durationMs: Date.now() - startMs,
			});
			return [];
		}

		const normalizedFolder = folderPath.replace(/\/$/, "");
		const files: FileContent[] = [];
		const directories: string[] = [normalizedFolder];

		while (directories.length > 0) {
			const dir = directories.pop();
			if (!dir) break;

			const entries = await sandbox.files.list(dir).catch((err) => {
				providerLogger.warn({ err, dir }, "Failed to list directory");
				return null;
			});
			if (!entries) {
				continue;
			}

			for (const entry of entries) {
				if (entry.type === FileType.DIR) {
					directories.push(entry.path);
					continue;
				}
				if (entry.type !== FileType.FILE) {
					continue;
				}

				try {
					const data = await sandbox.files.read(entry.path, { format: "bytes" });
					const relativePath = entry.path.replace(`${normalizedFolder}/`, "");
					files.push({ path: relativePath, data });
				} catch (err) {
					providerLogger.warn({ err, path: entry.path }, "Failed to read file");
				}
			}
		}

		providerLogger.debug({ fileCount: files.length, folderPath }, "Read files from sandbox");
		logLatency("provider.read_files.complete", {
			provider: this.type,
			sandboxId,
			folderPath,
			fileCount: files.length,
			durationMs: Date.now() - startMs,
		});
		return files;
	}

	/**
	 * Check which sandboxes are still alive.
	 * Returns array of sandbox IDs that are still running.
	 *
	 * IMPORTANT: Uses Sandbox.list() instead of connect() to avoid
	 * auto-resuming paused sandboxes. connect() has side effects that
	 * resume paused sandboxes and reset timeouts.
	 */
	async checkSandboxes(sandboxIds: string[]): Promise<string[]> {
		if (sandboxIds.length === 0) {
			return [];
		}

		try {
			// Use Sandbox.list() to get all running sandboxes
			// This is side-effect free - it doesn't resume or modify sandboxes
			const paginator = Sandbox.list(getE2BApiOpts());

			// Collect all running sandboxes from all pages
			const runningSandboxIds: string[] = [];
			while (paginator.hasNext) {
				const items = await paginator.nextItems();
				for (const sandbox of items) {
					runningSandboxIds.push(sandbox.sandboxId);
				}
			}

			// Create a Set for O(1) lookup
			const runningIds = new Set(runningSandboxIds);

			// Filter the requested IDs to only those that are running
			const alive = sandboxIds.filter((id) => runningIds.has(id));

			// Log sandboxes that are no longer running
			for (const id of sandboxIds) {
				if (!runningIds.has(id)) {
					providerLogger.debug({ sandboxId: id.slice(0, 16) }, "Sandbox not running");
				}
			}

			return alive;
		} catch (error) {
			// If the list call fails, we can't determine status
			// Log the error but don't throw - return empty array as safe default
			providerLogger.error({ err: error }, "Failed to list sandboxes");
			return [];
		}
	}
}
