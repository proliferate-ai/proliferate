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
	SAVE_ENV_FILES_DESCRIPTION,
	SAVE_ENV_FILES_TOOL,
	SAVE_SERVICE_COMMANDS_DESCRIPTION,
	SAVE_SERVICE_COMMANDS_TOOL,
	SAVE_SNAPSHOT_DESCRIPTION,
	SAVE_SNAPSHOT_TOOL,
	VERIFY_TOOL,
	VERIFY_TOOL_DESCRIPTION,
} from "../opencode-tools";
import {
	ACTIONS_BOOTSTRAP,
	DEFAULT_CADDYFILE,
	ENV_INSTRUCTIONS,
	PLUGIN_MJS,
	SANDBOX_PATHS,
	SANDBOX_PORTS,
	SANDBOX_TIMEOUT_MS,
	type SandboxOperation,
	SandboxProviderError,
	type SessionMetadata,
	capOutput,
	getOpencodeConfig,
	shellEscape,
	shouldPullOnRestore,
	waitForOpenCodeReady,
} from "../sandbox";
import type {
	AutoStartOutputEntry,
	CreateSandboxOpts,
	CreateSandboxResult,
	EnsureSandboxResult,
	FileContent,
	PauseResult,
	SandboxProvider,
	ServiceCommand,
	SnapshotResult,
} from "../sandbox-provider";

// TextEncoder/TextDecoder for file operations (Modal SDK requires Uint8Array)
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Configuration from environment
const MODAL_APP_NAME = env.MODAL_APP_NAME;
const MODAL_APP_SUFFIX = env.MODAL_APP_SUFFIX;
const MODAL_BASE_SNAPSHOT_ID = env.MODAL_BASE_SNAPSHOT_ID;

