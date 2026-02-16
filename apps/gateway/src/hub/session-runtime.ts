/**
 * Session Runtime
 *
 * Owns sandbox lifecycle, OpenCode session lifecycle, and SSE connection.
 * Provides a single ensureRuntimeReady() entry point for hot path callers.
 */

import { type Logger, createLogger } from "@proliferate/logger";
import { baseSnapshots, sessions } from "@proliferate/services";
import type {
	AutoStartOutputEntry,
	PrebuildServiceCommand,
	SandboxProvider,
	SandboxProviderType,
	ServerMessage,
} from "@proliferate/shared";
import { getModalAppName, getSandboxProvider } from "@proliferate/shared/providers";
import { computeBaseSnapshotVersionKey } from "@proliferate/shared/sandbox";
import { scheduleSessionExpiry } from "../expiry/expiry-queue";
import type { GatewayEnv } from "../lib/env";
import { waitForMigrationLockRelease } from "../lib/lock";
import { createOpenCodeSession, listOpenCodeSessions } from "../lib/opencode";
import { deriveSandboxMcpToken } from "../lib/sandbox-mcp-token";
import { type SessionContext, loadSessionContext } from "../lib/session-store";
import type { OpenCodeEvent, SandboxInfo } from "../types";
import { SseClient } from "./sse-client";

export class MigrationInProgressError extends Error {
	constructor(message = "Migration in progress") {
		super(message);
		this.name = "MigrationInProgressError";
	}
}

export interface EnsureRuntimeOptions {
	skipMigrationLock?: boolean;
	reason?: "auto_reconnect";
}

export interface SessionRuntimeOptions {
	env: GatewayEnv;
	sessionId: string;
	context: SessionContext;
	onEvent: (event: OpenCodeEvent) => void;
	onDisconnect: (reason: string) => void;
	onStatus: (
		status: "creating" | "resuming" | "running" | "paused" | "stopped" | "error" | "migrating",
		message?: string,
	) => void;
	onBroadcast?: (message: ServerMessage) => void;
}

export class SessionRuntime {
	private readonly env: GatewayEnv;
	private readonly sessionId: string;
	private context: SessionContext;
	private readonly logger: Logger;

	private readonly sseClient: SseClient;
	private readonly onStatus: SessionRuntimeOptions["onStatus"];
	private readonly onBroadcast?: SessionRuntimeOptions["onBroadcast"];
	private readonly onDisconnect: SessionRuntimeOptions["onDisconnect"];

	private provider: SandboxProvider | null = null;
	private openCodeUrl: string | null = null;
	private previewUrl: string | null = null;
	private sshHost: string | null = null;
	private sshPort: number | null = null;
	private openCodeSessionId: string | null = null;
	private openCodeSessionUrl: string | null = null;
	private sandboxExpiresAt: number | null = null;
	private lifecycleStartTime = 0;

	private ensureReadyPromise: Promise<void> | null = null;

	constructor(options: SessionRuntimeOptions) {
		this.env = options.env;
		this.sessionId = options.sessionId;
		this.context = options.context;
		this.logger = createLogger({ service: "gateway" }).child({
			module: "runtime",
			sessionId: options.sessionId,
		});
		this.onStatus = options.onStatus;
		this.onBroadcast = options.onBroadcast;
		this.onDisconnect = options.onDisconnect;

		this.sseClient = new SseClient({
			onEvent: options.onEvent,
			onDisconnect: (reason) => this.handleSseDisconnect(reason),
			env: this.env,
			logger: this.logger,
		});
	}

	private logLatency(event: string, data?: Record<string, unknown>): void {
		const elapsedMs = this.lifecycleStartTime ? Date.now() - this.lifecycleStartTime : undefined;
		this.logger.debug({ elapsedMs, ...data }, event);
	}

	// ============================================
	// Logging
	// ============================================

	private log(message: string, data?: Record<string, unknown>): void {
		const elapsedMs = this.lifecycleStartTime ? Date.now() - this.lifecycleStartTime : undefined;
		this.logger.info({ ...data, elapsedMs }, message);
	}

	private logError(message: string, error?: unknown): void {
		const elapsedMs = this.lifecycleStartTime ? Date.now() - this.lifecycleStartTime : undefined;
		this.logger.error({ err: error, elapsedMs }, message);
	}

	// ============================================
	// Accessors
	// ============================================

	getContext(): SessionContext {
		return this.context;
	}

	getOpenCodeUrl(): string | null {
		return this.openCodeUrl;
	}

	getOpenCodeSessionId(): string | null {
		return this.openCodeSessionId;
	}

	getPreviewUrl(): string | null {
		return this.previewUrl;
	}

	getSandboxExpiresAt(): number | null {
		return this.sandboxExpiresAt;
	}

