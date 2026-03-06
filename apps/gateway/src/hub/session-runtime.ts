/**
 * Session Runtime
 *
 * Owns sandbox lifecycle, OpenCode session lifecycle, and SSE connection.
 * Provides a single ensureRuntimeReady() entry point for hot path callers.
 */

import { type Logger, createLogger } from "@proliferate/logger";
import { billing } from "@proliferate/services";
import type {
	AutoStartOutputEntry,
	ConfigurationServiceCommand,
	Message,
	SandboxProvider,
	SandboxProviderType,
} from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import type {
	CodingHarnessEventStreamHandle,
	CodingHarnessPromptImage,
} from "../harness/contracts/coding";
import { ClaudeManagerHarnessAdapter } from "../harness/manager/adapter";
import type { GatewayEnv } from "../lib/env";
import { scheduleSessionExpiry } from "../operations/expiry/queue";
import { deriveSandboxMcpToken } from "../server/middleware/auth";
import type { SandboxInfo } from "../types";
import { waitForMigrationLockRelease } from "./session/migration/lock";
import {
	loadSessionRuntimeContext,
	splitSessionContext,
} from "./session/runtime/context/context-loader";
import {
	type SessionRuntimeContext,
	toLegacySessionContext,
} from "./session/runtime/context/context-types";
import type { RuntimeDriver } from "./session/runtime/contracts/runtime-driver";
import type { RuntimeFacade } from "./session/runtime/contracts/runtime-facade";
import { CodingRuntimeDriver } from "./session/runtime/drivers/coding-runtime-driver";
import { selectRuntimeDriver } from "./session/runtime/drivers/driver-selector";
import { ManagerRuntimeDriver } from "./session/runtime/drivers/manager-runtime-driver";
import type { SessionContext } from "./session/runtime/session-context-store";
import { clearRuntimePointers } from "./session/runtime/state/state-reconciler";
import { persistRuntimeReady } from "./session/runtime/write-authority/runtime-writers";
import type {
	BroadcastServerMessageCallback,
	DisconnectCallback,
	RuntimeDaemonEventCallback,
} from "./shared/callbacks";
import type { HubStatusCallback } from "./shared/status";

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
	onEvent: RuntimeDaemonEventCallback;
	onDisconnect: DisconnectCallback;
	onStatus: HubStatusCallback;
	onBroadcast?: BroadcastServerMessageCallback;
}

export class SessionRuntime implements RuntimeFacade {
	private readonly env: GatewayEnv;
	private readonly sessionId: string;
	private runtimeContext: SessionRuntimeContext;
	private readonly logger: Logger;

	private readonly managerHarness: ClaudeManagerHarnessAdapter;
	private readonly codingDriver: CodingRuntimeDriver;
	private readonly managerDriver: ManagerRuntimeDriver;
	private runtimeDriver: RuntimeDriver;
	private readonly onEvent: SessionRuntimeOptions["onEvent"];
	private readonly onStatus: SessionRuntimeOptions["onStatus"];
	private readonly onBroadcast?: SessionRuntimeOptions["onBroadcast"];
	private readonly onDisconnect: SessionRuntimeOptions["onDisconnect"];

	private provider: SandboxProvider | null = null;
	private eventStreamHandle: CodingHarnessEventStreamHandle | null = null;
	private lifecycleStartTime = 0;

	private ensureReadyPromise: Promise<void> | null = null;

