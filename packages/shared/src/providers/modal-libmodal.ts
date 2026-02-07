/**
 * Modal Sandbox Provider (libmodal SDK)
 *
 * Uses the Modal JavaScript SDK directly instead of HTTP calls to FastAPI.
 * This eliminates the Python FastAPI layer and uses shared TypeScript modules.
 *
 * Prerequisites:
 * 1. Modal Image must be deployed (see packages/modal-sandbox/image.py)
 * 2. Set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import { type App, type Image, ModalClient, type Sandbox } from "modal";
import { getDefaultAgentConfig, toOpencodeModelId } from "../agents";
import { getLLMProxyBaseURL } from "../llm-proxy";
import { getSharedLogger } from "../logger";
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
	SANDBOX_PORTS,
	SANDBOX_TIMEOUT_MS,
	type SandboxOperation,
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

// TextEncoder/TextDecoder for file operations (Modal SDK requires Uint8Array)
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Configuration from environment
const MODAL_APP_NAME = env.MODAL_APP_NAME;
const MODAL_APP_SUFFIX = env.MODAL_APP_SUFFIX;

const providerLogger = getSharedLogger().child({ module: "modal" });
const logLatency = (event: string, data?: Record<string, unknown>) => {
	providerLogger.info({ ...data, latency: true }, event);
};

function normalizeModalEnvValue(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	// Some secret managers / .env tooling can accidentally wrap values in quotes.
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		const unquoted = trimmed.slice(1, -1).trim();
		return unquoted || undefined;
	}

	return trimmed;
}

const looksLikeModalTokenId = (value: string | undefined) =>
	!!value && /^ak-[a-zA-Z0-9_-]+$/.test(value);
const looksLikeModalTokenSecret = (value: string | undefined) =>
	!!value && /^as-[a-zA-Z0-9_-]+$/.test(value);

function getModalAuthConfigHint(
	tokenId: string | undefined,
	tokenSecret: string | undefined,
): string {
	const hints: string[] = [];

	if (tokenId?.startsWith("as-") && tokenSecret?.startsWith("ak-")) {
		hints.push("MODAL_TOKEN_ID and MODAL_TOKEN_SECRET look swapped.");
	}

	if (tokenId && !looksLikeModalTokenId(tokenId)) {
		hints.push("MODAL_TOKEN_ID should look like 'ak-...'.");
	}

	if (tokenSecret && !looksLikeModalTokenSecret(tokenSecret)) {
		hints.push("MODAL_TOKEN_SECRET should look like 'as-...'.");
	}

	if (!tokenId || !tokenSecret) {
		hints.push(
			"Set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET (or run `modal setup` to create ~/.modal.toml).",
		);
	}

	return hints.join(" ");
}

/**
 * Get the full Modal app name (with optional suffix for per-developer deployments)
 */
function getModalAppName(): string {
	if (!MODAL_APP_NAME) {
		throw new Error("MODAL_APP_NAME is required to use the Modal provider");
	}
	return MODAL_APP_SUFFIX ? `${MODAL_APP_NAME}-${MODAL_APP_SUFFIX}` : MODAL_APP_NAME;
}

/**
 * Modal provider using the JavaScript SDK (libmodal).
 *
 * This provider creates sandboxes directly using the Modal SDK,
 * eliminating the need for the Python FastAPI layer.
 */
export class ModalLibmodalProvider implements SandboxProvider {
	readonly type = "modal" as const;
	readonly supportsPause = false;
	readonly supportsAutoPause = false;
	private client: ModalClient;
	private app: App | null = null;
	private image: Image | null = null;
	private authPreflight: Promise<void> | null = null;

	constructor() {
		// NOTE: libmodal reads from env and ~/.modal.toml, but we prefer env in production.
		// Normalize to avoid accidental quotes/newlines in secret manager values.
		const tokenId = normalizeModalEnvValue(env.MODAL_TOKEN_ID);
		const tokenSecret = normalizeModalEnvValue(env.MODAL_TOKEN_SECRET);
		const endpoint = normalizeModalEnvValue(env.MODAL_ENDPOINT_URL);

		this.client = new ModalClient({ tokenId, tokenSecret, endpoint });
	}

	private async ensureModalAuth(operation: SandboxOperation): Promise<void> {
		if (!this.authPreflight) {
			this.authPreflight = this.runModalAuthPreflight(operation);
		}

		try {
			await this.authPreflight;
		} catch (error) {
			// Allow retry after transient failures (or after fixing env in dev + restart).
			this.authPreflight = null;
			throw error;
		}
	}

