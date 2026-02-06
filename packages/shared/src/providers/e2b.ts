import { env } from "@proliferate/environment/server";
import { FileType, Sandbox, type SandboxApiOpts, type SandboxConnectOpts } from "e2b";
import { getDefaultAgentConfig, toOpencodeModelId } from "../agents";
import { getLLMProxyBaseURL } from "../llm-proxy";
import {
	AUTOMATION_COMPLETE_DESCRIPTION,
	AUTOMATION_COMPLETE_TOOL,
	ENV_FILE,
	REQUEST_ENV_VARIABLES_DESCRIPTION,
	REQUEST_ENV_VARIABLES_TOOL,
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
	getOpencodeConfig,
	waitForOpenCodeReady,
} from "../sandbox";
import type {
	CreateSandboxOpts,
	CreateSandboxResult,
	EnsureSandboxResult,
	FileContent,
	PauseResult,
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
		const log = (msg: string) => {
			const elapsed = Date.now() - startTime;
			console.log(`[E2B:${elapsed}ms] ${msg}`);
		};

		log(`Creating session ${opts.sessionId}`);
		log(`Repos: ${opts.repos.length} repo(s)`);
		log(`Snapshot ID: ${opts.snapshotId || "none (fresh clone)"}`);

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
			log(
				`[E2B] Using LLM proxy: baseUrl=${llmProxyBaseUrl}, apiKey=${llmProxyApiKey ? "SET" : "NOT SET"}`,
			);
			envs.ANTHROPIC_API_KEY = llmProxyApiKey;
			envs.ANTHROPIC_BASE_URL = llmProxyBaseUrl;
		} else {
			const hasDirectKey = !!opts.envVars.ANTHROPIC_API_KEY;
			log(`[E2B] WARNING: No LLM proxy, using direct key: ${hasDirectKey ? "SET" : "NOT SET"}`);
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
				log(`Resuming from snapshot: ${opts.snapshotId}`);
				sandbox = await Sandbox.connect(opts.snapshotId!, getE2BConnectOpts());
				log(`Sandbox resumed: ${sandbox.sandboxId}`);

				// Re-inject environment variables (they don't persist across pause/resume)
				// Using JSON file approach to avoid shell escaping issues (security)
				log("Re-injecting environment variables...");
				let envsForProfile = { ...envs };
				if (llmProxyBaseUrl && llmProxyApiKey) {
					const {
						ANTHROPIC_API_KEY: _apiKey,
						ANTHROPIC_BASE_URL: _baseUrl,
						...rest
					} = envsForProfile;
					envsForProfile = rest;
				}
				await sandbox.files.write(SANDBOX_PATHS.envProfileFile, JSON.stringify(envsForProfile));
				// Use jq to safely export env vars from JSON (handles special chars properly)
				await sandbox.commands.run(
					`for key in $(jq -r 'keys[]' ${SANDBOX_PATHS.envProfileFile}); do export "$key=$(jq -r --arg k "$key" '.[$k]' ${SANDBOX_PATHS.envProfileFile})"; done`,
					{ timeoutMs: 10000 },
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				log(`Snapshot resume failed (${message}). Falling back to fresh sandbox.`);
				isSnapshot = false;
			}
		}

		if (!isSnapshot) {
			// Create fresh sandbox
			log("Creating fresh sandbox (no snapshot)");
			if (!opts.repos || opts.repos.length === 0) {
				throw new Error("repos[] is required");
			}
			if (!E2B_TEMPLATE) {
				throw new Error("E2B_TEMPLATE is required to create a sandbox");
			}
			sandbox = await Sandbox.create(E2B_TEMPLATE, sandboxOpts);
			log(`Sandbox created: ${sandbox.sandboxId}`);
		}

		if (!sandbox) {
			throw new Error("Failed to initialize sandbox");
		}

		// Setup the sandbox (clone repos or restore from snapshot)
		const repoDir = await this.setupSandbox(sandbox, opts, isSnapshot, log);

		// Setup essential dependencies (blocking - must complete before API returns)
		await this.setupEssentialDependencies(
			sandbox,
			repoDir,
			opts,
			log,
			llmProxyBaseUrl,
			llmProxyApiKey,
		);

		// Setup additional dependencies (async - fire and forget)
		this.setupAdditionalDependencies(sandbox, log).catch((err) => {
			log(`Warning: Additional dependencies setup failed: ${err}`);
		});

		// Get tunnel URLs
		log("Getting tunnel URLs...");
		const tunnelHost = sandbox.getHost(4096);
		const previewHost = sandbox.getHost(20000);

		const tunnelUrl = tunnelHost ? `https://${tunnelHost}` : "";
		const previewUrl = previewHost ? `https://${previewHost}` : "";

		log(`Tunnel URLs: opencode=${tunnelUrl}, preview=${previewUrl}`);

		// Wait for OpenCode to be ready (with exponential backoff)
		if (tunnelUrl) {
			log("Waiting for OpenCode readiness...");
			try {
				await waitForOpenCodeReady(tunnelUrl, 30000, log);
			} catch (error) {
				// Log but don't fail - client can retry connection
				log(
					`WARNING: ${error instanceof Error ? error.message : "OpenCode readiness check failed"}`,
				);
			}
		}

		log(`Returning sandboxId=${sandbox.sandboxId}`);
		return {
			sandboxId: sandbox.sandboxId,
			tunnelUrl,
			previewUrl,
			expiresAt: sandboxCreatedAt + SANDBOX_TIMEOUT_MS,
		};
	}

	async ensureSandbox(opts: CreateSandboxOpts): Promise<EnsureSandboxResult> {
		console.log(`[E2B] Ensuring sandbox for session ${opts.sessionId}`);

		// For E2B, we use currentSandboxId from DB as the identifier
		// (E2B auto-generates IDs, unlike Modal where we set sessionId as the name)
		const existingSandboxId = await this.findSandbox(opts.currentSandboxId);

		if (existingSandboxId) {
			console.log(`[E2B] Found existing sandbox: ${existingSandboxId}`);
			const tunnels = await this.resolveTunnels(existingSandboxId);
			return {
				sandboxId: existingSandboxId,
				tunnelUrl: tunnels.openCodeUrl,
				previewUrl: tunnels.previewUrl,
				recovered: true,
			};
		}

		console.log("[E2B] No existing sandbox found, creating new...");
		const result = await this.createSandbox(opts);
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
		log: (msg: string) => void,
	): Promise<string> {
		const workspaceDir = "/home/user/workspace";

		if (isSnapshot) {
			// Snapshot restore: repos are already in the filesystem, just read metadata
			log("Restoring from snapshot - reading metadata...");
			try {
				const metadataStr = await sandbox.files.read(SANDBOX_PATHS.metadataFile);
				const metadata: SessionMetadata = JSON.parse(metadataStr);
				log(`Found repo at: ${metadata.repoDir} (from metadata)`);
				return metadata.repoDir;
			} catch {
				// Fallback to find command if metadata doesn't exist (legacy snapshots)
				log("Metadata not found, falling back to find command...");
				const findResult = await sandbox.commands.run(
					"find /home/user -maxdepth 5 -name '.git' -type d 2>/dev/null | head -1",
					{ timeoutMs: 30000 },
				);

				if (findResult.stdout.trim()) {
					const gitDir = findResult.stdout.trim();
					const repoDir = gitDir.replace("/.git", "");
					log(`Found repo at: ${repoDir}`);
					return repoDir;
				}

				// Last resort fallback
				const lsResult = await sandbox.commands.run(
					"ls -d /home/user/workspace/*/repo 2>/dev/null | head -1",
					{ timeoutMs: 10000 },
				);
				const repoDir = lsResult.stdout.trim() || "/home/user";
				log(`Using repo at: ${repoDir}`);
				return repoDir;
			}
		}

		// Fresh sandbox: clone repositories
		log("Setting up workspace...");
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
			log(`Writing git credentials for ${opts.repos.length} repo(s)...`);
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

			log(`Cloning repo ${i + 1}/${opts.repos.length}: ${repo.workspacePath}`);
			try {
				await sandbox.commands.run(
					`git clone --depth 1 --branch ${opts.branch} '${cloneUrl}' ${targetDir}`,
					{ timeoutMs: 120000 },
				);
			} catch {
				// Try without branch
				log(`Branch clone failed, trying default for ${repo.workspacePath}`);
				await sandbox.commands.run(`git clone --depth 1 '${cloneUrl}' ${targetDir}`, {
					timeoutMs: 120000,
				});
			}
		}

		// Set repoDir (first repo for single, workspace root for multi)
		const repoDir = opts.repos.length > 1 ? workspaceDir : firstRepoDir || workspaceDir;
		log("All repositories cloned");

		// Save session metadata for robust state tracking across pause/resume
		const metadata: SessionMetadata = {
			sessionId: opts.sessionId,
			repoDir,
			createdAt: Date.now(),
		};
		await sandbox.files.write(SANDBOX_PATHS.metadataFile, JSON.stringify(metadata, null, 2));
		log("Session metadata saved");

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
		log: (msg: string) => void,
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
			log(`Using LLM proxy: ${llmProxyBaseUrl}`);
			opencodeConfig = getOpencodeConfig(opencodeModelId, llmProxyBaseUrl);
		} else {
			log("Direct API mode (no proxy)");
			opencodeConfig = getOpencodeConfig(opencodeModelId);
		}
		log(`Using model: ${agentConfig.modelId} -> ${opencodeModelId}`);

		const basePrompt = opts.systemPrompt || "You are a senior engineer working on this codebase.";
		const instructions = `${basePrompt}\n\n${ENV_INSTRUCTIONS}`;

		// Helper to write a file (ensures parent directory exists to avoid race conditions)
		const writeFile = async (path: string, content: string) => {
			const dir = path.substring(0, path.lastIndexOf("/"));
			await sandbox.commands.run(`mkdir -p ${dir}`, { timeoutMs: 10000 });
			await sandbox.files.write(path, content);
		};

		// Write all files in parallel (each write ensures its directory exists)
		log("Writing OpenCode files (parallel)...");
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
		log("Starting OpenCode server...");
		const opencodeEnv: Record<string, string> = {
			SESSION_ID: opts.sessionId,
			OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
		};
		if (llmProxyBaseUrl && llmProxyApiKey) {
			log(
				`[E2B/startOpenCode] Using LLM proxy: baseUrl=${llmProxyBaseUrl}, apiKey=${llmProxyApiKey ? "SET" : "NOT SET"}`,
			);
			opencodeEnv.ANTHROPIC_API_KEY = llmProxyApiKey;
			opencodeEnv.ANTHROPIC_BASE_URL = llmProxyBaseUrl;
		} else if (opts.envVars.ANTHROPIC_API_KEY) {
			log("[E2B/startOpenCode] WARNING: No LLM proxy, using direct key: SET");
			opencodeEnv.ANTHROPIC_API_KEY = opts.envVars.ANTHROPIC_API_KEY;
		} else {
			log("[E2B/startOpenCode] WARNING: No LLM proxy AND no direct key!");
		}
		sandbox.commands
			.run(
				`cd ${repoDir} && opencode serve --port 4096 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1`,
				{ timeoutMs: 3600000, envs: opencodeEnv }, // Long timeout, runs in background
			)
			.catch((err: unknown) => {
				console.log(`[E2B] OpenCode process ended: ${err}`);
			});
		// Don't await - let it run in background
	}

	/**
	 * Setup additional dependencies (async - fire and forget):
	 * - Start services (Postgres, Redis, Mailcatcher)
	 * - Start Caddy preview proxy
	 */
	private async setupAdditionalDependencies(
		sandbox: Sandbox,
		log: (msg: string) => void,
	): Promise<void> {
		// Start services (PostgreSQL, Redis, Mailcatcher)
		log("Starting services (async)...");
		await sandbox.commands.run("/usr/local/bin/start-services.sh", {
			timeoutMs: 30000,
		});

		// Start Caddy for preview proxy (run in background, non-blocking)
		log("Starting Caddy preview proxy (async)...");
		await sandbox.files.write(SANDBOX_PATHS.caddyfile, DEFAULT_CADDYFILE);
		sandbox.commands
			.run(`caddy run --config ${SANDBOX_PATHS.caddyfile}`, {
				timeoutMs: 3600000,
			})
			.catch((err: unknown) => {
				console.log(`[E2B] Caddy process ended: ${err}`);
			});
		// Don't await - runs in background
	}

	async snapshot(sessionId: string, sandboxId: string): Promise<SnapshotResult> {
		console.log(`[E2B] Taking snapshot of session ${sessionId}`);
		return this.pause(sessionId, sandboxId);
	}

	async pause(sessionId: string, sandboxId: string): Promise<PauseResult> {
		console.log(`[E2B] Pausing sandbox for session ${sessionId}`);

		// The sandboxId becomes the snapshot ID for E2B (can resume with connect)
		console.log("[E2B] Pausing sandbox (creating snapshot)...");
		await Sandbox.betaPause(sandboxId, getE2BApiOpts());

		console.log(`[E2B] Snapshot created: ${sandboxId}`);
		return { snapshotId: sandboxId };
	}

	async terminate(sessionId: string, sandboxId?: string): Promise<void> {
		console.log(`[E2B] Terminating session ${sessionId}`);

		if (!sandboxId) {
			throw new SandboxProviderError({
				provider: "e2b",
				operation: "terminate",
				message: "sandboxId is required for terminate",
				isRetryable: false,
			});
		}

		try {
			await Sandbox.kill(sandboxId, getE2BApiOpts());
			console.log(`[E2B] Sandbox ${sandboxId} terminated`);
		} catch (error) {
			// Check if it's a "not found" error - sandbox already terminated is idempotent
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (
				errorMessage.includes("not found") ||
				errorMessage.includes("404") ||
				errorMessage.includes("does not exist")
			) {
				console.log(`[E2B] Sandbox ${sandboxId} already terminated (idempotent)`);
				return;
			}

			throw SandboxProviderError.fromError(error, "e2b", "terminate");
		}
	}

	async writeEnvFile(sandboxId: string, envVars: Record<string, string>): Promise<void> {
		console.log(`[E2B] Writing env vars to sandbox ${sandboxId.slice(0, 16)}...`);

		const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());

		// Merge with existing env vars if any
		let existing: Record<string, string> = {};
		try {
			const existingJson = await sandbox.files.read(ENV_FILE);
			if (existingJson.trim()) {
				existing = JSON.parse(existingJson);
			}
		} catch {
			// File doesn't exist yet
		}

		const merged = { ...existing, ...envVars };
		await sandbox.files.write(ENV_FILE, JSON.stringify(merged));

		console.log(`[E2B] Wrote ${Object.keys(envVars).length} env vars to sandbox`);
	}

	async health(): Promise<boolean> {
		// E2B health is determined by whether we can make API calls
		// Actually call the API to validate the key
		try {
			// Check if we have the required env var first
			if (!env.E2B_API_KEY) {
				console.warn("[E2B] Health check failed: E2B_API_KEY not set");
				return false;
			}

			// Call Sandbox.list() to validate the API key works
			// This makes a real API call without creating or modifying any sandboxes
			await Sandbox.list(getE2BApiOpts());
			return true;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.warn(`[E2B] Health check failed: ${errorMessage}`);
			return false;
		}
	}

	async resolveTunnels(sandboxId: string): Promise<{ openCodeUrl: string; previewUrl: string }> {
		const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
		const tunnelHost = sandbox.getHost(4096);
		const previewHost = sandbox.getHost(20000);

		return {
			openCodeUrl: tunnelHost ? `https://${tunnelHost}` : "",
			previewUrl: previewHost ? `https://${previewHost}` : "",
		};
	}

	/**
	 * Read files from a folder in the sandbox filesystem.
	 * Used by the verify tool to upload verification evidence.
	 */
	async readFiles(sandboxId: string, folderPath: string): Promise<FileContent[]> {
		console.log(`[E2B] Reading files from ${folderPath} in sandbox ${sandboxId.slice(0, 16)}...`);

		const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
		const exists = await sandbox.files.exists(folderPath);

		if (!exists) {
			console.log(`[E2B] Folder ${folderPath} does not exist`);
			return [];
		}

		const normalizedFolder = folderPath.replace(/\/$/, "");
		const files: FileContent[] = [];
		const directories: string[] = [normalizedFolder];

		while (directories.length > 0) {
			const dir = directories.pop();
			if (!dir) break;

			const entries = await sandbox.files.list(dir).catch((err) => {
				console.warn(`[E2B] Failed to list directory ${dir}:`, err);
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
					console.warn(`[E2B] Failed to read file ${entry.path}:`, err);
				}
			}
		}

		console.log(`[E2B] Read ${files.length} file(s) from ${folderPath}`);
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
					console.log(`[E2B] Sandbox ${id.slice(0, 16)}... not running`);
				}
			}

			return alive;
		} catch (error) {
			// If the list call fails, we can't determine status
			// Log the error but don't throw - return empty array as safe default
			console.error(`[E2B] Failed to list sandboxes: ${error}`);
			return [];
		}
	}
}
