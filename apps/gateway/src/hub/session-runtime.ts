/**
 * Session Runtime
 *
 * Owns sandbox lifecycle, agent session lifecycle, and SSE connection.
 * Provides a single ensureRuntimeReady() entry point for hot path callers.
 *
 * Both coding (OpenCode) and manager (Pi) sessions flow through the same
 * SandboxAgentV2CodingHarnessAdapter — the only difference is the agent name
 * passed during ACP session creation.
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
import { BillingGateError } from "@proliferate/shared/billing";
import { getSandboxProvider } from "@proliferate/shared/providers";
import { SandboxAgentV2CodingHarnessAdapter } from "../harness/coding/sandbox-agent-v2/adapter";
import type {
	CodingHarnessEventStreamHandle,
	CodingHarnessPromptImage,
} from "../harness/contracts/coding";
import type { ManagerControlFacade } from "../harness/manager/control-facade";
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
import { connectCodingEventStream } from "./session/runtime/event-stream";
import type { SessionContext } from "./session/runtime/session-context-store";
import { loadSessionContext } from "./session/runtime/session-context-store";
import {
	type SessionRuntimeSpec,
	resolveRuntimeSpec,
} from "./session/runtime/session-runtime-spec";
import { clearRuntimePointers } from "./session/runtime/state/state-reconciler";
import {
	persistCodingSessionId,
	persistRuntimeReady,
} from "./session/runtime/write-authority/runtime-writers";
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
	managerControlFacade?: ManagerControlFacade;
}

export class SessionRuntime {
	private readonly env: GatewayEnv;
	private readonly sessionId: string;
	private runtimeContext: SessionRuntimeContext;
	private readonly logger: Logger;

	private adapter: SandboxAgentV2CodingHarnessAdapter;
	private spec: SessionRuntimeSpec;
	private readonly onEvent: SessionRuntimeOptions["onEvent"];
	private readonly onStatus: SessionRuntimeOptions["onStatus"];
	private readonly onBroadcast?: SessionRuntimeOptions["onBroadcast"];
	private readonly onDisconnect: SessionRuntimeOptions["onDisconnect"];

	private provider: SandboxProvider | null = null;
	private runtimeBaseUrl: string | null = null;
	private openCodeSessionId: string | null = null;
	private runtimeBindingId: string | null = null;
	private serviceCommands: ConfigurationServiceCommand[] | undefined;
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
		this.spec = resolveRuntimeSpec(this.runtimeContext.config.kind);
		this.adapter = new SandboxAgentV2CodingHarnessAdapter(this.spec.agentName);
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
	async refreshGitContext(preferredGitUserId?: string | null): Promise<void> {
		const refreshed = await loadSessionContext(this.env, this.sessionId, {
			preferredGitUserId: preferredGitUserId ?? null,
		});
		this.runtimeContext = {
			...this.runtimeContext,
			config: {
				...this.runtimeContext.config,
				repos: refreshed.repos,
				gitIdentity: refreshed.gitIdentity,
			},
		};
	}

	getOpenCodeUrl(): string | null {
		return this.runtimeContext.live.openCodeUrl;
	}

	getOpenCodeSessionId(): string | null {
		return this.runtimeContext.live.openCodeSessionId;
	}

	getRuntimeBindingId(): string | null {
		return this.runtimeContext.live.runtimeBindingId;
	}

	async sendPrompt(
		_userId: string,
		content: string,
		images?: CodingHarnessPromptImage[],
	): Promise<void> {
		if (!this.runtimeBaseUrl || !this.openCodeSessionId) {
			throw new Error("Agent session unavailable");
		}
		await this.adapter.sendPrompt({
			baseUrl: this.runtimeBaseUrl,
			sessionId: this.openCodeSessionId,
			content,
			images,
		});
	}

	async interruptCurrentRun(): Promise<void> {
		if (!this.runtimeBaseUrl || !this.openCodeSessionId) {
			return;
		}
		await this.adapter.interrupt({
			baseUrl: this.runtimeBaseUrl,
			sessionId: this.openCodeSessionId,
		});
	}

	async collectOutputs(): Promise<Message[]> {
		if (!this.runtimeBaseUrl || !this.openCodeSessionId) {
			return [];
		}
		const result = await this.adapter.collectOutputs({
			baseUrl: this.runtimeBaseUrl,
			sessionId: this.openCodeSessionId,
		});
		return result.messages;
	}

	getPreviewUrl(): string | null {
		return this.runtimeContext.live.previewUrl;
	}

	getSandboxExpiresAt(): number | null {
		return this.runtimeContext.live.sandboxExpiresAt;
	}

	isReady(): boolean {
		const { live } = this.runtimeContext;
		return Boolean(live.previewUrl && live.eventStreamConnected && this.openCodeSessionId);
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
		// Manager sessions do not run service commands
		if (this.isManagerSessionKind()) {
			return [];
		}
		if (!this.provider) {
			throw new Error("Runtime not ready");
		}
		const sandboxId = this.runtimeContext.live.session.sandbox_id;
		const commands = overrideCommands !== undefined ? overrideCommands : this.serviceCommands;
		if (!this.provider.testServiceCommands || !sandboxId) {
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
	 * Ensure sandbox, agent session, and SSE are ready.
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
		this.eventStreamHandle?.disconnect();
		this.eventStreamHandle = null;
		if (this.runtimeContext.live) {
			this.runtimeContext.live.eventStreamConnected = false;
		}
	}

	resetSandboxState(): void {
		this.disconnectSse();
		this.runtimeBaseUrl = null;
		this.openCodeSessionId = null;
		this.runtimeBindingId = null;
		this.provider = null;
		this.serviceCommands = undefined;
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

			// Resolve spec and recreate adapter with correct agent name
			this.spec = resolveRuntimeSpec(config.kind);
			this.adapter = new SandboxAgentV2CodingHarnessAdapter(this.spec.agentName);

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
			const harnessFamily = config.kind === "manager" ? "manager-pi" : "coding-opencode";
			this.log("Selected harness family", {
				harnessFamily,
				sessionKind: config.kind ?? "unknown",
				agentName: this.spec.agentName,
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
					throw new BillingGateError(msg, gateResult.code ?? "STATE_BLOCKED");
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
				sessionKind: config.kind as "task" | "setup" | "manager" | null,
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
			const resolvedOpenCodeUrl =
				typeof result.tunnelUrl === "string" && result.tunnelUrl.length > 0
					? result.tunnelUrl
					: (live.session.open_code_tunnel_url ?? null);
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

			// ------------------------------------------------------------------
			// Activate: ensure ACP session + connect SSE
			// ------------------------------------------------------------------
			this.runtimeBaseUrl = live.previewUrl;
			this.serviceCommands = config.serviceCommands;
			if (!this.runtimeBaseUrl) {
				throw new Error("Missing sandbox runtime endpoint");
			}

			const ensureAcpStartMs = Date.now();
			const resumed = await this.adapter.resume({
				baseUrl: this.runtimeBaseUrl,
				sessionId: live.openCodeSessionId ?? live.session.coding_agent_session_id,
			});
			this.openCodeSessionId = resumed.sessionId;
			this.logLatency("runtime.ensure_ready.acp_session.ensure", {
				durationMs: Date.now() - ensureAcpStartMs,
				mode: resumed.mode,
				agentName: this.spec.agentName,
			});

			// Persist ACP session ID for coding sessions (manager sessions don't track it)
			if (!this.isManagerSessionKind()) {
				await persistCodingSessionId({
					sessionId: this.sessionId,
					live,
					codingSessionId: resumed.sessionId,
				});
			}

			this.runtimeBindingId = this.openCodeSessionId;
			this.runtimeContext.live.runtimeBindingId = this.runtimeBindingId;

			// Connect SSE streams (ACP agent events + platform events)
			this.eventStreamHandle?.disconnect();
			const sseAuthToken = deriveSandboxMcpToken(this.env.serviceToken, this.sessionId);
			const sseConnectStartMs = Date.now();
			this.eventStreamHandle = await connectCodingEventStream({
				codingHarness: this.adapter,
				runtimeBaseUrl: this.runtimeBaseUrl,
				authToken: sseAuthToken,
				afterSeq: live.lastRuntimeSourceSeq ?? undefined,
				bindingId: this.runtimeBindingId,
				env: this.env,
				logger: this.logger,
				onDisconnect: (reason) => this.handleSseDisconnect(reason),
				onEvent: (event) => {
					if (typeof event.sourceSeq === "number") {
						live.lastRuntimeSourceSeq = event.sourceSeq;
					}
					this.onEvent(event);
				},
				onDaemonEnvelope: (envelope) => {
					if (!this.onBroadcast) return;
					// Forward non-agent platform events to clients
					if (envelope.stream !== "agent_event") {
						this.onBroadcast({
							type: "daemon_stream",
							payload: envelope,
						} as import("@proliferate/shared").ServerMessage);
					}
					// Port events
					if (envelope.stream === "port_opened" || envelope.stream === "port_closed") {
						const payload = envelope.payload as { port?: unknown; host?: unknown };
						if (typeof payload.port === "number") {
							this.onBroadcast({
								type: "port_event",
								payload: {
									action: envelope.stream === "port_opened" ? "opened" : "closed",
									port: payload.port,
									host: typeof payload.host === "string" ? payload.host : undefined,
								},
							} as import("@proliferate/shared").ServerMessage);
						}
					}
					// FS change events
					if (envelope.stream === "fs_change") {
						const payload = envelope.payload as {
							action?: unknown;
							path?: unknown;
							size?: unknown;
						};
						if (typeof payload.action === "string" && typeof payload.path === "string") {
							this.onBroadcast({
								type: "fs_change",
								payload: {
									action: payload.action as "write" | "delete" | "rename" | "create",
									path: payload.path,
									size: typeof payload.size === "number" ? payload.size : undefined,
								},
							} as import("@proliferate/shared").ServerMessage);
						}
					}
				},
				onLog: (message, data) => this.log(message, data),
			});
			live.eventStreamConnected = true;
			this.logLatency("runtime.ensure_ready.sse.connect", {
				durationMs: Date.now() - sseConnectStartMs,
			});

			this.onStatus("running");
			this.log("Runtime lifecycle complete", { harnessFamily, agentName: this.spec.agentName });
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
		this.log("SSE disconnected; preserving agent session identity for reconnect", {
			reason,
			openCodeUrl: this.runtimeContext.live.openCodeUrl,
			openCodeSessionId: this.runtimeContext.live.openCodeSessionId,
		});
		this.onDisconnect(reason);
	}
}