	private async runModalAuthPreflight(operation: SandboxOperation): Promise<void> {
		const tokenId = normalizeModalEnvValue(env.MODAL_TOKEN_ID);
		const tokenSecret = normalizeModalEnvValue(env.MODAL_TOKEN_SECRET);
		const startMs = Date.now();

		// Fast fail on obvious misconfig to avoid triggering libmodal's background auth loop,
		// which can otherwise surface as an unhandled promise rejection on auth failures.
		if (
			(tokenId || tokenSecret) &&
			(!looksLikeModalTokenId(tokenId) || !looksLikeModalTokenSecret(tokenSecret))
		) {
			throw new SandboxProviderError({
				provider: "modal",
				operation,
				message: getModalAuthConfigHint(tokenId, tokenSecret),
				isRetryable: false,
			});
		}

		try {
			// AuthTokenGet does not start libmodal's background token refresh.
			await this.client.cpClient.authTokenGet({});
			logLatency("provider.auth_preflight.ok", {
				provider: this.type,
				operation,
				durationMs: Date.now() - startMs,
			});
		} catch (error) {
			const hint = getModalAuthConfigHint(tokenId, tokenSecret);
			const rawMessage = error instanceof Error ? error.message : String(error);
			logLatency("provider.auth_preflight.error", {
				provider: this.type,
				operation,
				durationMs: Date.now() - startMs,
				error: rawMessage,
			});

			throw new SandboxProviderError({
				provider: "modal",
				operation,
				message: hint ? `${hint} (${rawMessage})` : rawMessage,
				isRetryable: false,
				raw: error,
				cause: error instanceof Error ? error : undefined,
			});
		}
	}

	/**
	 * Initialize the Modal app and image references.
	 * Called lazily on first operation.
	 */
	private async ensureInitialized(): Promise<{ app: App; image: Image }> {
		if (this.app && this.image) {
			return { app: this.app, image: this.image };
		}

		const startMs = Date.now();
		await this.ensureModalAuth("createSandbox");
		logLatency("provider.initialize.auth_ok", {
			provider: this.type,
			durationMs: Date.now() - startMs,
		});

		const appName = getModalAppName();

		// Get the app reference (creates if missing)
		const appStartMs = Date.now();
		this.app = await this.client.apps.fromName(appName, { createIfMissing: true });
		logLatency("provider.initialize.app_loaded", {
			provider: this.type,
			durationMs: Date.now() - appStartMs,
		});

		// Get the base image ID from the deployed Modal function
		// This avoids hardcoding or env vars - the deploy.py exposes the image ID
		const fnStartMs = Date.now();
		const getImageFn = await this.client.functions.fromName(appName, "get_image_id");
		const webUrl = await getImageFn.getWebUrl();
		logLatency("provider.initialize.get_image_id_url", {
			provider: this.type,
			durationMs: Date.now() - fnStartMs,
			hasWebUrl: Boolean(webUrl),
		});

		if (!webUrl) {
			throw new SandboxProviderError({
				provider: "modal",
				operation: "createSandbox",
				message:
					"get_image_id endpoint not found. Deploy the Modal app first: modal deploy packages/modal-sandbox/deploy.py",
				isRetryable: false,
			});
		}

		// Call the web endpoint to get the image ID
		const fetchStartMs = Date.now();
		const response = await fetch(webUrl);
		if (!response.ok) {
			logLatency("provider.initialize.get_image_id_http_error", {
				provider: this.type,
				status: response.status,
				durationMs: Date.now() - fetchStartMs,
			});
			throw new SandboxProviderError({
				provider: "modal",
				operation: "createSandbox",
				message: `Failed to get base image ID: ${response.status}`,
				isRetryable: true,
			});
		}

		const { image_id: imageId } = (await response.json()) as { image_id: string };
		logLatency("provider.initialize.get_image_id_ok", {
			provider: this.type,
			durationMs: Date.now() - fetchStartMs,
		});
		const imageStartMs = Date.now();
		this.image = await this.client.images.fromId(imageId);
		logLatency("provider.initialize.image_loaded", {
			provider: this.type,
			durationMs: Date.now() - imageStartMs,
		});
		logLatency("provider.initialize.complete", {
			provider: this.type,
			durationMs: Date.now() - startMs,
		});

		return { app: this.app, image: this.image };
	}

