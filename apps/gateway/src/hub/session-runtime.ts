/**
 * Session Runtime
 *
 * Owns sandbox lifecycle, OpenCode session lifecycle, and SSE connection.
 * Provides a single ensureRuntimeReady() entry point for hot path callers.
 */

import { type Logger, createLogger } from "@proliferate/logger";
import { baseSnapshots, billing, sessions } from "@proliferate/services";
import type {
	AutoStartOutputEntry,
	ConfigurationServiceCommand,
	Message,
	SandboxProvider,
	SandboxProviderType,
	ServerMessage,
} from "@proliferate/shared";
import { getModalAppName, getSandboxProvider } from "@proliferate/shared/providers";
import { SandboxProviderError } from "@proliferate/shared/sandbox";
import { computeBaseSnapshotVersionKey } from "@proliferate/shared/sandbox";
import { scheduleSessionExpiry } from "../expiry/expiry-queue";
import type {
	CodingHarnessEventStreamHandle,
	CodingHarnessPromptImage,
	RuntimeDaemonEvent,
} from "../harness/coding-harness";
import { ClaudeManagerHarnessAdapter } from "../harness/manager-claude-harness";
import { OpenCodeCodingHarnessAdapter } from "../harness/opencode-coding-harness";
import type { GatewayEnv } from "../lib/env";
import { waitForMigrationLockRelease } from "../lib/lock";
import { deriveSandboxMcpToken } from "../lib/sandbox-mcp-token";
import { type SessionContext, loadSessionContext } from "../lib/session-store";
import type { SandboxInfo } from "../types";

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
	onEvent: (event: RuntimeDaemonEvent) => void;
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

	private readonly codingHarness: OpenCodeCodingHarnessAdapter;
	private readonly managerHarness: ClaudeManagerHarnessAdapter;
	private readonly onEvent: SessionRuntimeOptions["onEvent"];
	private readonly onStatus: SessionRuntimeOptions["onStatus"];
	private readonly onBroadcast?: SessionRuntimeOptions["onBroadcast"];
	private readonly onDisconnect: SessionRuntimeOptions["onDisconnect"];

	private provider: SandboxProvider | null = null;
	private openCodeUrl: string | null = null;
	private previewUrl: string | null = null;
	private sshHost: string | null = null;
	private sshPort: number | null = null;
	private openCodeSessionId: string | null = null;
	private sandboxExpiresAt: number | null = null;
	private lifecycleStartTime = 0;
	private eventStreamHandle: CodingHarnessEventStreamHandle | null = null;
	private eventStreamConnected = false;

	private ensureReadyPromise: Promise<void> | null = null;

	constructor(options: SessionRuntimeOptions) {
		this.env = options.env;
		this.sessionId = options.sessionId;
		this.context = options.context;
		this.logger = createLogger({ service: "gateway" }).child({
			module: "runtime",
			sessionId: options.sessionId,
		});
		this.onEvent = options.onEvent;
		this.onStatus = options.onStatus;
		this.onBroadcast = options.onBroadcast;
		this.onDisconnect = options.onDisconnect;
		this.codingHarness = new OpenCodeCodingHarnessAdapter();
		this.managerHarness = new ClaudeManagerHarnessAdapter(this.logger);
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

	/**
	 * Refresh git-related context fields so git operations can use
	 * newly-resolved integration tokens and latest user identity.
	 */
	async refreshGitContext(): Promise<void> {
		const refreshed = await loadSessionContext(this.env, this.sessionId);
		this.context.repos = refreshed.repos;
		this.context.gitIdentity = refreshed.gitIdentity;
	}

	getOpenCodeUrl(): string | null {
		return this.openCodeUrl;
	}

	getOpenCodeSessionId(): string | null {
		return this.openCodeSessionId;
	}

	async sendPrompt(content: string, images?: CodingHarnessPromptImage[]): Promise<void> {
		if (!this.openCodeUrl || !this.openCodeSessionId) {
			throw new Error("Agent session unavailable");
		}
		await this.codingHarness.sendPrompt({
			baseUrl: this.openCodeUrl,
			sessionId: this.openCodeSessionId,
			content,
			images,
		});
	}

	async interruptCurrentRun(): Promise<void> {
		if (!this.openCodeUrl || !this.openCodeSessionId) {
			return;
		}
		await this.codingHarness.interrupt({
			baseUrl: this.openCodeUrl,
			sessionId: this.openCodeSessionId,
		});
	}

	async collectOutputs(): Promise<Message[]> {
		if (!this.openCodeUrl || !this.openCodeSessionId) {
			throw new Error("Missing agent session info");
		}
		const result = await this.codingHarness.collectOutputs({
			baseUrl: this.openCodeUrl,
			sessionId: this.openCodeSessionId,
		});
		return result.messages;
	}

	getPreviewUrl(): string | null {
		return this.previewUrl;
	}

	getSandboxExpiresAt(): number | null {
		return this.sandboxExpiresAt;
	}

	isReady(): boolean {
		if (this.isManagerSessionKind()) {
			return Boolean(this.provider && this.context.session.sandbox_id);
		}
		return Boolean(this.openCodeUrl && this.openCodeSessionId && this.eventStreamConnected);
	}

	isConnecting(): boolean {
		return this.ensureReadyPromise !== null;
	}

	hasOpenCodeUrl(): boolean {
		return Boolean(this.openCodeUrl);
	}

	isSseConnected(): boolean {
		return this.eventStreamConnected;
	}

	private isManagerSessionKind(): boolean {
		return this.context.session.kind === "manager";
	}

	private getHarnessFamily(): "manager-claude" | "coding-opencode" {
		return this.isManagerSessionKind() ? "manager-claude" : "coding-opencode";
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
		overrideCommands?: ConfigurationServiceCommand[],
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
		this.eventStreamHandle?.disconnect();
		this.eventStreamHandle = null;
		this.eventStreamConnected = false;
	}

	resetSandboxState(): void {
		this.eventStreamHandle?.disconnect();
		this.eventStreamHandle = null;
		this.eventStreamConnected = false;
		this.openCodeUrl = null;
		this.previewUrl = null;
		this.sshHost = null;
		this.sshPort = null;
		this.sandboxExpiresAt = null;
		this.openCodeSessionId = null;
		this.context.session.sandbox_id = null;
		this.context.session.sandbox_expires_at = null;
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
				configurationId: this.context.session.configuration_id,
				repoCount: this.context.repos.length,
				hasSandbox: Boolean(this.context.session.sandbox_id),
				hasSnapshot: Boolean(this.context.session.snapshot_id),
			});
			this.log("Session context loaded", {
				configurationId: this.context.session.configuration_id,
				repoCount: this.context.repos.length,
				primaryRepo: this.context.primaryRepo.github_repo_name,
				hasSandbox: Boolean(this.context.session.sandbox_id),
				hasSnapshot: Boolean(this.context.session.snapshot_id),
			});
			this.log(
				`Session context loaded: status=${this.context.session.status ?? "null"} sandboxId=${this.context.session.sandbox_id ?? "null"} snapshotId=${this.context.session.snapshot_id ?? "null"} clientType=${this.context.session.client_type ?? "null"}`,
			);
			const harnessFamily = this.getHarnessFamily();
			this.log("Selected harness family", {
				harnessFamily,
				sessionKind: this.context.session.kind ?? "unknown",
			});

			// Abort auto-reconnect when session has transitioned to a terminal/non-running state
			// while we were waiting on locks/loading context.
			if (
				options?.reason === "auto_reconnect" &&
				(this.context.session.status === "paused" || this.context.session.status === "stopped")
			) {
				this.log("Auto-reconnect aborted: session is no longer running", {
					status: this.context.session.status,
				});
				return;
			}

			// Billing gate: deny resume/cold-start when org is blocked or exhausted.
			// Uses "session_resume" which skips credit minimum but enforces state-level checks.
			// Already-running sessions skip this entirely (ensureRuntimeReady returns early).
			const orgId = this.context.session.organization_id;
			if (orgId) {
				const gateResult = await billing.checkBillingGateForOrg(orgId, "session_resume");
				if (!gateResult.allowed) {
					const msg = gateResult.message ?? "Billing check failed";
					this.log("Billing gate denied resume", { orgId, error: msg });
					this.onStatus("error", msg);
					throw new Error(`Billing gate denied: ${msg}`);
				}
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
			let result: Awaited<ReturnType<SandboxProvider["ensureSandbox"]>>;
			try {
				result = await provider.ensureSandbox({
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
					secretFileWrites: this.context.secretFileWrites,
				});
			} catch (ensureErr) {
				// On memory snapshot restore failure, clear snapshotId so next reconnect
				// creates a fresh sandbox instead of looping on a dead snapshot.
				if (
					ensureErr instanceof SandboxProviderError &&
					ensureErr.operation === "restoreFromMemorySnapshot"
				) {
					this.logger.error(
						{ err: ensureErr },
						"Memory snapshot restore failed, clearing snapshotId",
					);
					await sessions.update(this.sessionId, { snapshotId: null }).catch((dbErr) => {
						this.logger.error({ err: dbErr }, "Failed to clear snapshotId after restore failure");
					});
				}
				throw ensureErr;
			}
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
			const previousSandboxId = this.context.session.sandbox_id ?? null;
			const storedExpiry = this.context.session.sandbox_expires_at
				? Date.parse(this.context.session.sandbox_expires_at)
				: null;
			const storedExpiryMs =
				typeof storedExpiry === "number" && Number.isFinite(storedExpiry) ? storedExpiry : null;
			const canReuseStoredExpiry = result.recovered && previousSandboxId === result.sandboxId;
			const resolvedExpiryMs = result.expiresAt ?? (canReuseStoredExpiry ? storedExpiryMs : null);
			this.sandboxExpiresAt = resolvedExpiryMs;
			this.sshHost = result.sshHost || null;
			this.sshPort = result.sshPort || null;
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
				pauseReason: null,
				openCodeTunnelUrl: result.tunnelUrl,
				previewTunnelUrl: result.previewUrl,
				sandboxExpiresAt: resolvedExpiryMs,
				...(provider.supportsAutoPause &&
					!this.context.session.snapshot_id && { snapshotId: result.sandboxId }),
			});
			this.logLatency("runtime.ensure_ready.db.update_session", {
				durationMs: Date.now() - updateStartMs,
			});

			// Update in-memory context
			this.context.session.sandbox_id = result.sandboxId;
			this.context.session.sandbox_expires_at = resolvedExpiryMs
				? new Date(resolvedExpiryMs).toISOString()
				: null;
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

			if (harnessFamily === "manager-claude") {
				const managerHarnessStartMs = Date.now();
				const harnessInput = {
					managerSessionId: this.sessionId,
					organizationId: this.context.session.organization_id,
					workerId: this.context.session.worker_id,
					gatewayUrl: this.env.gatewayUrl,
					serviceToken: this.env.serviceToken,
					anthropicApiKey: this.env.anthropicApiKey,
					llmProxyUrl: this.env.llmProxyUrl,
				};
				if (options?.reason === "auto_reconnect") {
					await this.managerHarness.resume(harnessInput);
				} else {
					await this.managerHarness.start(harnessInput);
				}
				this.logLatency("runtime.ensure_ready.manager_harness.start", {
					durationMs: Date.now() - managerHarnessStartMs,
				});

				// Manager sessions do not run OpenCode; clear coding-session state.
				this.eventStreamHandle?.disconnect();
				this.eventStreamHandle = null;
				this.eventStreamConnected = false;
				this.openCodeSessionId = null;

				this.onStatus("running");
				this.log("Runtime lifecycle complete - manager harness ready");
				this.logLatency("runtime.ensure_ready.complete");
				return;
			}

			if (!this.openCodeUrl) {
				throw new Error("Missing agent tunnel URL");
			}

			// Wait for OpenCode to become reachable before session operations.
			// After sandbox recovery the tunnel may resolve before OpenCode is serving.
			const readinessStartMs = Date.now();
			await this.waitForOpenCodeReady();
			this.logLatency("runtime.ensure_ready.opencode_ready", {
				durationMs: Date.now() - readinessStartMs,
			});

			// Ensure OpenCode session exists
			const ensureOpenCodeStartMs = Date.now();
			await this.ensureOpenCodeSession();
			this.logLatency("runtime.ensure_ready.opencode_session.ensure", {
				durationMs: Date.now() - ensureOpenCodeStartMs,
				hasOpenCodeSessionId: Boolean(this.openCodeSessionId),
			});

			// Connect to daemon event stream via harness adapter
			const sseStartMs = Date.now();
			this.log("Connecting to coding harness event stream...", { url: this.openCodeUrl });
			this.eventStreamHandle?.disconnect();
			this.eventStreamHandle = await this.codingHarness.streamEvents({
				baseUrl: this.openCodeUrl,
				env: this.env,
				logger: this.logger,
				onDisconnect: (reason) => this.handleSseDisconnect(reason),
				onEvent: (event) => {
					this.logger.debug(
						{ channel: event.channel, type: event.type },
						"runtime.daemon_event.normalized",
					);
					this.onEvent(event);
				},
			});
			this.eventStreamConnected = true;
			this.log("Harness event stream connected");
			this.logLatency("runtime.ensure_ready.sse.connect", {
				durationMs: Date.now() - sseStartMs,
			});

			this.onStatus("running");
			this.log("Runtime lifecycle complete - status: running");
			this.logLatency("runtime.ensure_ready.complete");
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Unknown error";
			this.onStatus("error", errorMessage);
			this.logError(`Failed to initialize session — ${errorMessage}`, err);
			this.logLatency("runtime.ensure_ready.error", { error: errorMessage });
			throw err;
		}
	}

	private async ensureOpenCodeSession(): Promise<void> {
		if (!this.openCodeUrl) {
			throw new Error("Agent URL missing");
		}

		const storedId = this.openCodeSessionId ?? this.context.session.coding_agent_session_id;
		const resumeStartMs = Date.now();
		const resumed = await this.codingHarness.resume({
			baseUrl: this.openCodeUrl,
			sessionId: storedId,
		});
		this.logLatency("runtime.opencode_session.resume", {
			durationMs: Date.now() - resumeStartMs,
			mode: resumed.mode,
			hadStoredId: Boolean(storedId),
		});
		this.log("OpenCode session resolved via harness adapter", {
			sessionId: resumed.sessionId,
			mode: resumed.mode,
		});

		this.openCodeSessionId = resumed.sessionId;
		this.context.session.coding_agent_session_id = resumed.sessionId;
		await sessions.update(this.sessionId, { codingAgentSessionId: resumed.sessionId });
	}

	/**
	 * Poll the OpenCode session-list endpoint until it responds.
	 * Prevents downstream 5s-timeout failures when the tunnel is up
	 * but OpenCode hasn't started serving yet (common after snapshot restore).
	 */
	private async waitForOpenCodeReady(): Promise<void> {
		const maxAttempts = 8;
		const intervalMs = 1500;
		const perAttemptTimeoutMs = 2000;
		const probeUrl = `${this.openCodeUrl}/session`;

		this.log("Waiting for OpenCode readiness", { probeUrl });

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const attemptStartMs = Date.now();
			try {
				const response = await fetch(probeUrl, {
					signal: AbortSignal.timeout(perAttemptTimeoutMs),
				});
				this.log("OpenCode ready", {
					attempt,
					status: response.status,
					durationMs: Date.now() - attemptStartMs,
				});
				return;
			} catch (err) {
				const durationMs = Date.now() - attemptStartMs;
				const message = err instanceof Error ? err.message : String(err);
				const cause =
					err instanceof Error && err.cause && typeof err.cause === "object"
						? (err.cause as { code?: string; message?: string })
						: undefined;

				this.logger.warn(
					{
						attempt,
						maxAttempts,
						durationMs,
						probeUrl,
						error: message,
						causeCode: cause?.code,
						causeMessage: cause?.message,
					},
					"OpenCode readiness probe failed",
				);

				if (attempt >= maxAttempts) {
					this.logError("OpenCode did not become ready", err);
					throw new Error(`OpenCode not reachable after ${maxAttempts} attempts (${message})`);
				}

				await new Promise((resolve) => setTimeout(resolve, intervalMs));
			}
		}
	}

	// ============================================
	// SSE handling
	// ============================================

	private handleSseDisconnect(reason: string): void {
		this.eventStreamConnected = false;
		this.eventStreamHandle = null;
		this.log("SSE disconnected", { reason });
		this.logLatency("runtime.sse.disconnect", { reason });
		this.log("SSE disconnected; preserving OpenCode session identity for reconnect", {
			reason,
			openCodeUrl: this.openCodeUrl,
			openCodeSessionId: this.openCodeSessionId,
		});
		this.onDisconnect(reason);
	}
}