const providerLogger = getSharedLogger().child({ module: "modal" });
const logLatency = (event: string, data?: Record<string, unknown>) => {
	providerLogger.info(data ?? {}, event);
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
export function getModalAppName(): string {
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
	private baseImage: Image | null = null;
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

	private async ensureAppInitialized(): Promise<App> {
		if (this.app) return this.app;

		const startMs = Date.now();
		await this.ensureModalAuth("createSandbox");
		logLatency("provider.initialize.auth_ok", {
			provider: this.type,
			durationMs: Date.now() - startMs,
		});

		const appName = getModalAppName();
		const appStartMs = Date.now();
		this.app = await this.client.apps.fromName(appName, { createIfMissing: true });
		logLatency("provider.initialize.app_loaded", {
			provider: this.type,
			durationMs: Date.now() - appStartMs,
		});

		return this.app;
	}

	private async ensureBaseImageInitialized(): Promise<Image> {
		if (this.baseImage) return this.baseImage;

		const startMs = Date.now();
		await this.ensureModalAuth("createSandbox");

		const appName = getModalAppName();

		// Get the base image ID from the deployed Modal function.
		// This is only used when no base snapshot is configured.
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
		this.baseImage = await this.client.images.fromId(imageId);
		logLatency("provider.initialize.image_loaded", {
			provider: this.type,
			durationMs: Date.now() - imageStartMs,
		});

		logLatency("provider.initialize.complete", {
			provider: this.type,
			durationMs: Date.now() - startMs,
		});

		return this.baseImage;
	}

	/**
	 * Create a reusable "base snapshot" (Layer 1) with no repos.
	 *
	 * This is an explicit, admin/deploy-time action. It should never be done during a user session.
	 */
	async createBaseSnapshot(): Promise<{ snapshotId: string }> {
		const startMs = Date.now();
		providerLogger.info("Creating base snapshot");

		await this.ensureModalAuth("createSandbox");
		const app = await this.ensureAppInitialized();
		const image = await this.ensureBaseImageInitialized();

		const sandboxName = `base-snapshot-${Date.now()}`;
		const createStartMs = Date.now();
		const sandbox = await this.client.sandboxes.create(app, image, {
			command: ["sh", "-c", "rm -f /var/run/docker.pid && exec /usr/local/bin/start-dockerd.sh"],
			encryptedPorts: [SANDBOX_PORTS.opencode, SANDBOX_PORTS.preview],
			unencryptedPorts: [],
			env: {
				OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
				SESSION_ID: sandboxName,
			},
			timeoutMs: SANDBOX_TIMEOUT_MS,
			name: sandboxName,
			cpu: 2,
			memoryMiB: 4096,
			experimentalOptions: { enable_docker: true },
		});
		logLatency("provider.base_snapshot.sandbox_created", {
			provider: this.type,
			durationMs: Date.now() - createStartMs,
		});

		try {
			const workspaceDir = `${SANDBOX_PATHS.home}/workspace`;

			// Keep workspace empty so `git clone ... /home/user/workspace/.` remains valid for single-repo sessions.
			await sandbox.exec(["sh", "-c", `rm -rf '${workspaceDir}' && mkdir -p '${workspaceDir}'`]);

			// Helper to write a file atomically (mkdir + write in single sh -c to avoid race conditions).
			const writeFile = async (path: string, content: string) => {
				const dir = path.substring(0, path.lastIndexOf("/"));
				const base64Content = Buffer.from(content).toString("base64");
				await sandbox.exec([
					"sh",
					"-c",
					`mkdir -p '${dir}' && echo '${base64Content}' | base64 -d > '${path}'`,
				]);
			};

			// Bake global OpenCode configuration and plugin into the snapshot.
			const agentConfig = getDefaultAgentConfig();
			const opencodeModelId = toOpencodeModelId(agentConfig.modelId);
			await Promise.all([
				writeFile(`${SANDBOX_PATHS.globalPluginDir}/proliferate.mjs`, PLUGIN_MJS),
				writeFile(
					`${SANDBOX_PATHS.globalOpencodeDir}/opencode.json`,
					getOpencodeConfig(opencodeModelId),
				),
				writeFile(SANDBOX_PATHS.caddyfile, DEFAULT_CADDYFILE),
				// Ensure we don't accidentally treat this snapshot as a repo snapshot.
				sandbox
					.exec(["rm", "-f", SANDBOX_PATHS.metadataFile])
					.catch(() => {}),
			]);

			const snapshotStartMs = Date.now();
			const snapshotImage = await sandbox.snapshotFilesystem();
			logLatency("provider.base_snapshot.filesystem", {
				provider: this.type,
				durationMs: Date.now() - snapshotStartMs,
			});

			logLatency("provider.base_snapshot.complete", {
				provider: this.type,
				durationMs: Date.now() - startMs,
			});

			return { snapshotId: snapshotImage.imageId };
		} finally {
			// Best-effort cleanup.
			await sandbox.terminate().catch(() => {});
		}
	}

	/**
	 * Create a deterministic repo snapshot (Layer 2) from the base snapshot/image.
	 *
	 * This is intended for background jobs. It only clones the repo and snapshots the filesystem.
	 */
	async createRepoSnapshot(input: {
		repoId: string;
		repoUrl: string;
		token?: string;
		branch: string;
	}): Promise<{ snapshotId: string; commitSha: string | null }> {
		const startMs = Date.now();
		const log = providerLogger.child({ repoId: input.repoId });

		await this.ensureModalAuth("createSandbox");
		const app = await this.ensureAppInitialized();

		// Prefer base snapshot when configured to avoid get_image_id on the build path.
		const imageStartMs = Date.now();
		const baseSnapshotId = MODAL_BASE_SNAPSHOT_ID;
		const sandboxImage = baseSnapshotId
			? await this.client.images.fromId(baseSnapshotId)
			: await this.ensureBaseImageInitialized();
		logLatency("provider.repo_snapshot.image_loaded", {
			provider: this.type,
			repoId: input.repoId,
			hasBaseSnapshotId: Boolean(baseSnapshotId),
			durationMs: Date.now() - imageStartMs,
		});

		const sandboxName = `repo-snapshot-${input.repoId}-${Date.now()}`;
		const createStartMs = Date.now();
		const sandbox = await this.client.sandboxes.create(app, sandboxImage, {
			command: ["sh", "-c", "rm -f /var/run/docker.pid && exec /usr/local/bin/start-dockerd.sh"],
			encryptedPorts: [],
			unencryptedPorts: [],
			env: {
				OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
				SESSION_ID: sandboxName,
			},
			timeoutMs: SANDBOX_TIMEOUT_MS,
			name: sandboxName,
			cpu: 2,
			memoryMiB: 4096,
			experimentalOptions: { enable_docker: true },
		});
		logLatency("provider.repo_snapshot.sandbox_created", {
			provider: this.type,
			repoId: input.repoId,
			durationMs: Date.now() - createStartMs,
		});

		try {
			const workspaceDir = `${SANDBOX_PATHS.home}/workspace`;
			const cleanProc = await sandbox.exec([
				"sh",
				"-c",
				`rm -rf '${workspaceDir}' && mkdir -p '${workspaceDir}'`,
			]);
			await cleanProc.wait();

			const setupStartMs = Date.now();
			const repoDir = await this.setupSandbox(
				sandbox,
				{
					sessionId: sandboxName,
					repos: [
						{
							repoUrl: input.repoUrl,
							token: input.token,
							workspacePath: ".",
							repoId: input.repoId,
						},
					],
					branch: input.branch,
					envVars: {},
					systemPrompt: "Repo snapshot build",
				},
				false,
				log,
			);
			logLatency("provider.repo_snapshot.clone_complete", {
				provider: this.type,
				repoId: input.repoId,
				durationMs: Date.now() - setupStartMs,
			});

			let commitSha: string | null = null;
			try {
				const proc = await sandbox.exec(["sh", "-c", `cd '${repoDir}' && git rev-parse HEAD`]);
				const stdout = await proc.stdout.readText();
				commitSha = stdout.trim() || null;
			} catch {
				// Non-fatal - snapshot is still usable as a baseline.
			}

			const snapshotStartMs = Date.now();
			const snapshotImage = await sandbox.snapshotFilesystem();
			logLatency("provider.repo_snapshot.filesystem", {
				provider: this.type,
				repoId: input.repoId,
				durationMs: Date.now() - snapshotStartMs,
			});

			logLatency("provider.repo_snapshot.complete", {
				provider: this.type,
				repoId: input.repoId,
				durationMs: Date.now() - startMs,
			});

			return { snapshotId: snapshotImage.imageId, commitSha };
		} finally {
			await sandbox.terminate().catch(() => {});
		}
	}

	async createSandbox(opts: CreateSandboxOpts): Promise<CreateSandboxResult> {
		const startTime = Date.now();
		const log = providerLogger.child({ sessionId: opts.sessionId });

		logLatency("provider.create_sandbox.start", {
			provider: this.type,
			sessionId: opts.sessionId,
			repoCount: opts.repos.length,
			hasSnapshotId: Boolean(opts.snapshotId),
			hasBaseSnapshotId: Boolean(opts.baseSnapshotId || MODAL_BASE_SNAPSHOT_ID),
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
				durationMs: Date.now() - authStartMs,
			});
			const app = await this.ensureAppInitialized();

			const restoreSnapshotId = opts.snapshotId;
			const baseSnapshotId = opts.baseSnapshotId || MODAL_BASE_SNAPSHOT_ID;
			const isRestoreSnapshot = Boolean(restoreSnapshotId);
			log.info(
				{
					restoreSnapshotId: restoreSnapshotId || null,
					baseSnapshotId: baseSnapshotId || null,
					isRestoreSnapshot,
				},
				"Selecting sandbox image",
			);

			// Use restore snapshot if provided, otherwise use base snapshot (if configured), otherwise base image
			let sandboxImage: Image;
			let imageSource: "restore_snapshot" | "base_snapshot" | "base_image";
			if (restoreSnapshotId) {
				log.debug({ snapshotId: restoreSnapshotId }, "Restoring from snapshot");
				const imageStartMs = Date.now();
				sandboxImage = await this.client.images.fromId(restoreSnapshotId);
				logLatency("provider.create_sandbox.snapshot_image_loaded", {
					provider: this.type,
					sessionId: opts.sessionId,
					durationMs: Date.now() - imageStartMs,
				});
				imageSource = "restore_snapshot";
			} else if (baseSnapshotId) {
				const imageStartMs = Date.now();
				sandboxImage = await this.client.images.fromId(baseSnapshotId);
				logLatency("provider.create_sandbox.base_snapshot_image_loaded", {
					provider: this.type,
					sessionId: opts.sessionId,
					durationMs: Date.now() - imageStartMs,
				});
				imageSource = "base_snapshot";
			} else {
				sandboxImage = await this.ensureBaseImageInitialized();
				imageSource = "base_image";
			}
			log.info(
				{
					imageSource,
					restoreSnapshotId: restoreSnapshotId || null,
					baseSnapshotId: baseSnapshotId || null,
				},
				"Sandbox image selected",
			);
			logLatency("provider.create_sandbox.image_selected", {
				provider: this.type,
				sessionId: opts.sessionId,
				imageSource,
			});

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
				command: ["sh", "-c", "rm -f /var/run/docker.pid && exec /usr/local/bin/start-dockerd.sh"],
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
				durationMs: Date.now() - createStartMs,
			});

			log.debug({ sandboxId: sandbox.sandboxId }, "Sandbox created");

			// Get tunnel URLs
			const tunnelsStartMs = Date.now();
			const tunnels = await sandbox.tunnels(30000);
			logLatency("provider.create_sandbox.tunnels", {
				provider: this.type,
				sessionId: opts.sessionId,
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
			const repoDir = await this.setupSandbox(sandbox, opts, isRestoreSnapshot, log);
			logLatency("provider.create_sandbox.setup_workspace", {
				provider: this.type,
				sessionId: opts.sessionId,
				isSnapshot: isRestoreSnapshot,
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
				durationMs: Date.now() - essentialStartMs,
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

			// Wait for OpenCode to be ready
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
					logLatency("provider.create_sandbox.opencode_ready.warn", {
						provider: this.type,
						sessionId: opts.sessionId,
						timeoutMs: 30000,
						error: error instanceof Error ? error.message : String(error),
					});
					log.warn({ err: error }, "OpenCode readiness check failed");
				}
			}

			logLatency("provider.create_sandbox.complete", {
				provider: this.type,
				sessionId: opts.sessionId,
				durationMs: Date.now() - startTime,
				isSnapshot: isRestoreSnapshot,
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
				durationMs: Date.now() - startTime,
				error: error instanceof Error ? error.message : String(error),
			});
			throw SandboxProviderError.fromError(error, "modal", "createSandbox");
		}
	}

	async ensureSandbox(opts: CreateSandboxOpts): Promise<EnsureSandboxResult> {
		const startTime = Date.now();
		const log = providerLogger.child({ sessionId: opts.sessionId });

		log.debug("Ensuring sandbox");
		logLatency("provider.ensure_sandbox.start", {
			provider: this.type,
			sessionId: opts.sessionId,
			hasSnapshotId: Boolean(opts.snapshotId),
		});

		// For Modal, sessionId IS the sandbox identifier (we use it as the unique name)
		// This is equivalent to E2B using currentSandboxId - both are "find by ID"
		const findStartMs = Date.now();
		const existingSandboxId = await this.findSandbox(opts.sessionId);
		logLatency("provider.ensure_sandbox.find_existing", {
			provider: this.type,
			sessionId: opts.sessionId,
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
				durationMs: Date.now() - resolveStartMs,
				hasTunnelUrl: Boolean(tunnels.openCodeUrl),
				hasPreviewUrl: Boolean(tunnels.previewUrl),
			});
			logLatency("provider.ensure_sandbox.complete", {
				provider: this.type,
				sessionId: opts.sessionId,
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
	 * - For restore snapshots: Read metadata to get existing repoDir (repos already in snapshot)
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
			log.info("Restoring from snapshot - reading metadata (skipping clone)");
			try {
				const metadataFile = await sandbox.open(SANDBOX_PATHS.metadataFile, "r");
				const metadataBytes = await metadataFile.read();
				await metadataFile.close();
				const metadata: SessionMetadata = JSON.parse(decoder.decode(metadataBytes));
				log.info({ repoDir: metadata.repoDir }, "Found repoDir from snapshot metadata");
				return metadata.repoDir;
			} catch (metadataErr) {
				log.warn(
					{ err: metadataErr },
					"Snapshot metadata not found, falling back to workspace dir (repos may be missing)",
				);
				return workspaceDir;
			}
		}

		// Fresh sandbox: clone repositories
		log.info({ repoCount: opts.repos.length }, "Setting up workspace");
		const mkdirProc = await sandbox.exec(["mkdir", "-p", workspaceDir]);
		await mkdirProc.wait();

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

			log.info(
				{
					repo: repo.workspacePath,
					repoUrl: repo.repoUrl,
					hasToken: Boolean(repo.token),
					index: i + 1,
					total: opts.repos.length,
					targetDir,
				},
				"Cloning repo",
			);
			const cloneProc = await sandbox.exec([
				"git",
				"clone",
				"--depth",
				"1",
				"--branch",
				opts.branch,
				cloneUrl,
				targetDir,
			]);
			const cloneExit = await cloneProc.wait();
			if (cloneExit !== 0) {
				const stderr = await cloneProc.stderr.readText();
				log.warn(
					{ repo: repo.workspacePath, exitCode: cloneExit, stderr },
					"Branch clone failed, trying default",
				);
				const fallbackProc = await sandbox.exec([
					"git",
					"clone",
					"--depth",
					"1",
					cloneUrl,
					targetDir,
				]);
				const fallbackExit = await fallbackProc.wait();
				if (fallbackExit !== 0) {
					const fallbackStderr = await fallbackProc.stderr.readText();
					log.error(
						{ repo: repo.workspacePath, exitCode: fallbackExit, stderr: fallbackStderr },
						"Repo clone failed completely",
					);
					throw new Error(`git clone failed for ${repo.repoUrl}: ${fallbackStderr}`);
				}
				log.info({ repo: repo.workspacePath }, "Repo cloned successfully (default branch)");
			} else {
				log.info({ repo: repo.workspacePath }, "Repo cloned successfully");
			}
		}

		// Set repoDir (first repo for single, workspace root for multi)
		const repoDir = opts.repos.length > 1 ? workspaceDir : firstRepoDir || workspaceDir;
		log.info({ repoDir, repoCount: opts.repos.length }, "All repositories cloned");

		// Save session metadata (use base64 + sh -c to make mkdir + write atomic)
		const metadata: SessionMetadata = {
			sessionId: opts.sessionId,
			repoDir,
			createdAt: Date.now(),
		};
		const metadataDir = SANDBOX_PATHS.metadataFile.replace(/\/[^/]+$/, "");
		const metadataContent = JSON.stringify(metadata, null, 2);
		const metadataBase64 = Buffer.from(metadataContent).toString("base64");
		const metaProc = await sandbox.exec([
			"sh",
			"-c",
			`mkdir -p ${metadataDir} && echo '${metadataBase64}' | base64 -d > ${SANDBOX_PATHS.metadataFile}`,
		]);
		await metaProc.wait();
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
		const isSetupSession = opts.sessionType === "setup";
		const writePromises = [
			// Plugin
			writeFile(`${SANDBOX_PATHS.globalPluginDir}/proliferate.mjs`, PLUGIN_MJS),
			// Core tools (available in all session modes)
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
			// Actions bootstrap hint
			writeFile(`${repoDir}/.proliferate/actions-guide.md`, ACTIONS_BOOTSTRAP),
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

		if (isSetupSession) {
			// Setup-only tools persist configuration settings.
			writePromises.push(
				writeFile(`${localToolDir}/save_service_commands.ts`, SAVE_SERVICE_COMMANDS_TOOL),
				writeFile(`${localToolDir}/save_service_commands.txt`, SAVE_SERVICE_COMMANDS_DESCRIPTION),
				writeFile(`${localToolDir}/save_env_files.ts`, SAVE_ENV_FILES_TOOL),
				writeFile(`${localToolDir}/save_env_files.txt`, SAVE_ENV_FILES_DESCRIPTION),
			);
		} else {
			// Ensure setup-only tools are removed when restoring from setup snapshots.
			writePromises.push(
				(async () => {
					await sandbox.exec([
						"sh",
						"-c",
						`rm -f '${localToolDir}/save_service_commands.ts' '${localToolDir}/save_service_commands.txt' '${localToolDir}/save_env_files.ts' '${localToolDir}/save_env_files.txt'`,
					]);
				})(),
			);
		}

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
		sandbox
			.exec(
				[
					"sh",
					"-c",
					`cd ${repoDir} && opencode serve --print-logs --log-level ERROR --port 4096 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1`,
				],
				{
					env: opencodeEnv,
				},
			)
			.catch(() => {
				// Expected - runs until sandbox terminates
			});
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
		// Configure git identity (required for commits inside the sandbox)
		const userName = opts.userName?.trim();
		const userEmail = opts.userEmail?.trim();
		if (userName || userEmail) {
			try {
				if (userName) {
					await sandbox.exec(["git", "config", "--global", "user.name", userName]);
				}
				if (userEmail) {
					await sandbox.exec(["git", "config", "--global", "user.email", userEmail]);
				}
			} catch (err) {
				log.warn({ err }, "Failed to configure git identity (non-fatal)");
			}
		}

		// Git freshness pull on restored snapshots (opt-in, non-fatal, cadence-gated)
		{
			// Read metadata for cadence check
			let metadata: SessionMetadata | null = null;
			try {
				const metadataFile = await sandbox.open(SANDBOX_PATHS.metadataFile, "r");
				const metadataBytes = await metadataFile.read();
				await metadataFile.close();
				metadata = JSON.parse(decoder.decode(metadataBytes)) as SessionMetadata;
			} catch {
				// No metadata → legacy snapshot or fresh sandbox
			}

			const doPull = shouldPullOnRestore({
				enabled: env.SANDBOX_GIT_PULL_ON_RESTORE,
				hasSnapshot: Boolean(opts.snapshotId),
				repoCount: opts.repos.length,
				cadenceSeconds: env.SANDBOX_GIT_PULL_CADENCE_SECONDS,
				lastGitFetchAt: metadata?.lastGitFetchAt,
			});

			if (doPull) {
				const workspaceDir = `${SANDBOX_PATHS.home}/workspace`;

				// Re-write git credentials with fresh tokens (snapshot tokens may be stale)
				const gitCredentials: Record<string, string> = {};
				for (const repo of opts.repos) {
					if (repo.token) {
						gitCredentials[repo.repoUrl] = repo.token;
						gitCredentials[repo.repoUrl.replace(/\.git$/, "")] = repo.token;
					}
				}
				if (Object.keys(gitCredentials).length > 0) {
					const credsFile = await sandbox.open("/tmp/.git-credentials.json", "w");
					await credsFile.write(encoder.encode(JSON.stringify(gitCredentials)));
					await credsFile.close();
				}

				// Pull each repo (ff-only, non-fatal)
				let allPullsSucceeded = true;
				for (const repo of opts.repos) {
					const targetDir =
						repo.workspacePath === "." ? workspaceDir : `${workspaceDir}/${repo.workspacePath}`;
					const pullStartMs = Date.now();
					try {
						const result = await sandbox.exec([
							"sh",
							"-c",
							`cd ${shellEscape(targetDir)} && git pull --ff-only 2>&1`,
						]);
						const stdout = capOutput(await result.stdout.readText());
						log.info(
							{
								repo: repo.workspacePath,
								durationMs: Date.now() - pullStartMs,
								output: stdout,
							},
							"Git freshness pull complete",
						);
					} catch (err) {
						allPullsSucceeded = false;
						log.warn(
							{
								err,
								repo: repo.workspacePath,
								durationMs: Date.now() - pullStartMs,
							},
							"Git freshness pull failed (non-fatal)",
						);
					}
				}

				// Only advance cadence when every pull succeeded so transient
				// failures don't suppress retries for an entire cadence window.
				if (allPullsSucceeded && metadata) {
					try {
						const updated: SessionMetadata = {
							...metadata,
							lastGitFetchAt: Date.now(),
						};
						const updatedContent = JSON.stringify(updated, null, 2);
						const updatedBase64 = Buffer.from(updatedContent).toString("base64");
						const metadataDir = SANDBOX_PATHS.metadataFile.replace(/\/[^/]+$/, "");
						await sandbox.exec([
							"sh",
							"-c",
							`mkdir -p ${metadataDir} && echo '${updatedBase64}' | base64 -d > ${SANDBOX_PATHS.metadataFile}`,
						]);
					} catch {
						// Non-fatal — cadence will just re-pull next time
					}
				}
			}
		}

		// Start services
		log.debug("Starting services (async)");
		await sandbox.exec(["/usr/local/bin/start-services.sh"]);

		// Create caddy import directory (must exist before Caddy starts)
		await sandbox.exec([
			"sh",
			"-c",
			`mkdir -p ${SANDBOX_PATHS.userCaddyDir} && touch ${SANDBOX_PATHS.userCaddyFile}`,
		]);

		// Write and start Caddy
		log.debug("Starting Caddy preview proxy (async)");
		const caddyFile = await sandbox.open(SANDBOX_PATHS.caddyfile, "w");
		await caddyFile.write(encoder.encode(DEFAULT_CADDYFILE));
		await caddyFile.close();

		// Start Caddy in background (don't wait)
		sandbox.exec(["caddy", "run", "--config", SANDBOX_PATHS.caddyfile]).catch(() => {
			// Expected - runs until sandbox terminates
		});

		// Start sandbox-mcp API server in background
		log.info("Starting sandbox-mcp API server");
		const mcpEnvs: Record<string, string> = {
			WORKSPACE_DIR: "/home/user/workspace",
			NODE_ENV: "production",
		};
		if (opts.envVars.SANDBOX_MCP_AUTH_TOKEN) {
			mcpEnvs.SANDBOX_MCP_AUTH_TOKEN = opts.envVars.SANDBOX_MCP_AUTH_TOKEN;
			log.debug("SANDBOX_MCP_AUTH_TOKEN injected");
		} else {
			log.warn("No SANDBOX_MCP_AUTH_TOKEN in envVars — sandbox-mcp will deny all requests");
		}

		sandbox
			.exec(["sh", "-c", "/usr/bin/sandbox-mcp api > /tmp/sandbox-mcp.log 2>&1"], { env: mcpEnvs })
			.then(() => {
				log.warn("sandbox-mcp API exited unexpectedly");
			})
			.catch((err) => {
				log.error({ err }, "sandbox-mcp API failed to start");
			});

		// Apply env files + start services via proliferate CLI (tracked in service-manager)
		this.bootServices(sandbox, opts, log);
	}

	/**
	 * Boot services via the proliferate CLI.
	 * 1. Apply env files (blocking — services may depend on these)
	 * 2. Start each service command via `proliferate services start` (fire-and-forget)
	 *
	 * Services started this way are tracked by service-manager and visible in the
	 * Services panel + logs SSE, unlike the old /tmp/svc-*.log approach.
	 */
	private async bootServices(
		sandbox: Sandbox,
		opts: CreateSandboxOpts,
		log: Logger,
	): Promise<void> {
		const workspaceDir = `${SANDBOX_PATHS.home}/workspace`;

		// Start services via tracked CLI (fire-and-forget per service)
		if (!opts.autoStartServices || !opts.serviceCommands?.length) return;

		for (const cmd of opts.serviceCommands) {
			const baseDir =
				cmd.workspacePath && cmd.workspacePath !== "."
					? `${workspaceDir}/${cmd.workspacePath}`
					: workspaceDir;
			const cwd = cmd.cwd ? `${baseDir}/${cmd.cwd}` : baseDir;

			log.info({ name: cmd.name, cwd }, "Starting service (tracked)");

			sandbox
				.exec([
					"proliferate",
					"services",
					"start",
					"--name",
					cmd.name,
					"--command",
					cmd.command,
					"--cwd",
					cwd,
				])
				.catch((err) => {
					log.error({ err, name: cmd.name }, "proliferate services start failed");
				});
		}
	}

	async testServiceCommands(
		sandboxId: string,
		commands: ServiceCommand[],
		opts: { timeoutMs: number; runId: string },
	): Promise<AutoStartOutputEntry[]> {
		const log = providerLogger.child({ sandboxId: sandboxId.slice(0, 16), runId: opts.runId });
		log.info({ commandCount: commands.length }, "Testing service commands");

		await this.ensureModalAuth("testServiceCommands");
		const sandbox = await this.client.sandboxes.fromId(sandboxId);
		const workspaceDir = `${SANDBOX_PATHS.home}/workspace`;
		const entries: AutoStartOutputEntry[] = [];

		for (let i = 0; i < commands.length; i++) {
			const cmd = commands[i];
			const baseDir =
				cmd.workspacePath && cmd.workspacePath !== "."
					? `${workspaceDir}/${cmd.workspacePath}`
					: workspaceDir;
			const cwd = cmd.cwd ? `${baseDir}/${cmd.cwd}` : baseDir;
			const slug = cmd.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
			const logFile = `/tmp/auto-start-test-${opts.runId}-${i}-${slug}.log`;

			log.info({ name: cmd.name, cwd, logFile }, "Running test command");

			try {
				const proc = await sandbox.exec([
					"sh",
					"-c",
					`cd ${shellEscape(cwd)} && timeout ${Math.ceil(opts.timeoutMs / 1000)} sh -c ${shellEscape(cmd.command)} > ${shellEscape(logFile)} 2>&1; EXIT_CODE=$?; cat ${shellEscape(logFile)}; exit $EXIT_CODE`,
				]);
				const exitCode = await proc.wait();
				const stdout = await proc.stdout.readText();
				entries.push({
					name: cmd.name,
					workspacePath: cmd.workspacePath,
					cwd,
					output: capOutput(stdout),
					exitCode,
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

	async execCommand(
		sandboxId: string,
		argv: string[],
		opts?: {
			cwd?: string;
			timeoutMs?: number;
			env?: Record<string, string>;
		},
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		await this.ensureModalAuth("execCommand");
		const sandbox = await this.client.sandboxes.fromId(sandboxId);

		// Wrap with timeout to prevent hung processes (default 30s)
		const timeoutSec = Math.ceil((opts?.timeoutMs ?? 30_000) / 1000);
		let finalArgv = ["timeout", String(timeoutSec), ...argv];

		// Prefix with env vars if provided (Modal's exec API doesn't support envVars directly)
		if (opts?.env && Object.keys(opts.env).length > 0) {
			const envArgs = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`);
			finalArgv = ["env", ...envArgs, ...finalArgv];
		}

		if (opts?.cwd) {
			// Use positional args — shell script is constant, no user input interpolated
			finalArgv = ["sh", "-c", 'cd "$1" && shift && exec "$@"', "--", opts.cwd, ...finalArgv];
		}

		const proc = await sandbox.exec(finalArgv);
		const exitCode = await proc.wait();
		const stdout = await proc.stdout.readText();
		const stderr = await proc.stderr.readText();
		// timeout command returns exit code 124 on timeout
		return { stdout: capOutput(stdout), stderr: capOutput(stderr), exitCode };
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
				durationMs: Date.now() - fromIdStartMs,
			});
			const snapshotStartMs = Date.now();
			const snapshotImage = await sandbox.snapshotFilesystem();
			logLatency("provider.snapshot.filesystem", {
				provider: this.type,
				sessionId,
				durationMs: Date.now() - snapshotStartMs,
			});

			providerLogger.info({ snapshotId: snapshotImage.imageId }, "Snapshot created");
			logLatency("provider.snapshot.complete", {
				provider: this.type,
				sessionId,
				durationMs: Date.now() - startMs,
			});
			return { snapshotId: snapshotImage.imageId };
		} catch (error) {
			logLatency("provider.snapshot.error", {
				provider: this.type,
				sessionId,
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
				durationMs: Date.now() - fromIdStartMs,
			});
			const terminateStartMs = Date.now();
			await sandbox.terminate();
			logLatency("provider.terminate.call", {
				provider: this.type,
				sessionId,
				durationMs: Date.now() - terminateStartMs,
			});
			providerLogger.info({ sandboxId }, "Sandbox terminated");
			logLatency("provider.terminate.complete", {
				provider: this.type,
				sessionId,
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
					durationMs: Date.now() - startMs,
				});
				return;
			}
			logLatency("provider.terminate.error", {
				provider: this.type,
				sessionId,
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