	async createSandbox(opts: CreateSandboxOpts): Promise<CreateSandboxResult> {
		const startTime = Date.now();
		const shortId = opts.sessionId.slice(0, 8);
		const log = providerLogger.child({ sessionId: opts.sessionId, shortId });

		logLatency("provider.create_sandbox.start", {
			provider: this.type,
			sessionId: opts.sessionId,
			shortId,
			repoCount: opts.repos.length,
			hasSnapshotId: Boolean(opts.snapshotId),
			timeoutMs: SANDBOX_TIMEOUT_MS,
		});

		log.debug(
			{ repoCount: opts.repos.length, snapshotId: opts.snapshotId || "none" },
			"Creating session",
		);

		try {
			const authStartMs = Date.now();
			await this.ensureModalAuth("createSandbox");
			logLatency("provider.create_sandbox.auth_ok", {
				provider: this.type,
				sessionId: opts.sessionId,
				shortId,
				durationMs: Date.now() - authStartMs,
			});
			const { app } = await this.ensureInitialized();
			const isSnapshot = !!opts.snapshotId;

			// Use snapshot image if restoring, otherwise use base image
			let sandboxImage: Image;
			if (isSnapshot) {
				log.debug({ snapshotId: opts.snapshotId }, "Restoring from snapshot");
				const imageStartMs = Date.now();
				sandboxImage = await this.client.images.fromId(opts.snapshotId!);
				logLatency("provider.create_sandbox.snapshot_image_loaded", {
					provider: this.type,
					sessionId: opts.sessionId,
					shortId,
					durationMs: Date.now() - imageStartMs,
				});
			} else {
				sandboxImage = this.image!;
			}

			// LLM Proxy configuration
			const llmProxyBaseUrl = getLLMProxyBaseURL();
			const llmProxyApiKey = opts.envVars.LLM_PROXY_API_KEY;

			// Build environment variables
			// Note: S3 credentials are NOT passed to sandbox - verify tool is intercepted by gateway
			const env: Record<string, string> = {
				SESSION_ID: opts.sessionId,
				// Critical: Disable OpenCode's npm-based auth plugins that don't survive snapshots
				OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
			};

			// Only include ANTHROPIC_API_KEY if NOT using proxy
			if (llmProxyBaseUrl && llmProxyApiKey) {
				log.debug({ llmProxyBaseUrl, hasApiKey: !!llmProxyApiKey }, "Using LLM proxy");
				env.ANTHROPIC_API_KEY = llmProxyApiKey;
				env.ANTHROPIC_BASE_URL = llmProxyBaseUrl;
			} else {
				const hasDirectKey = !!opts.envVars.ANTHROPIC_API_KEY;
				log.warn({ hasDirectKey }, "No LLM proxy, using direct key");
				env.ANTHROPIC_API_KEY = opts.envVars.ANTHROPIC_API_KEY || "";
			}

			// Add other env vars (filter out sensitive keys when using proxy)
			for (const [key, value] of Object.entries(opts.envVars)) {
				if (
					key === "ANTHROPIC_API_KEY" ||
					key === "LLM_PROXY_API_KEY" ||
					key === "ANTHROPIC_BASE_URL"
				)
					continue;
				env[key] = value;
			}

			// Calculate expiration time before creating sandbox
			const sandboxCreatedAt = Date.now();

			// Create sandbox with Modal SDK
			// Note: command starts Docker daemon, experimentalOptions enables Docker support
			// SSH uses unencryptedPorts for raw TCP (SSH handles its own encryption)
			const createStartMs = Date.now();
			const sandbox = await this.client.sandboxes.create(app, sandboxImage, {
				command: ["/usr/local/bin/start-dockerd.sh"],
				encryptedPorts: [SANDBOX_PORTS.opencode, SANDBOX_PORTS.preview],
				unencryptedPorts: [SANDBOX_PORTS.ssh],
				env,
				timeoutMs: SANDBOX_TIMEOUT_MS,
				name: opts.sessionId,
				cpu: 2,
				memoryMiB: 4096,
				experimentalOptions: { enable_docker: true },
			});
			logLatency("provider.create_sandbox.sandbox_created", {
				provider: this.type,
				sessionId: opts.sessionId,
				shortId,
				durationMs: Date.now() - createStartMs,
			});

			log.debug({ sandboxId: sandbox.sandboxId }, "Sandbox created");

			// Get tunnel URLs
			const tunnelsStartMs = Date.now();
			const tunnels = await sandbox.tunnels(30000);
			logLatency("provider.create_sandbox.tunnels", {
				provider: this.type,
				sessionId: opts.sessionId,
				shortId,
				durationMs: Date.now() - tunnelsStartMs,
			});
			const opencodeTunnel = tunnels[SANDBOX_PORTS.opencode];
			const previewTunnel = tunnels[SANDBOX_PORTS.preview];
			const sshTunnel = tunnels[SANDBOX_PORTS.ssh];

			const tunnelUrl = opencodeTunnel?.url || "";
			const previewUrl = previewTunnel?.url || "";
			// SSH uses unencrypted port which returns raw TCP host:port (not HTTPS URL)
			const sshHost = sshTunnel?.unencryptedHost || "";
			const sshPort = sshTunnel?.unencryptedPort || 0;

			log.debug({ tunnelUrl, previewUrl, sshHost, sshPort }, "Tunnel URLs resolved");

			// Setup the sandbox (clone repos or restore from snapshot)
			const setupWorkspaceStartMs = Date.now();
			const repoDir = await this.setupSandbox(sandbox, opts, isSnapshot, log);
			logLatency("provider.create_sandbox.setup_workspace", {
				provider: this.type,
				sessionId: opts.sessionId,
				shortId,
				isSnapshot,
				durationMs: Date.now() - setupWorkspaceStartMs,
			});

			// Setup essential dependencies (blocking - must complete before API returns)
			const essentialStartMs = Date.now();
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
				shortId,
				durationMs: Date.now() - essentialStartMs,
			});