	constructor(options: SessionRuntimeOptions) {
		this.env = options.env;
		this.sessionId = options.sessionId;
		this.runtimeContext = splitSessionContext(options.context);
		this.logger = createLogger({ service: "gateway" }).child({
			module: "runtime",
			sessionId: options.sessionId,
		});
		this.onEvent = options.onEvent;
		this.onStatus = options.onStatus;
		this.onBroadcast = options.onBroadcast;
		this.onDisconnect = options.onDisconnect;
		this.managerHarness = new ClaudeManagerHarnessAdapter(this.logger);
		this.codingDriver = new CodingRuntimeDriver();
		this.managerDriver = new ManagerRuntimeDriver(this.managerHarness);
		this.runtimeDriver = selectRuntimeDriver(this.runtimeContext.config, {
			coding: this.codingDriver,
			manager: this.managerDriver,
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
		return toLegacySessionContext(this.runtimeContext);
	}

	/**
	 * Refresh git-related context fields so git operations can use
	 * newly-resolved integration tokens and latest user identity.
	 */
	async refreshGitContext(): Promise<void> {
		const refreshed = await loadSessionRuntimeContext(this.env, this.sessionId);
		this.runtimeContext = {
			config: {
				...this.runtimeContext.config,
				primaryRepo: refreshed.config.primaryRepo,
				repos: refreshed.config.repos,
				gitIdentity: refreshed.config.gitIdentity,
			},
			live: this.runtimeContext.live,
		};
	}

	getOpenCodeUrl(): string | null {
		return this.runtimeContext.live.openCodeUrl;
	}

	getOpenCodeSessionId(): string | null {
		return this.runtimeContext.live.openCodeSessionId;
	}

	async sendPrompt(content: string, images?: CodingHarnessPromptImage[]): Promise<void> {
		await this.runtimeDriver.sendPrompt(content, images);
	}

	async interruptCurrentRun(): Promise<void> {
		await this.runtimeDriver.interrupt();
	}

	async collectOutputs(): Promise<Message[]> {
		return this.runtimeDriver.collectOutputs();
	}

	getPreviewUrl(): string | null {
		return this.runtimeContext.live.previewUrl;
	}

	getSandboxExpiresAt(): number | null {
		return this.runtimeContext.live.sandboxExpiresAt;
	}

	isReady(): boolean {
		return this.runtimeDriver.isReady({
			config: this.runtimeContext.config,
			live: this.runtimeContext.live,
		});
	}

	isConnecting(): boolean {
		return this.ensureReadyPromise !== null;
	}

	hasOpenCodeUrl(): boolean {
		return Boolean(this.runtimeContext.live.openCodeUrl);
	}

	isSseConnected(): boolean {
		return Boolean(this.runtimeContext.live.eventStreamConnected && this.eventStreamHandle);
	}

	private isManagerSessionKind(): boolean {
		return this.runtimeContext.config.kind === "manager";
	}

	// ============================================
	// Provider access (for git operations, etc.)
	// ============================================

	getProviderAndSandboxId(): { provider: SandboxProvider; sandboxId: string } | null {
		const sandboxId = this.runtimeContext.live.session.sandbox_id;
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
		overrideCommands?: ConfigurationServiceCommand[],
	): Promise<AutoStartOutputEntry[]> {
		return this.runtimeDriver.testAutoStartCommands(runId, overrideCommands);
	}

	async triggerManagerWakeCycle(): Promise<void> {
		if (!this.isManagerSessionKind()) {
			return;
		}

		let managerApiKey = this.env.anthropicApiKey;
		let managerProxyUrl: string | undefined;
		if (this.env.llmProxyRequired && this.env.llmProxyUrl) {
			const { generateSessionAPIKey } = await import("@proliferate/shared/llm-proxy");
			managerApiKey = await generateSessionAPIKey(
				this.sessionId,
				this.runtimeContext.config.organizationId,
			);
			managerProxyUrl = this.env.llmProxyUrl;
		}

		const internalGatewayUrl = `http://localhost:${this.env.port}`;
		await this.managerHarness.resume({
			managerSessionId: this.sessionId,
			organizationId: this.runtimeContext.config.organizationId,
			workerId: this.runtimeContext.live.session.worker_id,
			gatewayUrl: internalGatewayUrl,
			serviceToken: this.env.serviceToken,
			anthropicApiKey: managerApiKey,
			llmProxyUrl: managerProxyUrl,
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
			hasSandboxId: Boolean(this.runtimeContext.live.session.sandbox_id),
			hasSnapshotId: Boolean(this.runtimeContext.live.session.snapshot_id),
			hasOpenCodeUrl: Boolean(this.runtimeContext.live.openCodeUrl),
			hasOpenCodeSessionId: Boolean(this.runtimeContext.live.openCodeSessionId),
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
			sandboxId: this.runtimeContext.live.session.sandbox_id || null,
			status: this.runtimeContext.live.session.status || "unknown",
			previewUrl: this.runtimeContext.live.previewUrl,
			expiresAt: this.runtimeContext.live.sandboxExpiresAt,
		};
	}

	disconnectSse(): void {
		this.runtimeDriver.disconnectStream();
		this.eventStreamHandle = null;
	}

	resetSandboxState(): void {
		this.runtimeDriver.resetState();
		this.eventStreamHandle = null;
		clearRuntimePointers(this.runtimeContext.live);
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
			this.runtimeContext = await loadSessionRuntimeContext(this.env, this.sessionId);
			const { config, live } = this.runtimeContext;
			this.runtimeDriver = selectRuntimeDriver(config, {
				coding: this.codingDriver,
				manager: this.managerDriver,
			});
			this.logLatency("runtime.ensure_ready.load_context", {
				durationMs: Date.now() - contextStartMs,
				configurationId: live.session.configuration_id,
				repoCount: config.repos.length,
				hasSandbox: Boolean(live.session.sandbox_id),
				hasSnapshot: Boolean(live.session.snapshot_id),
			});
			this.log("Session context loaded", {
				configurationId: live.session.configuration_id,
				repoCount: config.repos.length,
				primaryRepo: config.primaryRepo.github_repo_name,
				hasSandbox: Boolean(live.session.sandbox_id),
				hasSnapshot: Boolean(live.session.snapshot_id),
			});
			this.log(
				`Session context loaded: status=${live.session.status ?? "null"} sandboxId=${live.session.sandbox_id ?? "null"} snapshotId=${live.session.snapshot_id ?? "null"} clientType=${live.session.client_type ?? "null"}`,
			);
			const harnessFamily = config.kind === "manager" ? "manager-claude" : "coding-opencode";
			this.log("Selected harness family", {
				harnessFamily,
				sessionKind: config.kind ?? "unknown",
			});

			// Abort auto-reconnect when session has transitioned to a terminal/non-running state
			// while we were waiting on locks/loading context.
			if (
				options?.reason === "auto_reconnect" &&
				(live.session.status === "paused" || live.session.status === "stopped")
			) {
				this.log("Auto-reconnect aborted: session is no longer running", {
					status: live.session.status,
				});
				return;
			}

			// Billing gate: deny resume/cold-start when org is blocked or exhausted.
			// Uses "session_resume" which skips credit minimum but enforces state-level checks.
			// Already-running sessions skip this entirely (ensureRuntimeReady returns early).
			const orgId = config.organizationId;
			if (orgId) {
				const gateResult = await billing.checkBillingGateForOrg(orgId, "session_resume");
				if (!gateResult.allowed) {
					const msg = gateResult.message ?? "Billing check failed";
					this.log("Billing gate denied resume", { orgId, error: msg });
					this.onStatus("error", msg);
					throw new Error(`Billing gate denied: ${msg}`);
				}
			}

			const hasSandbox = Boolean(live.session.sandbox_id);
			this.onStatus(hasSandbox ? "resuming" : "creating");

			const providerType = live.session.sandbox_provider as SandboxProviderType | undefined;
			const provider = getSandboxProvider(providerType);
			this.provider = provider;
			this.log("Using sandbox provider", { provider: provider.type });

			// Derive per-session sandbox-mcp auth token and merge into env vars
			const sandboxMcpToken = deriveSandboxMcpToken(this.env.serviceToken, this.sessionId);
			const envVarsWithToken = {
				...config.envVars,
				SANDBOX_MCP_AUTH_TOKEN: sandboxMcpToken,
				PROLIFERATE_GATEWAY_URL: this.env.gatewayUrl,
				PROLIFERATE_SESSION_ID: this.sessionId,
			};

			const ensureSandboxStartMs = Date.now();
			const result = await provider.ensureSandbox({
				sessionId: this.sessionId,
				sessionType: live.session.session_type as "coding" | "setup" | null,
				repos: config.repos,
				branch: config.primaryRepo.default_branch || "main",
				envVars: envVarsWithToken,
				systemPrompt: config.systemPrompt,
				snapshotId: live.session.snapshot_id || undefined,
				agentConfig: config.agentConfig,
				currentSandboxId: live.session.sandbox_id || undefined,
				snapshotHasDeps: config.snapshotHasDeps,
				serviceCommands: config.serviceCommands,
				secretFileWrites: config.secretFileWrites,
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

			const previousSandboxId = live.session.sandbox_id ?? null;
			const storedExpiryMs = live.sandboxExpiresAt;
			const canReuseStoredExpiry = result.recovered && previousSandboxId === result.sandboxId;
			const resolvedExpiryMs = result.expiresAt ?? (canReuseStoredExpiry ? storedExpiryMs : null);
			const resolvedOpenCodeUrl = result.tunnelUrl ?? live.session.open_code_tunnel_url ?? null;
			const resolvedPreviewUrl = result.previewUrl ?? live.session.preview_tunnel_url ?? null;
			this.log("Resolved sandbox expiry", {
				previousSandboxId,
				sandboxId: result.sandboxId,
				recovered: result.recovered,
				providerExpiresAt: result.expiresAt ? new Date(result.expiresAt).toISOString() : null,
				storedExpiresAt: storedExpiryMs ? new Date(storedExpiryMs).toISOString() : null,
				canReuseStoredExpiry,
				resolvedExpiresAt: resolvedExpiryMs ? new Date(resolvedExpiryMs).toISOString() : null,
			});
			this.log(
				`Resolved sandbox expiry: previous=${previousSandboxId ?? "null"} current=${result.sandboxId} recovered=${result.recovered} provider=${result.expiresAt ? new Date(result.expiresAt).toISOString() : "null"} stored=${storedExpiryMs ? new Date(storedExpiryMs).toISOString() : "null"} resolved=${resolvedExpiryMs ? new Date(resolvedExpiryMs).toISOString() : "null"}`,
			);

			this.log(result.recovered ? "Sandbox recovered" : "Sandbox created", {
				sandboxId: result.sandboxId,
				tunnelUrl: resolvedOpenCodeUrl,
				previewUrl: resolvedPreviewUrl,
				expiresAt: resolvedExpiryMs ? new Date(resolvedExpiryMs).toISOString() : null,
				recovered: result.recovered,
			});

			const updateStartMs = Date.now();
			await persistRuntimeReady({
				sessionId: this.sessionId,
				live,
				sandboxId: result.sandboxId,
				openCodeTunnelUrl: resolvedOpenCodeUrl,
				previewTunnelUrl: resolvedPreviewUrl,
				sandboxExpiresAt: resolvedExpiryMs,
				autoPauseSnapshotId:
					provider.supportsAutoPause && !live.session.snapshot_id ? result.sandboxId : undefined,
			});
			this.logLatency("runtime.ensure_ready.db.update_session", {
				durationMs: Date.now() - updateStartMs,
			});

			// Schedule expiry snapshot/migration
			const expiryScheduleStartMs = Date.now();
			scheduleSessionExpiry(this.env, this.sessionId, live.sandboxExpiresAt).catch((err) => {
				this.logError("Failed to schedule expiry job", err);
			});
			this.logLatency("runtime.ensure_ready.expiry.schedule", {
				durationMs: Date.now() - expiryScheduleStartMs,
				expiresAt: live.sandboxExpiresAt ? new Date(live.sandboxExpiresAt).toISOString() : null,
			});

			if (live.previewUrl && this.onBroadcast) {
				this.onBroadcast({ type: "preview_url", payload: { url: live.previewUrl } });
			}
			await this.runtimeDriver.activate({
				sessionId: this.sessionId,
				env: this.env,
				logger: this.logger,
				provider,
				config,
				live,
				options,
				log: (message, data) => this.log(message, data),
				logError: (message, error) => this.logError(message, error),
				logLatency: (event, data) => this.logLatency(event, data),
				onRuntimeEvent: (event) => this.onEvent(event),
				onDisconnect: (reason) => this.handleSseDisconnect(reason),
				setEventStreamHandle: (handle) => {
					this.eventStreamHandle = handle;
				},
				onBroadcast: this.onBroadcast,
			});

			this.onStatus("running");
			this.log("Runtime lifecycle complete - runtime driver active", { harnessFamily });
			this.logLatency("runtime.ensure_ready.complete");
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Unknown error";
			this.onStatus("error", errorMessage);
			this.logError(`Failed to initialize session — ${errorMessage}`, err);
			this.logLatency("runtime.ensure_ready.error", { error: errorMessage });
			throw err;
		}
	}

	// ============================================
	// SSE handling
	// ============================================

	private handleSseDisconnect(reason: string): void {
		this.runtimeContext.live.eventStreamConnected = false;
		this.eventStreamHandle = null;
		this.log("SSE disconnected", { reason });
		this.logLatency("runtime.sse.disconnect", { reason });
		this.log("SSE disconnected; preserving OpenCode session identity for reconnect", {
			reason,
			openCodeUrl: this.runtimeContext.live.openCodeUrl,
			openCodeSessionId: this.runtimeContext.live.openCodeSessionId,
		});
		this.onDisconnect(reason);
	}
}