	isReady(): boolean {
		return Boolean(this.openCodeUrl && this.openCodeSessionId && this.sseClient.isConnected());
	}

	isConnecting(): boolean {
		return this.ensureReadyPromise !== null;
	}

	hasOpenCodeUrl(): boolean {
		return Boolean(this.openCodeUrl);
	}

	isSseConnected(): boolean {
		return this.sseClient.isConnected();
	}

	// ============================================
	// Provider access (for git operations, etc.)
	// ============================================

	getProviderAndSandboxId(): { provider: SandboxProvider; sandboxId: string } | null {
		const sandboxId = this.context.session.sandbox_id;
		if (!this.provider || !sandboxId) return null;
		return { provider: this.provider, sandboxId };
	}

	// ============================================
	// Auto-start testing
	// ============================================

	/**
	 * Run service commands in the sandbox and capture output.
	 * Uses inline commands if provided, otherwise falls back to session context.
	 */
	async testAutoStartCommands(
		runId: string,
		overrideCommands?: PrebuildServiceCommand[],
	): Promise<AutoStartOutputEntry[]> {
		const sandboxId = this.context.session.sandbox_id;
		const commands = overrideCommands?.length ? overrideCommands : this.context.serviceCommands;

		if (!this.provider?.testServiceCommands || !sandboxId) {
			throw new Error("Runtime not ready");
		}
		if (!commands?.length) {
			return [];
		}

		return this.provider.testServiceCommands(sandboxId, commands, {
			timeoutMs: 10_000,
			runId,
		});
	}

	// ============================================
	// Core lifecycle
	// ============================================

	/**
	 * Ensure sandbox, OpenCode session, and SSE are ready.
	 * Single entry point for the hot path.
	 */
	async ensureRuntimeReady(options?: EnsureRuntimeOptions): Promise<void> {
		if (this.ensureReadyPromise) {
			return this.ensureReadyPromise;
		}

		if (this.isReady()) {
			return;
		}

		this.lifecycleStartTime = Date.now();
		this.log("Starting runtime lifecycle");
		this.logLatency("runtime.ensure_ready.start", {
			skipMigrationLock: Boolean(options?.skipMigrationLock),
			hasSandboxId: Boolean(this.context.session.sandbox_id),
			hasSnapshotId: Boolean(this.context.session.snapshot_id),
			hasOpenCodeUrl: Boolean(this.openCodeUrl),
			hasOpenCodeSessionId: Boolean(this.openCodeSessionId),
		});

		this.ensureReadyPromise = this.doEnsureRuntimeReady(options);
		try {
			await this.ensureReadyPromise;
		} finally {
			this.ensureReadyPromise = null;
		}
	}

	getSandboxInfo(): SandboxInfo {
		return {
			sessionId: this.sessionId,
			sandboxId: this.context.session.sandbox_id || null,
			status: this.context.session.status || "unknown",
			previewUrl: this.previewUrl,
			sshHost: this.sshHost,
			sshPort: this.sshPort,
			expiresAt: this.sandboxExpiresAt,
		};
	}

	disconnectSse(): void {
		this.sseClient.disconnect();
	}

	resetSandboxState(): void {
		this.openCodeUrl = null;
		this.previewUrl = null;
		this.sshHost = null;
		this.sshPort = null;
		this.sandboxExpiresAt = null;
		this.openCodeSessionId = null;
		this.openCodeSessionUrl = null;
		this.context.session.sandbox_id = null;
	}

	// ============================================
	// Private lifecycle
	// ============================================