			// Setup additional dependencies (async - fire and forget)
			logLatency("provider.create_sandbox.setup_additional.start_async", {
				provider: this.type,
				sessionId: opts.sessionId,
				shortId,
			});
			this.setupAdditionalDependencies(sandbox, log).catch((err) => {
				log.warn({ err }, "Additional dependencies setup failed");
				logLatency("provider.create_sandbox.setup_additional.error", {
					provider: this.type,
					sessionId: opts.sessionId,
					shortId,
					error: err instanceof Error ? err.message : String(err),
				});
			});

			// Wait for OpenCode to be ready
			if (tunnelUrl) {
				log.debug("Waiting for OpenCode readiness");
				try {
					const readyStartMs = Date.now();
					await waitForOpenCodeReady(tunnelUrl, 30000, (msg) => log.debug(msg));
					logLatency("provider.create_sandbox.opencode_ready", {
						provider: this.type,
						sessionId: opts.sessionId,
						shortId,
						durationMs: Date.now() - readyStartMs,
						timeoutMs: 30000,
					});
				} catch (error) {
					logLatency("provider.create_sandbox.opencode_ready.warn", {
						provider: this.type,
						sessionId: opts.sessionId,
						shortId,
						timeoutMs: 30000,
						error: error instanceof Error ? error.message : String(error),
					});
					log.warn({ err: error }, "OpenCode readiness check failed");
				}
			}

			logLatency("provider.create_sandbox.complete", {
				provider: this.type,
				sessionId: opts.sessionId,
				shortId,
				durationMs: Date.now() - startTime,
				isSnapshot,
			});
			return {
				sandboxId: sandbox.sandboxId,
				tunnelUrl,
				previewUrl,
				sshHost: sshHost || undefined,
				sshPort: sshPort || undefined,
				expiresAt: sandboxCreatedAt + SANDBOX_TIMEOUT_MS,
			};
		} catch (error) {
			logLatency("provider.create_sandbox.error", {
				provider: this.type,
				sessionId: opts.sessionId,
				shortId,
				durationMs: Date.now() - startTime,
				error: error instanceof Error ? error.message : String(error),
			});
			throw SandboxProviderError.fromError(error, "modal", "createSandbox");
		}
	}

	async ensureSandbox(opts: CreateSandboxOpts): Promise<EnsureSandboxResult> {
		const startTime = Date.now();
		const shortId = opts.sessionId.slice(0, 8);
		const log = providerLogger.child({ sessionId: opts.sessionId, shortId });

		log.debug("Ensuring sandbox");
		logLatency("provider.ensure_sandbox.start", {
			provider: this.type,
			sessionId: opts.sessionId,
			shortId,
			hasSnapshotId: Boolean(opts.snapshotId),
		});

		// For Modal, sessionId IS the sandbox identifier (we use it as the unique name)
		// This is equivalent to E2B using currentSandboxId - both are "find by ID"
		const findStartMs = Date.now();
		const existingSandboxId = await this.findSandbox(opts.sessionId);
		logLatency("provider.ensure_sandbox.find_existing", {
			provider: this.type,
			sessionId: opts.sessionId,
			shortId,
			durationMs: Date.now() - findStartMs,
			found: Boolean(existingSandboxId),
		});

		if (existingSandboxId) {
			log.debug({ sandboxId: existingSandboxId }, "Found existing sandbox");
			const resolveStartMs = Date.now();
			const tunnels = await this.resolveTunnels(existingSandboxId);
			logLatency("provider.ensure_sandbox.resolve_tunnels", {
				provider: this.type,
				sessionId: opts.sessionId,
				shortId,
				durationMs: Date.now() - resolveStartMs,
				hasTunnelUrl: Boolean(tunnels.openCodeUrl),
				hasPreviewUrl: Boolean(tunnels.previewUrl),
			});
			logLatency("provider.ensure_sandbox.complete", {
				provider: this.type,
				sessionId: opts.sessionId,
				shortId,
				recovered: true,
				durationMs: Date.now() - startTime,
			});
			return {
				sandboxId: existingSandboxId,
				tunnelUrl: tunnels.openCodeUrl,
				previewUrl: tunnels.previewUrl,
				recovered: true,
			};
		}

		log.debug("No existing sandbox found, creating new");
		const result = await this.createSandbox(opts);
		logLatency("provider.ensure_sandbox.complete", {
			provider: this.type,
			sessionId: opts.sessionId,
			shortId,
			recovered: false,
			durationMs: Date.now() - startTime,
		});
		return { ...result, recovered: false };
	}

	/**
	 * Find a running sandbox by session ID.
	 * For Modal, we use sessionId as the sandbox name, making it a unique identifier.
	 */
	private async findSandbox(sessionId: string): Promise<string | null> {
		try {
			await this.ensureModalAuth("createSandbox");
			const appName = getModalAppName();
			const sandbox = await this.client.sandboxes.fromName(appName, sessionId);
			return sandbox.sandboxId;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes("not found") || errorMessage.includes("NotFound")) {
				return null;
			}
			providerLogger.error({ err: error }, "Failed to find sandbox");
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
		const workspaceDir = `${SANDBOX_PATHS.home}/workspace`;

		if (isSnapshot) {
			// Snapshot restore: repos are already in the filesystem, just read metadata
			log.debug("Restoring from snapshot - reading metadata");
			try {
				const metadataFile = await sandbox.open(SANDBOX_PATHS.metadataFile, "r");
				const metadataBytes = await metadataFile.read();
				await metadataFile.close();
				const metadata: SessionMetadata = JSON.parse(decoder.decode(metadataBytes));
				log.debug({ repoDir: metadata.repoDir }, "Found repo from metadata");
				return metadata.repoDir;
			} catch {
				// Fallback if metadata doesn't exist (legacy snapshots)
				log.debug("Metadata not found, using default workspace path");
				return workspaceDir;
			}
		}

		// Fresh sandbox: clone repositories
		log.debug("Setting up workspace");
		await sandbox.exec(["mkdir", "-p", workspaceDir]);

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
			const credsFile = await sandbox.open("/tmp/.git-credentials.json", "w");
			await credsFile.write(encoder.encode(JSON.stringify(gitCredentials)));
			await credsFile.close();
		}

		// Clone each repository
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
				await sandbox.exec([
					"git",
					"clone",
					"--depth",
					"1",
					"--branch",
					opts.branch,
					cloneUrl,
					targetDir,
				]);
			} catch {
				log.debug({ repo: repo.workspacePath }, "Branch clone failed, trying default");
				await sandbox.exec(["git", "clone", "--depth", "1", cloneUrl, targetDir]);
			}
		}

		// Set repoDir (first repo for single, workspace root for multi)
		const repoDir = opts.repos.length > 1 ? workspaceDir : firstRepoDir || workspaceDir;
		log.debug("All repositories cloned");

		// Save session metadata (use base64 + sh -c to make mkdir + write atomic)
		const metadata: SessionMetadata = {
			sessionId: opts.sessionId,
			repoDir,
			createdAt: Date.now(),
		};
		const metadataDir = SANDBOX_PATHS.metadataFile.replace(/\/[^/]+$/, "");
		const metadataContent = JSON.stringify(metadata, null, 2);
		const metadataBase64 = Buffer.from(metadataContent).toString("base64");
		await sandbox.exec([
			"sh",
			"-c",
			`mkdir -p ${metadataDir} && echo '${metadataBase64}' | base64 -d > ${SANDBOX_PATHS.metadataFile}`,
		]);
		log.debug("Session metadata saved");

		return repoDir;
	}

	/**
	 * Setup essential dependencies (blocking - must complete before API returns):
	 * - Write all config files in parallel (each ensures its directory exists)
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
		const localToolDir = `${repoDir}/.opencode/tool`;

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

		const basePrompt = opts.systemPrompt || "You are a senior engineer working on this codebase.";
		const instructions = `${basePrompt}\n\n${ENV_INSTRUCTIONS}`;

		// Helper to write a file atomically (mkdir + write in single sh -c to avoid race conditions)
		const writeFile = async (path: string, content: string) => {
			const dir = path.substring(0, path.lastIndexOf("/"));
			const base64Content = Buffer.from(content).toString("base64");
			await sandbox.exec([
				"sh",
				"-c",
				`mkdir -p '${dir}' && echo '${base64Content}' | base64 -d > '${path}'`,
			]);
		};

		// Write all files in parallel (each write ensures its directory exists)
		log.debug("Writing OpenCode files (parallel)");
		const writePromises = [
			// Plugin
			writeFile(`${SANDBOX_PATHS.globalPluginDir}/proliferate.mjs`, PLUGIN_MJS),
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
			writeFile(`${SANDBOX_PATHS.globalOpencodeDir}/opencode.json`, opencodeConfig),
			writeFile(`${repoDir}/opencode.json`, opencodeConfig),
			// Instructions
			writeFile(`${repoDir}/.opencode/instructions.md`, instructions),
			// Copy pre-installed tool dependencies (saves time vs installing on startup)
			(async () => {
				await sandbox.exec([
					"sh",
					"-c",
					`mkdir -p '${localToolDir}' && ` +
						`cp '${SANDBOX_PATHS.preinstalledToolsDir}/package.json' '${localToolDir}/' && ` +
						`cp -r '${SANDBOX_PATHS.preinstalledToolsDir}/node_modules' '${localToolDir}/'`,
				]);
			})(),
		];

		// Add SSH public key if provided (for rsync from CLI)
		if (opts.sshPublicKey) {
			log.debug("Writing SSH authorized_keys");
			writePromises.push(
				writeFile("/root/.ssh/authorized_keys", opts.sshPublicKey),
				writeFile("/home/user/.ssh/authorized_keys", opts.sshPublicKey),
			);
		}

		// Write trigger context if provided (for automation-triggered sessions)
		if (opts.triggerContext) {
			log.debug("Writing trigger context");
			writePromises.push(
				writeFile(
					`${repoDir}/.proliferate/trigger-context.json`,
					JSON.stringify(opts.triggerContext, null, 2),
				),
			);
		}

		await Promise.all(writePromises);

		// Start sshd if SSH key was provided (CLI sessions need SSH ready immediately)
		if (opts.sshPublicKey) {
			log.debug("Starting sshd for CLI session");
			// Generate host keys if needed and start sshd
			await sandbox.exec([
				"sh",
				"-c",
				"ssh-keygen -A 2>/dev/null || true; mkdir -p /run/sshd; /usr/sbin/sshd",
			]);
			log.debug("sshd started");
		}

		// Start OpenCode server in background
		log.debug("Starting OpenCode server");
		const opencodeEnv: Record<string, string> = {
			SESSION_ID: opts.sessionId,
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
		sandbox
			.exec(["sh", "-c", `cd ${repoDir} && opencode serve --port 4096 --hostname 0.0.0.0`], {
				env: opencodeEnv,
			})
			.catch(() => {
				// Expected - runs until sandbox terminates
			});
	}

	/**
	 * Setup additional dependencies (async - fire and forget):
	 * - Start services (Postgres, Redis, Mailcatcher)
	 * - Start Caddy preview proxy
	 */
	private async setupAdditionalDependencies(sandbox: Sandbox, log: Logger): Promise<void> {
		// Start services
		log.debug("Starting services (async)");
		await sandbox.exec(["/usr/local/bin/start-services.sh"]);

		// Write and start Caddy
		log.debug("Starting Caddy preview proxy (async)");
		const caddyFile = await sandbox.open(SANDBOX_PATHS.caddyfile, "w");
		await caddyFile.write(encoder.encode(DEFAULT_CADDYFILE));
		await caddyFile.close();

		// Start Caddy in background (don't wait)
		sandbox.exec(["caddy", "run", "--config", SANDBOX_PATHS.caddyfile]).catch(() => {
			// Expected - runs until sandbox terminates
		});
	}

	async snapshot(sessionId: string, sandboxId: string): Promise<SnapshotResult> {
		providerLogger.info({ sessionId }, "Taking snapshot");
		const startMs = Date.now();

		try {
			await this.ensureModalAuth("snapshot");
			// Get sandbox by ID and take a filesystem snapshot
			const fromIdStartMs = Date.now();
			const sandbox = await this.client.sandboxes.fromId(sandboxId);
			logLatency("provider.snapshot.from_id", {
				provider: this.type,
				sessionId,
				shortId: sessionId.slice(0, 8),
				durationMs: Date.now() - fromIdStartMs,
			});
			const snapshotStartMs = Date.now();
			const snapshotImage = await sandbox.snapshotFilesystem();
			logLatency("provider.snapshot.filesystem", {
				provider: this.type,
				sessionId,
				shortId: sessionId.slice(0, 8),
				durationMs: Date.now() - snapshotStartMs,
			});

			providerLogger.info({ snapshotId: snapshotImage.imageId }, "Snapshot created");
			logLatency("provider.snapshot.complete", {
				provider: this.type,
				sessionId,
				shortId: sessionId.slice(0, 8),
				durationMs: Date.now() - startMs,
			});
			return { snapshotId: snapshotImage.imageId };
		} catch (error) {
			logLatency("provider.snapshot.error", {
				provider: this.type,
				sessionId,
				shortId: sessionId.slice(0, 8),
				durationMs: Date.now() - startMs,
				error: error instanceof Error ? error.message : String(error),
			});
			throw SandboxProviderError.fromError(error, "modal", "snapshot");
		}
	}

	async pause(_sessionId: string, _sandboxId: string): Promise<PauseResult> {
		throw new SandboxProviderError({
			provider: "modal",
			operation: "pause",
			message: "pause is not supported for modal sandboxes",
			isRetryable: false,
		});
	}

	async terminate(sessionId: string, sandboxId?: string): Promise<void> {
		providerLogger.info({ sessionId }, "Terminating session");
		const startMs = Date.now();

		if (!sandboxId) {
			throw new SandboxProviderError({
				provider: "modal",
				operation: "terminate",
				message: "sandboxId is required for terminate",
				isRetryable: false,
			});
		}

		try {
			await this.ensureModalAuth("terminate");
			const fromIdStartMs = Date.now();
			const sandbox = await this.client.sandboxes.fromId(sandboxId);
			logLatency("provider.terminate.from_id", {
				provider: this.type,
				sessionId,
				shortId: sessionId.slice(0, 8),
				durationMs: Date.now() - fromIdStartMs,
			});
			const terminateStartMs = Date.now();
			await sandbox.terminate();
			logLatency("provider.terminate.call", {
				provider: this.type,
				sessionId,
				shortId: sessionId.slice(0, 8),
				durationMs: Date.now() - terminateStartMs,
			});
			providerLogger.info({ sandboxId }, "Sandbox terminated");
			logLatency("provider.terminate.complete", {
				provider: this.type,
				sessionId,
				shortId: sessionId.slice(0, 8),
				durationMs: Date.now() - startMs,
			});
		} catch (error) {
			// Check for "not found" - treat as idempotent success
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes("not found") || errorMessage.includes("404")) {
				providerLogger.debug({ sandboxId }, "Sandbox already terminated (idempotent)");
				logLatency("provider.terminate.idempotent", {
					provider: this.type,
					sessionId,
					shortId: sessionId.slice(0, 8),
					durationMs: Date.now() - startMs,
				});
				return;
			}
			logLatency("provider.terminate.error", {
				provider: this.type,
				sessionId,
				shortId: sessionId.slice(0, 8),
				durationMs: Date.now() - startMs,
				error: errorMessage,
			});
			throw SandboxProviderError.fromError(error, "modal", "terminate");
		}
	}

	async writeEnvFile(sandboxId: string, envVars: Record<string, string>): Promise<void> {
		providerLogger.debug({ sandboxId: sandboxId.slice(0, 16) }, "Writing env vars to sandbox");
		const startMs = Date.now();

		try {
			await this.ensureModalAuth("writeEnvFile");
			const fromIdStartMs = Date.now();
			const sandbox = await this.client.sandboxes.fromId(sandboxId);
			logLatency("provider.write_env_file.from_id", {
				provider: this.type,
				sandboxId,
				durationMs: Date.now() - fromIdStartMs,
			});

			// Read existing env vars if any
			let existing: Record<string, string> = {};
			try {
				const readStartMs = Date.now();
				const existingFile = await sandbox.open(ENV_FILE, "r");
				const existingBytes = await existingFile.read();
				await existingFile.close();
				logLatency("provider.write_env_file.read_existing", {
					provider: this.type,
					sandboxId,
					durationMs: Date.now() - readStartMs,
				});
				if (existingBytes.length > 0) {
					existing = JSON.parse(decoder.decode(existingBytes));
				}
			} catch {
				// File doesn't exist yet
			}

			// Merge and write
			const merged = { ...existing, ...envVars };
			const writeStartMs = Date.now();
			const envFile = await sandbox.open(ENV_FILE, "w");
			await envFile.write(encoder.encode(JSON.stringify(merged)));
			await envFile.close();
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
		} catch (error) {
			logLatency("provider.write_env_file.error", {
				provider: this.type,
				sandboxId,
				durationMs: Date.now() - startMs,
				error: error instanceof Error ? error.message : String(error),
			});
			throw SandboxProviderError.fromError(error, "modal", "writeEnvFile");
		}
	}

	async health(): Promise<boolean> {
		try {
			await this.ensureModalAuth("health");
			// Test the connection by listing sandboxes (limited)
			await this.client.sandboxes.list();
			return true;
		} catch (error) {
			providerLogger.warn({ err: error }, "Health check failed");
			return false;
		}
	}

	async checkSandboxes(sandboxIds: string[]): Promise<string[]> {
		if (sandboxIds.length === 0) {
			return [];
		}

		try {
			await this.ensureModalAuth("checkSandboxes");
			// List all running sandboxes
			const runningSandboxes: string[] = [];
			for await (const sandbox of this.client.sandboxes.list()) {
				runningSandboxes.push(sandbox.sandboxId);
			}

			// Filter to only the requested IDs that are running
			const runningSet = new Set(runningSandboxes);
			const alive = sandboxIds.filter((id) => runningSet.has(id));

			// Log sandboxes that are no longer running
			for (const id of sandboxIds) {
				if (!runningSet.has(id)) {
					providerLogger.debug({ sandboxId: id.slice(0, 16) }, "Sandbox not running");
				}
			}

			return alive;
		} catch (error) {
			providerLogger.error({ err: error }, "Failed to list sandboxes");
			return [];
		}
	}

	/**
	 * Resolve tunnel URLs for an existing sandbox.
	 * Used when recovering an orphaned sandbox to get its tunnel URLs.
	 */
	async resolveTunnels(sandboxId: string): Promise<{ openCodeUrl: string; previewUrl: string }> {
		providerLogger.debug({ sandboxId: sandboxId.slice(0, 16) }, "Resolving tunnels");
		const startMs = Date.now();

		try {
			await this.ensureModalAuth("resolveTunnels");
			const fromIdStartMs = Date.now();
			const sandbox = await this.client.sandboxes.fromId(sandboxId);
			logLatency("provider.resolve_tunnels.from_id", {
				provider: this.type,
				sandboxId,
				durationMs: Date.now() - fromIdStartMs,
			});
			const tunnelsStartMs = Date.now();
			const tunnels = await sandbox.tunnels(30000);
			logLatency("provider.resolve_tunnels.tunnels", {
				provider: this.type,
				sandboxId,
				durationMs: Date.now() - tunnelsStartMs,
			});

			const opencodeTunnel = tunnels[SANDBOX_PORTS.opencode];
			const previewTunnel = tunnels[SANDBOX_PORTS.preview];

			const openCodeUrl = opencodeTunnel?.url || "";
			const previewUrl = previewTunnel?.url || "";

			providerLogger.debug({ openCodeUrl, previewUrl }, "Tunnels resolved");

			logLatency("provider.resolve_tunnels.complete", {
				provider: this.type,
				sandboxId,
				durationMs: Date.now() - startMs,
				hasTunnelUrl: Boolean(openCodeUrl),
				hasPreviewUrl: Boolean(previewUrl),
			});
			return { openCodeUrl, previewUrl };
		} catch (error) {
			logLatency("provider.resolve_tunnels.error", {
				provider: this.type,
				sandboxId,
				durationMs: Date.now() - startMs,
				error: error instanceof Error ? error.message : String(error),
			});
			throw SandboxProviderError.fromError(error, "modal", "resolveTunnels");
		}
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

		try {
			await this.ensureModalAuth("readFiles");
			const sandbox = await this.client.sandboxes.fromId(sandboxId);

			// Check if folder exists
			try {
				await sandbox.exec(["test", "-d", folderPath]);
			} catch {
				providerLogger.debug({ folderPath }, "Folder does not exist");
				logLatency("provider.read_files.missing", {
					provider: this.type,
					sandboxId,
					folderPath,
					durationMs: Date.now() - startMs,
				});
				return [];
			}

			// List files recursively
			const process = await sandbox.exec(["find", folderPath, "-type", "f"]);
			const stdout = await process.stdout.readText();
			const stdoutTrimmed = stdout.trim();
			if (!stdoutTrimmed) {
				providerLogger.debug({ folderPath }, "No files found");
				logLatency("provider.read_files.empty", {
					provider: this.type,
					sandboxId,
					folderPath,
					durationMs: Date.now() - startMs,
				});
				return [];
			}

			const filePaths = stdoutTrimmed.split("\n").filter(Boolean);
			const files: FileContent[] = [];

			// Normalize folder path for relative path calculation
			const normalizedFolder = folderPath.replace(/\/$/, "");

			for (const filePath of filePaths) {
				try {
					const file = await sandbox.open(filePath, "r");
					const data = await file.read();
					await file.close();

					// Calculate relative path
					const relativePath = filePath.replace(`${normalizedFolder}/`, "");

					files.push({
						path: relativePath,
						data,
					});
				} catch (err) {
					// Log appropriate message based on error type
					const errMsg = err instanceof Error ? err.message : String(err);
					if (errMsg.includes("size exceeds")) {
						providerLogger.debug({ file: filePath.split("/").pop() }, "Skipping oversized file");
					} else {
						providerLogger.warn({ err, path: filePath }, "Failed to read file");
					}
					// Continue with other files
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
		} catch (error) {
			logLatency("provider.read_files.error", {
				provider: this.type,
				sandboxId,
				folderPath,
				durationMs: Date.now() - startMs,
				error: error instanceof Error ? error.message : String(error),
			});
			throw SandboxProviderError.fromError(error, "modal", "readFiles");
		}
	}
}