	private async doEnsureRuntimeReady(options?: EnsureRuntimeOptions): Promise<void> {
		try {
			if (!options?.skipMigrationLock) {
				const lockStartMs = Date.now();
				await waitForMigrationLockRelease(this.sessionId);
				this.logLatency("runtime.ensure_ready.migration_lock_wait", {
					durationMs: Date.now() - lockStartMs,
				});
			}

			// Reload context fresh from database
			const contextStartMs = Date.now();
			this.log("Loading session context...");
			this.context = await loadSessionContext(this.env, this.sessionId);
			this.logLatency("runtime.ensure_ready.load_context", {
				durationMs: Date.now() - contextStartMs,
				prebuildId: this.context.session.prebuild_id,
				repoCount: this.context.repos.length,
				hasSandbox: Boolean(this.context.session.sandbox_id),
				hasSnapshot: Boolean(this.context.session.snapshot_id),
			});
			this.log("Session context loaded", {
				prebuildId: this.context.session.prebuild_id,
				repoCount: this.context.repos.length,
				primaryRepo: this.context.primaryRepo.github_repo_name,
				hasSandbox: Boolean(this.context.session.sandbox_id),
				hasSnapshot: Boolean(this.context.session.snapshot_id),
			});

			// Abort auto-reconnect if session was paused (idle snapshot completed while we waited)
			if (options?.reason === "auto_reconnect" && this.context.session.status === "paused") {
				this.log("Auto-reconnect aborted: session is paused");
				return;
			}

			const hasSandbox = Boolean(this.context.session.sandbox_id);
			this.onStatus(hasSandbox ? "resuming" : "creating");

			const providerType = this.context.session.sandbox_provider as SandboxProviderType | undefined;
			const provider = getSandboxProvider(providerType);
			this.provider = provider;
			this.log("Using sandbox provider", { provider: provider.type });

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
						this.logger.info(
							{ baseSnapshotId, versionKey: versionKey.slice(0, 12) },
							"Base snapshot resolved from DB",
						);
					} else {
						this.logger.debug(
							{ versionKey: versionKey.slice(0, 12) },
							"No ready base snapshot in DB, using env fallback",
						);
					}
				} catch (err) {
					this.logger.warn({ err }, "Failed to resolve base snapshot from DB (non-fatal)");
				}
			}

			// Derive per-session sandbox-mcp auth token and merge into env vars
			const sandboxMcpToken = deriveSandboxMcpToken(this.env.serviceToken, this.sessionId);
			const envVarsWithToken = {
				...this.context.envVars,
				SANDBOX_MCP_AUTH_TOKEN: sandboxMcpToken,
				PROLIFERATE_GATEWAY_URL: this.env.gatewayUrl,
				PROLIFERATE_SESSION_ID: this.sessionId,
			};

			const ensureSandboxStartMs = Date.now();
			const result = await provider.ensureSandbox({
				sessionId: this.sessionId,
				sessionType: this.context.session.session_type as "coding" | "setup" | "cli" | null,
				repos: this.context.repos,
				branch: this.context.primaryRepo.default_branch || "main",
				envVars: envVarsWithToken,
				systemPrompt: this.context.systemPrompt,
				snapshotId: this.context.session.snapshot_id || undefined,
				baseSnapshotId,
				agentConfig: this.context.agentConfig,
				currentSandboxId: this.context.session.sandbox_id || undefined,
				sshPublicKey: this.context.sshPublicKey,
				snapshotHasDeps: this.context.snapshotHasDeps,
				serviceCommands: this.context.serviceCommands,
			});
			this.logLatency("runtime.ensure_ready.provider.ensure_sandbox", {
				provider: provider.type,
				durationMs: Date.now() - ensureSandboxStartMs,
				recovered: result.recovered,
				sandboxId: result.sandboxId,
				hasTunnelUrl: Boolean(result.tunnelUrl),
				hasPreviewUrl: Boolean(result.previewUrl),
				hasExpiresAt: Boolean(result.expiresAt),
			});

			this.openCodeUrl = result.tunnelUrl;
			this.previewUrl = result.previewUrl;
			const storedExpiry = this.context.session.sandbox_expires_at
				? Date.parse(this.context.session.sandbox_expires_at)
				: null;
			this.sandboxExpiresAt = result.expiresAt || storedExpiry || null;
			this.sshHost = result.sshHost || null;
			this.sshPort = result.sshPort || null;

			this.log(result.recovered ? "Sandbox recovered" : "Sandbox created", {
				sandboxId: result.sandboxId,
				tunnelUrl: this.openCodeUrl,
				previewUrl: this.previewUrl,
				sshHost: this.sshHost,
				sshPort: this.sshPort,
				expiresAt: this.sandboxExpiresAt ? new Date(this.sandboxExpiresAt).toISOString() : null,
				recovered: result.recovered,
			});

			// Git Freshness Post-Thaw: pull latest changes after restoring from snapshot.
			// The repo may be stale if time has passed since the snapshot was taken.
			if (this.context.session.snapshot_id && provider.execCommand) {
				try {
					const gitStartMs = Date.now();
					const gitResult = await provider.execCommand(
						result.sandboxId,
						["bash", "-c", "cd /home/user/workspace && git pull --ff-only 2>&1 || true"],
						{ timeoutMs: 30_000 },
					);
					this.logLatency("runtime.ensure_ready.git_freshness", {
						durationMs: Date.now() - gitStartMs,
						exitCode: gitResult.exitCode,
					});
				} catch (err) {
					this.logger.warn({ err }, "Git freshness pull failed (non-fatal)");
				}
			}

			// Update session with sandbox info
			const updateStartMs = Date.now();
			await sessions.update(this.sessionId, {
				sandboxId: result.sandboxId,
				status: "running",
				openCodeTunnelUrl: result.tunnelUrl,
				previewTunnelUrl: result.previewUrl,
				...(result.expiresAt && { sandboxExpiresAt: result.expiresAt }),
				...(provider.supportsAutoPause &&
					!this.context.session.snapshot_id && { snapshotId: result.sandboxId }),
			});
			this.logLatency("runtime.ensure_ready.db.update_session", {
				durationMs: Date.now() - updateStartMs,
			});

			// Update in-memory context
			this.context.session.sandbox_id = result.sandboxId;
			if (result.expiresAt) {
				this.context.session.sandbox_expires_at = new Date(result.expiresAt).toISOString();
			}
			if (provider.supportsAutoPause && !this.context.session.snapshot_id) {
				this.context.session.snapshot_id = result.sandboxId;
			}

			// Fallback to stored URLs if provider didn't return them
			this.openCodeUrl = this.openCodeUrl || this.context.session.open_code_tunnel_url || null;
			this.previewUrl = this.previewUrl || this.context.session.preview_tunnel_url || null;

			// Schedule expiry snapshot/migration
			const expiryScheduleStartMs = Date.now();
			scheduleSessionExpiry(this.env, this.sessionId, this.sandboxExpiresAt).catch((err) => {
				this.logError("Failed to schedule expiry job", err);
			});
			this.logLatency("runtime.ensure_ready.expiry.schedule", {
				durationMs: Date.now() - expiryScheduleStartMs,
				expiresAt: this.sandboxExpiresAt ? new Date(this.sandboxExpiresAt).toISOString() : null,
			});

			if (this.previewUrl && this.onBroadcast) {
				this.onBroadcast({ type: "preview_url", payload: { url: this.previewUrl } });
				await sessions.update(this.sessionId, { previewTunnelUrl: this.previewUrl });
			}

			if (!this.openCodeUrl) {
				throw new Error("Missing agent tunnel URL");
			}

			// Ensure OpenCode session exists
			const ensureOpenCodeStartMs = Date.now();
			await this.ensureOpenCodeSession();
			this.logLatency("runtime.ensure_ready.opencode_session.ensure", {
				durationMs: Date.now() - ensureOpenCodeStartMs,
				hasOpenCodeSessionId: Boolean(this.openCodeSessionId),
			});

			// Connect to SSE
			const sseStartMs = Date.now();
			this.log("Connecting to OpenCode SSE...", { url: this.openCodeUrl });
			await this.sseClient.connect(this.openCodeUrl);
			this.log("SSE connected");
			this.logLatency("runtime.ensure_ready.sse.connect", {
				durationMs: Date.now() - sseStartMs,
			});

			this.onStatus("running");
			this.log("Runtime lifecycle complete - status: running");
			this.logLatency("runtime.ensure_ready.complete");
		} catch (err) {
			this.onStatus("error", err instanceof Error ? err.message : "Unknown error");
			this.logLatency("runtime.ensure_ready.error", {
				error: err instanceof Error ? err.message : "Unknown error",
			});
			throw err;
		}
	}

	private async ensureOpenCodeSession(): Promise<void> {
		if (!this.openCodeUrl) {
			throw new Error("Agent URL missing");
		}

		if (this.openCodeSessionId && this.openCodeSessionUrl === this.openCodeUrl) {
			return;
		}

		// Check if we have a stored OpenCode session ID
		const storedId = this.context.session.coding_agent_session_id;

		if (storedId) {
			const listStartMs = Date.now();
			this.log("Verifying stored OpenCode session...", { storedId });
			const sessions = await listOpenCodeSessions(this.openCodeUrl);
			this.logLatency("runtime.opencode_session.list", {
				durationMs: Date.now() - listStartMs,
				count: sessions.length,
				hadStoredId: true,
			});
			const exists = sessions.some((s) => s.id === storedId);

			if (exists) {
				this.log("Stored OpenCode session is valid", { storedId });
				this.openCodeSessionId = storedId;
				this.openCodeSessionUrl = this.openCodeUrl;
				return;
			}
			this.log("Stored OpenCode session not found, creating new one");
		}

		// Create new OpenCode session
		const createStartMs = Date.now();
		this.log("Creating new OpenCode session...");
		const sessionId = await createOpenCodeSession(this.openCodeUrl);
		this.log("OpenCode session created", { sessionId });
		this.logLatency("runtime.opencode_session.create", {
			durationMs: Date.now() - createStartMs,
		});

		this.openCodeSessionId = sessionId;
		this.openCodeSessionUrl = this.openCodeUrl;
		this.context.session.coding_agent_session_id = sessionId;

		// Store the new ID
		await sessions.update(this.sessionId, { codingAgentSessionId: sessionId });
	}

	// ============================================
	// SSE handling
	// ============================================

	private handleSseDisconnect(reason: string): void {
		this.log("SSE disconnected", { reason });
		this.logLatency("runtime.sse.disconnect", { reason });
		this.openCodeUrl = null;
		this.openCodeSessionId = null;
		this.openCodeSessionUrl = null;
		this.onDisconnect(reason);
	}
}
