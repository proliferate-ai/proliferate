/**
 * Session Hub
 *
 * Core hub class that bridges clients and OpenCode sandboxes.
 * Manages client connections, sandbox lifecycle, and message routing.
 *
 * vNext: Tools are executed via HTTP callbacks (POST /tools/:toolName),
 * not SSE interception. The hub tracks active HTTP tool calls to prevent
 * idle snapshotting during tool execution (False Idle Blindspot).
 */

import { randomUUID } from "crypto";
import { type Logger, createLogger } from "@proliferate/logger";
import { prebuilds, sessions } from "@proliferate/services";
import type {
	ClientMessage,
	ClientSource,
	GitResultCode,
	Message,
	SandboxProviderType,
	ServerMessage,
	SessionEventMessage,
	SnapshotResultMessage,
} from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import type { WebSocket } from "ws";
import type { GatewayEnv } from "../lib/env";
import {
	abortOpenCodeSession,
	fetchOpenCodeMessages,
	mapOpenCodeMessages,
	sendPromptAsync,
} from "../lib/opencode";
import { publishSessionEvent } from "../lib/redis";
import { uploadVerificationFiles } from "../lib/s3";
import {
	OWNER_LEASE_TTL_MS,
	acquireOwnerLease,
	clearRuntimeLease,
	releaseOwnerLease,
	renewOwnerLease,
	setRuntimeLease,
} from "../lib/session-leases";
import type { SessionContext } from "../lib/session-store";
import type { ClientConnection, OpenCodeEvent, SandboxInfo } from "../types";
import { EventProcessor } from "./event-processor";
import { GitOperations } from "./git-operations";
import { MigrationController } from "./migration-controller";
import { MigrationInProgressError, SessionRuntime } from "./session-runtime";
import type { PromptOptions } from "./types";

interface HubDependencies {
	env: GatewayEnv;
	sessionId: string;
	context: SessionContext;
	onEvict?: () => void;
}

/** Renewal interval: ~1/3 of owner lease TTL. */
const LEASE_RENEW_INTERVAL_MS = Math.floor(OWNER_LEASE_TTL_MS / 3);

/** Idle snapshot delay: 5 minutes of no SSE activity and no clients. */
const IDLE_SNAPSHOT_DELAY_MS = 5 * 60 * 1000;

export class SessionHub {
	private readonly env: GatewayEnv;
	private readonly sessionId: string;
	private readonly logger: Logger;
	private readonly instanceId: string;

	// Client connections
	private readonly clients = new Map<WebSocket, ClientConnection>();

	// SSE and event processing
	private readonly eventProcessor: EventProcessor;
	private readonly runtime: SessionRuntime;

	private lifecycleStartTime = 0;

	// Migration controller
	private readonly migrationController: MigrationController;

	// Reconnection state
	private reconnectAttempt = 0;

	// Session leases
	private leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
	private lastLeaseRenewAt = 0;

	// Idle snapshot tracking
	private activeHttpToolCalls = 0;
	private idleSnapshotTimer: ReturnType<typeof setTimeout> | null = null;

	// Hub eviction callback (set by HubManager)
	private readonly onEvict?: () => void;

	constructor(deps: HubDependencies) {
		this.env = deps.env;
		this.sessionId = deps.sessionId;
		this.instanceId = randomUUID();
		this.logger = createLogger({ service: "gateway" }).child({
			module: "hub",
			sessionId: deps.sessionId,
		});

		this.eventProcessor = new EventProcessor(
			{
				broadcast: (msg) => this.broadcast(msg),
				getOpenCodeSessionId: () => this.runtime.getOpenCodeSessionId(),
			},
			this.logger,
		);

		this.runtime = new SessionRuntime({
			env: this.env,
			sessionId: this.sessionId,
			context: deps.context,
			onEvent: (event) => this.handleOpenCodeEvent(event),
			onDisconnect: (reason) => this.handleSseDisconnect(reason),
			onStatus: (status, message) => this.broadcastStatus(status, message),
			onBroadcast: (message) => this.broadcast(message),
		});

		this.onEvict = deps.onEvict;

		this.migrationController = new MigrationController({
			sessionId: this.sessionId,
			runtime: this.runtime,
			eventProcessor: this.eventProcessor,
			broadcast: (message) => this.broadcast(message),
			broadcastStatus: (status, message) => this.broadcastStatus(status, message),
			logger: this.logger.child({ module: "migration" }),
			// Treat headless automation sessions as active for expiry migration decisions.
			// These sessions usually have 0 WS clients, but must still migrate/reconnect reliably.
			getClientCount: () => this.getEffectiveClientCount(),
		});
	}

	getSessionId(): string {
		return this.sessionId;
	}

	private getEffectiveClientCount(): number {
		if (this.clients.size > 0) {
			return this.clients.size;
		}

		const clientType = this.runtime.getContext().session.client_type ?? null;
		if (clientType === "automation") {
			return 1;
		}

		return 0;
	}

	private shouldReconnectWithoutClients(): boolean {
		const clientType = this.runtime.getContext().session.client_type ?? null;
		return clientType === "automation";
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
	// Client Management
	// ============================================

	addClient(ws: WebSocket, userId?: string): void {
		const connectionId = randomUUID();
		this.clients.set(ws, { connectionId, userId });
		this.log("Client connected", { connectionId, userId, totalClients: this.clients.size });
		this.touchActivity();

		// Cancel idle snapshot timer when a client connects
		this.cancelIdleSnapshotTimer();

		ws.on("close", () => {
			this.log("Client disconnected", {
				connectionId,
				userId,
				remainingClients: this.clients.size - 1,
			});
			this.removeClient(ws);
		});
		ws.on("error", (err) => {
			this.logError("Client WebSocket error", { connectionId, userId, err });
			this.removeClient(ws);
		});

		// Initialize the client
		this.initializeClient(ws, userId);
	}

	removeClient(ws: WebSocket): void {
		if (!this.clients.has(ws)) {
			return;
		}
		this.clients.delete(ws);
		this.log("Client removed", { remainingClients: this.clients.size });

		// Start idle timer if no clients remain
		if (this.clients.size === 0 && !this.shouldReconnectWithoutClients()) {
			this.scheduleIdleSnapshot();
		}
	}

	private async initializeClient(ws: WebSocket, userId?: string): Promise<void> {
		this.sendStatus(ws, "resuming", "Connecting to coding agent...");
		try {
			await this.ensureRuntimeReady();
			await this.sendInit(ws);
			this.sendStatus(ws, "running");
			this.log("Client initialized and running", { userId });
		} catch (err) {
			if (err instanceof MigrationInProgressError) {
				this.sendStatus(ws, "migrating", "Extending session...");
				this.log("Client init waiting on migration", { userId });
				return;
			}
			this.logError("Failed to initialize session", err);
			this.sendError(ws, "Failed to initialize session");
		}
	}

	handleClientMessage(ws: WebSocket, message: ClientMessage): void {
		this.touchActivity();

		switch (message.type) {
			case "ping":
				this.sendMessage(ws, { type: "pong" });
				return;
			case "prompt": {
				const images = this.normalizeImages(message.images);
				const connection = this.clients.get(ws);
				if (!connection?.userId) {
					this.sendError(ws, "Unauthorized");
					return;
				}
				const effectiveUserId = connection.userId;

				// Never trust a client-supplied userId; derive it from the authenticated connection.
				if (message.userId && message.userId !== effectiveUserId) {
					this.log("Ignoring mismatched client userId", {
						connectionId: connection.connectionId,
						claimedUserId: message.userId,
						userId: effectiveUserId,
					});
				}

				this.handlePrompt(message.content, effectiveUserId, { images, source: "web" }).catch(
					(err) => {
						this.logError("Failed to handle prompt", err);
						this.broadcast({
							type: "error",
							payload: { message: "Failed to send prompt" },
						});
					},
				);
				return;
			}
			case "cancel": {
				const connection = this.clients.get(ws);
				if (!connection?.userId) {
					this.sendError(ws, "Unauthorized");
					return;
				}

				this.handleCancel().catch((err) => {
					this.logError("Failed to cancel", err);
				});
				return;
			}
			case "get_status":
				this.handleGetStatus(ws);
				return;
			case "get_messages":
				this.handleGetMessages(ws);
				return;
			case "save_snapshot":
				this.saveSnapshot(message.message).catch((err) => {
					this.logError("Failed to save snapshot", err);
					this.broadcast({
						type: "snapshot_result",
						payload: {
							success: false,
							error: err instanceof Error ? err.message : "Unknown error",
							target: "session",
						},
					});
				});
				return;
			case "run_auto_start": {
				const connection = this.clients.get(ws);
				if (!connection?.userId) {
					this.sendError(ws, "Unauthorized");
					return;
				}
				this.handleRunAutoStart(message.runId, message.commands).catch((err) => {
					this.logError("Failed to run auto-start test", err);
					this.broadcast({
						type: "auto_start_output",
						payload: {
							runId: message.runId,
							entries: [
								{
									name: "Error",
									output: err instanceof Error ? err.message : "Unknown error",
									exitCode: 1,
								},
							],
						},
					});
				});
				return;
			}
			case "get_git_status": {
				// Read-only — connection auth only
				this.handleGitStatus(ws, message.workspacePath).catch((err) => {
					this.logError("Failed to get git status", err);
					// Always respond so client can clear poll-pending flag
					this.sendMessage(ws, {
						type: "git_result",
						payload: {
							action: "get_status",
							success: false,
							code: "UNKNOWN_ERROR" as GitResultCode,
							message: err instanceof Error ? err.message : "Failed to get git status",
						},
					});
				});
				return;
			}
			case "git_create_branch": {
				const connection = this.clients.get(ws);
				if (!this.assertCanMutateSession(ws, connection?.userId)) return;
				this.handleGitAction(
					ws,
					"create_branch",
					() => this.getGitOps().createBranch(message.branchName, message.workspacePath),
					message.workspacePath,
				).catch((err) => this.logError("Git create branch failed", err));
				return;
			}
			case "git_commit": {
				const connection = this.clients.get(ws);
				if (!this.assertCanMutateSession(ws, connection?.userId)) return;
				this.handleGitAction(
					ws,
					"commit",
					() =>
						this.getGitOps().commit(
							message.message,
							message.includeUntracked ?? false,
							message.files,
							message.workspacePath,
						),
					message.workspacePath,
				).catch((err) => this.logError("Git commit failed", err));
				return;
			}
			case "git_push": {
				const connection = this.clients.get(ws);
				if (!this.assertCanMutateSession(ws, connection?.userId)) return;
				this.handleGitAction(
					ws,
					"push",
					() => this.getGitOps().push(message.workspacePath),
					message.workspacePath,
				).catch((err) => this.logError("Git push failed", err));
				return;
			}
			case "git_create_pr": {
				const connection = this.clients.get(ws);
				if (!this.assertCanMutateSession(ws, connection?.userId)) return;
				this.handleGitAction(
					ws,
					"create_pr",
					() =>
						this.getGitOps().createPr(
							message.title,
							message.body,
							message.baseBranch,
							message.workspacePath,
						),
					message.workspacePath,
				).catch((err) => this.logError("Git create PR failed", err));
				return;
			}
		}
	}

	// ============================================
	// HTTP API Methods (for non-WebSocket clients)
	// ============================================

	/**
	 * Post a prompt via HTTP (for workers without WebSocket connections)
	 */
	postPrompt(content: string, userId: string, source?: ClientSource, images?: string[]): void {
		const normalizedImages = this.normalizeImages(images);
		this.handlePrompt(content, userId, { images: normalizedImages, source }).catch((err) => {
			this.logError("Failed to handle HTTP prompt", err);
			this.broadcast({
				type: "error",
				payload: { message: "Failed to send prompt" },
			});
		});
	}

	/**
	 * Post a cancel via HTTP (for workers without WebSocket connections)
	 */
	postCancel(): void {
		this.handleCancel().catch((err) => {
			this.logError("Failed to handle HTTP cancel", err);
		});
	}

	// ============================================
	// HTTP Tool Call Tracking (False Idle Blindspot)
	// ============================================

	/**
	 * Increment active HTTP tool call counter.
	 * Called by tool routes when a tool execution starts.
	 */
	trackToolCallStart(): void {
		this.activeHttpToolCalls++;
		this.touchActivity();
	}

	/**
	 * Decrement active HTTP tool call counter.
	 * Called by tool routes when a tool execution completes.
	 */
	trackToolCallEnd(): void {
		this.activeHttpToolCalls = Math.max(0, this.activeHttpToolCalls - 1);
		this.touchActivity();
	}

	/**
	 * Check if idle snapshotting is safe (no in-flight tool calls).
	 */
	shouldIdleSnapshot(): boolean {
		if (this.activeHttpToolCalls > 0) {
			return false;
		}
		if (this.eventProcessor.hasRunningTools()) {
			return false;
		}
		if (this.getEffectiveClientCount() > 0) {
			return false;
		}
		return true;
	}

	// ============================================
	// Core Operations
	// ============================================

	/**
	 * Ensure sandbox, OpenCode session, and SSE are ready.
	 */
	async ensureRuntimeReady(): Promise<void> {
		this.lifecycleStartTime = Date.now();
		await this.runtime.ensureRuntimeReady();
		this.startMigrationMonitor();
		await this.startLeaseRenewal();
		await setRuntimeLease(this.sessionId);
	}

	/**
	 * Get sandbox metadata (SSH info, preview URL, etc.)
	 */
	async getSandboxInfo(): Promise<SandboxInfo> {
		await this.ensureRuntimeReady();
		return this.runtime.getSandboxInfo();
	}

	/**
	 * Get the OpenCode tunnel URL for the current session.
	 */
	getOpenCodeUrl(): string | null {
		return this.runtime.getOpenCodeUrl();
	}

	/**
	 * Get the preview tunnel URL for the current session.
	 */
	getPreviewUrl(): string | null {
		return this.runtime.getPreviewUrl();
	}

	/**
	 * Get the session context.
	 */
	getContext(): SessionContext {
		return this.runtime.getContext();
	}

	/**
	 * Broadcast a server message to all connected WebSocket clients.
	 * Used by actions routes to push approval requests and results.
	 */
	broadcastMessage(message: ServerMessage): void {
		this.broadcast(message);
	}

	// ============================================
	// Snapshot Operations
	// ============================================

	/**
	 * Save a snapshot of the current sandbox.
	 */
	async saveSnapshot(
		message?: string,
	): Promise<{ snapshotId: string; target: "prebuild" | "session" }> {
		const context = this.runtime.getContext();
		if (!context.session.sandbox_id) {
			throw new Error("No sandbox to snapshot");
		}

		const isSetupSession = context.session.session_type === "setup";
		const target = isSetupSession ? "prebuild" : "session";

		const startTime = Date.now();
		this.log("Saving snapshot", { target, message });

		const providerType = context.session.sandbox_provider as SandboxProviderType;
		const provider = getSandboxProvider(providerType);
		const sandboxId = context.session.sandbox_id;

		// Load env files spec for scrub/apply around snapshot
		let envFilesSpec: unknown = null;
		if (context.session.prebuild_id) {
			envFilesSpec = await prebuilds.getPrebuildEnvFiles(context.session.prebuild_id);
		}

		// Scrub secrets before snapshot (security-critical: abort if this fails)
		if (envFilesSpec && provider.execCommand) {
			const specJson = JSON.stringify(envFilesSpec);
			const scrubResult = await provider.execCommand(
				sandboxId,
				["proliferate", "env", "scrub", "--spec", specJson],
				{ timeoutMs: 15_000 },
			);
			if (scrubResult.exitCode !== 0) {
				throw new Error(`Env scrub failed before snapshot: ${scrubResult.stderr}`);
			}
			this.log("Env files scrubbed before snapshot");
		}

		let result: { snapshotId: string };
		try {
			result = await provider.snapshot(this.sessionId, sandboxId);
		} finally {
			// Re-apply env files to keep running sandbox functional (even if snapshot failed)
			if (envFilesSpec && provider.execCommand) {
				try {
					const specJson = JSON.stringify(envFilesSpec);
					const applyResult = await provider.execCommand(
						sandboxId,
						["proliferate", "env", "apply", "--spec", specJson],
						{ timeoutMs: 15_000 },
					);
					if (applyResult.exitCode !== 0) {
						this.logger.error({ stderr: applyResult.stderr }, "Env re-apply after snapshot failed");
					} else {
						this.log("Env files re-applied after snapshot");
					}
				} catch (err) {
					this.logger.error({ err }, "Env re-apply after snapshot failed");
				}
			}
		}

		const providerMs = Date.now() - startTime;
		this.log(`[Timing] +${providerMs}ms provider.snapshot complete`);

		if (isSetupSession) {
			if (!context.session.prebuild_id) {
				throw new Error("Setup session has no prebuild");
			}
			await prebuilds.update(context.session.prebuild_id, {
				snapshotId: result.snapshotId,
				status: "ready",
			});
		} else {
			await sessions.update(this.sessionId, {
				snapshotId: result.snapshotId,
			});
		}
		const totalMs = Date.now() - startTime;
		this.log(
			`[Timing] +${totalMs}ms snapshot complete (provider: ${providerMs}ms, db: ${totalMs - providerMs}ms)`,
		);

		const resultMessage: SnapshotResultMessage = {
			type: "snapshot_result",
			payload: { success: true, snapshotId: result.snapshotId, target },
		};
		this.broadcast(resultMessage);

		return { snapshotId: result.snapshotId, target };
	}

	/**
	 * Upload verification files from sandbox to S3.
	 */
	async uploadVerificationFiles(
		folder: string,
	): Promise<{ uploadedCount: number; prefix: string }> {
		const context = this.runtime.getContext();
		if (!context.session.sandbox_id) {
			throw new Error("No sandbox available");
		}

		const folderPath = folder.startsWith("/") ? folder : `/home/user/workspace/${folder}`;
		this.log("Reading verification files", { folder, folderPath });

		const providerType = context.session.sandbox_provider as SandboxProviderType;
		const provider = getSandboxProvider(providerType);

		if (!provider.readFiles) {
			throw new Error("Provider does not support reading files");
		}

		const files = await provider.readFiles(context.session.sandbox_id, folderPath);

		if (!files || files.length === 0) {
			this.log("No files found in verification folder");
			return { uploadedCount: 0, prefix: "" };
		}

		this.log("Uploading verification files", { fileCount: files.length });
		const result = await uploadVerificationFiles(this.sessionId, files, this.env);
		this.log("Verification files uploaded", {
			uploadedCount: result.uploadedCount,
			prefix: result.prefix,
		});

		return result;
	}

	// ============================================
	// Cleanup
	// ============================================

	/**
	 * Stop the migration monitor, lease renewal, and clean up resources.
	 */
	stopMigrationMonitor(): void {
		this.migrationController.stop();
		this.stopLeaseRenewal();
		this.cancelIdleSnapshotTimer();
	}

	/**
	 * Trigger snapshot/migration due to sandbox expiry.
	 */
	async runExpiryMigration(): Promise<void> {
		await this.migrationController.runExpiryMigration();
	}

	/**
	 * Run idle snapshot and evict the hub.
	 * Used by the orphan sweeper for sessions without runtime leases.
	 */
	async runIdleSnapshot(): Promise<void> {
		await this.migrationController.runIdleSnapshot();
		this.onEvict?.();
	}

	// ============================================
	// Private: Session Leases & Split-Brain Detection
	// ============================================

	private async startLeaseRenewal(): Promise<void> {
		if (this.leaseRenewTimer) {
			return;
		}

		// Acquire initial lease — fail fast if another instance owns this session
		const acquired = await acquireOwnerLease(this.sessionId, this.instanceId);
		if (!acquired) {
			this.logger.error("Failed to acquire owner lease — another instance owns this session");
			this.selfTerminate();
			return;
		}

		this.lastLeaseRenewAt = Date.now();

		this.leaseRenewTimer = setInterval(() => {
			const now = Date.now();

			// Split-brain detection: if event loop lagged beyond the TTL,
			// another instance may have taken over. Self-terminate.
			if (now - this.lastLeaseRenewAt > OWNER_LEASE_TTL_MS) {
				this.logger.error(
					{
						lastRenewAt: this.lastLeaseRenewAt,
						lag: now - this.lastLeaseRenewAt,
						ttl: OWNER_LEASE_TTL_MS,
					},
					"Split-brain detected: event loop lag exceeds lease TTL, self-terminating hub",
				);
				this.selfTerminate();
				return;
			}

			this.lastLeaseRenewAt = now;

			renewOwnerLease(this.sessionId, this.instanceId)
				.then((renewed) => {
					if (!renewed) {
						this.logger.error("Owner lease lost during renewal, self-terminating");
						this.selfTerminate();
					}
				})
				.catch((err) => {
					this.logger.error({ err }, "Failed to renew owner lease");
				});

			// Also renew runtime lease
			setRuntimeLease(this.sessionId).catch((err) => {
				this.logger.error({ err }, "Failed to renew runtime lease");
			});
		}, LEASE_RENEW_INTERVAL_MS);
	}

	private stopLeaseRenewal(): void {
		if (this.leaseRenewTimer) {
			clearInterval(this.leaseRenewTimer);
			this.leaseRenewTimer = null;
		}

		// Release leases
		releaseOwnerLease(this.sessionId, this.instanceId).catch((err) => {
			this.logger.error({ err }, "Failed to release owner lease");
		});
		clearRuntimeLease(this.sessionId).catch((err) => {
			this.logger.error({ err }, "Failed to clear runtime lease");
		});
	}

	/**
	 * Self-terminate on split-brain detection.
	 * Aborts in-flight work, drops WS clients, disconnects SSE.
	 */
	private selfTerminate(): void {
		this.stopLeaseRenewal();
		this.migrationController.stop();
		this.cancelIdleSnapshotTimer();

		// Drop all WS clients
		for (const [ws] of this.clients) {
			try {
				ws.close(1001, "Session ownership transferred");
			} catch {
				// ignore
			}
		}
		this.clients.clear();

		// Disconnect SSE
		this.runtime.disconnectSse();

		// Remove from HubManager to prevent zombie entry
		this.onEvict?.();
	}

	// ============================================
	// Private: Idle Snapshot Timer
	// ============================================

	touchActivity(): void {
		// Reset idle snapshot timer when activity occurs.
		if (this.idleSnapshotTimer) {
			this.cancelIdleSnapshotTimer();
			// Reschedule if still idle (no clients, non-automation)
			if (this.clients.size === 0 && !this.shouldReconnectWithoutClients()) {
				this.scheduleIdleSnapshot();
			}
		}
	}

	private scheduleIdleSnapshot(): void {
		this.cancelIdleSnapshotTimer();

		this.idleSnapshotTimer = setTimeout(() => {
			this.idleSnapshotTimer = null;

			if (!this.shouldIdleSnapshot()) {
				this.log("Idle snapshot skipped: active tool calls or clients");
				return;
			}

			this.log("Idle snapshot timer fired, running idle snapshot");
			this.migrationController
				.runIdleSnapshot()
				.then(() => {
					this.log("Idle snapshot complete, evicting hub");
					this.onEvict?.();
				})
				.catch((err) => {
					this.logError("Idle snapshot failed", err);
				});
		}, IDLE_SNAPSHOT_DELAY_MS);
	}

	private cancelIdleSnapshotTimer(): void {
		if (this.idleSnapshotTimer) {
			clearTimeout(this.idleSnapshotTimer);
			this.idleSnapshotTimer = null;
		}
	}

	// ============================================
	// Automation Fast-Path (terminal cleanup, no snapshot)
	// ============================================

	/**
	 * Terminate the session immediately without snapshotting.
	 * Used by automation.complete — automations are terminal.
	 */
	async terminateForAutomation(): Promise<void> {
		this.log("Terminating session for automation fast-path");
		const context = this.runtime.getContext();
		const sandboxId = context.session.sandbox_id;

		// Stop all monitoring
		this.stopMigrationMonitor();

		if (sandboxId) {
			const providerType = context.session.sandbox_provider as SandboxProviderType;
			const provider = getSandboxProvider(providerType);

			try {
				await provider.terminate(this.sessionId, sandboxId);
				this.log("Sandbox terminated for automation");
			} catch (err) {
				this.logError("Failed to terminate sandbox for automation", err);
			}
		}

		try {
			await sessions.markSessionStopped(this.sessionId);
		} catch (err) {
			this.logError("Failed to mark session stopped for automation", err);
		}

		this.runtime.disconnectSse();
		this.runtime.resetSandboxState();
		this.onEvict?.();
	}

	// ============================================
	// Private: Prompt Handling
	// ============================================

	private async handlePrompt(
		content: string,
		userId: string,
		options?: PromptOptions,
	): Promise<void> {
		// Block prompts during migration
		const migrationState = this.migrationController.getState();
		if (migrationState !== "normal") {
			this.log("Dropping prompt during migration", { migrationState });
			return;
		}

		this.log("Handling prompt", {
			userId,
			contentLength: content.length,
			source: options?.source,
			imageCount: options?.images?.length,
		});

		const ensureStartMs = Date.now();
		await this.ensureRuntimeReady();
		this.logger.debug({ durationMs: Date.now() - ensureStartMs }, "prompt.ensure_runtime_ready");

		const openCodeSessionId = this.runtime.getOpenCodeSessionId();
		const openCodeUrl = this.runtime.getOpenCodeUrl();

		if (!openCodeSessionId || !openCodeUrl) {
			throw new Error("Agent session unavailable");
		}

		// Build user message
		const parts: Message["parts"] = [];
		if (options?.images && options.images.length > 0) {
			for (const img of options.images) {
				parts.push({ type: "image", image: `data:${img.mediaType};base64,${img.data}` });
			}
		}
		parts.push({ type: "text", text: content });

		const userMessage: Message = {
			id: randomUUID(),
			role: "user",
			content,
			isComplete: true,
			createdAt: Date.now(),
			senderId: userId,
			source: options?.source,
			parts,
		};
		this.broadcast({ type: "message", payload: userMessage });
		this.log("User message broadcast", { messageId: userMessage.id });

		// Publish to Redis for async clients
		const context = this.runtime.getContext();
		if (context.session.client_type) {
			const event: SessionEventMessage = {
				type: "user_message",
				sessionId: this.sessionId,
				source: options?.source || "web",
				timestamp: Date.now(),
				content,
				userId,
			};
			publishSessionEvent(event).catch((err) => {
				this.logError("Failed to publish session event", err);
			});
		}

		// Reset event processor state for new prompt
		this.eventProcessor.resetForNewPrompt();

		this.log("Sending prompt to OpenCode...");
		const sendStartMs = Date.now();
		await sendPromptAsync(openCodeUrl, openCodeSessionId, content, options?.images);
		this.log("Prompt sent to OpenCode");
		this.logger.debug(
			{
				durationMs: Date.now() - sendStartMs,
				contentLength: content.length,
				imageCount: options?.images?.length || 0,
			},
			"prompt.send_prompt_async",
		);
	}

	private async handleRunAutoStart(runId: string, inlineCommands?: unknown): Promise<void> {
		await this.ensureRuntimeReady();
		const { parsePrebuildServiceCommands } = await import("@proliferate/shared/sandbox");
		const parsed = inlineCommands ? parsePrebuildServiceCommands(inlineCommands) : undefined;
		const entries = await this.runtime.testAutoStartCommands(
			runId,
			parsed?.length ? parsed : undefined,
		);
		this.broadcast({
			type: "auto_start_output",
			payload: { runId, entries },
		});
	}

	private async handleCancel(): Promise<void> {
		this.log("Handling cancel request");
		try {
			await this.ensureRuntimeReady();
		} catch (err) {
			if (err instanceof MigrationInProgressError) {
				this.broadcastStatus("migrating", "Extending session...");
				return;
			}
			throw err;
		}

		const openCodeUrl = this.runtime.getOpenCodeUrl();
		const openCodeSessionId = this.runtime.getOpenCodeSessionId();
		if (!openCodeUrl || !openCodeSessionId) {
			this.log("No OpenCode session to cancel");
			return;
		}

		try {
			await abortOpenCodeSession(openCodeUrl, openCodeSessionId);
			this.log("OpenCode session aborted");
		} catch (err) {
			this.logError("OpenCode abort failed", err);
		}

		// Broadcast cancelled
		const messageId = this.eventProcessor.getCurrentAssistantMessageId();
		this.broadcast({
			type: "message_cancelled",
			payload: { messageId: messageId || undefined },
		});
		this.log("Message cancelled", { messageId });
		this.eventProcessor.clearCurrentAssistantMessageId();
	}

	private handleGetStatus(ws: WebSocket): void {
		let status: "creating" | "resuming" | "running" | "paused" | "stopped" | "error" | "migrating";
		if (this.migrationController.getState() === "migrating") {
			status = "migrating";
		} else if (!this.runtime.isConnecting() && !this.runtime.hasOpenCodeUrl()) {
			status = "stopped";
		} else if (this.runtime.isReady()) {
			status = "running";
		} else {
			status = "resuming";
		}
		this.sendStatus(ws, status);
	}

	private handleGetMessages(ws: WebSocket): void {
		this.log("Handling get_messages request");
		this.ensureRuntimeReady()
			.then(() => this.sendInit(ws))
			.catch((err) => {
				if (err instanceof MigrationInProgressError) {
					this.sendStatus(ws, "migrating", "Extending session...");
					return;
				}
				this.logError("Failed to send messages", err);
				this.sendError(ws, "Failed to fetch messages");
			});
	}

	// ============================================
	// Private: Git Operations
	// ============================================

	private getGitOps(): GitOperations {
		const info = this.runtime.getProviderAndSandboxId();
		if (!info) throw new Error("Runtime not ready");
		return new GitOperations(info.provider, info.sandboxId);
	}

	private assertCanMutateSession(ws: WebSocket, userId?: string): boolean {
		if (!userId) {
			this.sendError(ws, "Unauthorized");
			return false;
		}
		const context = this.runtime.getContext();
		// If created_by is null (e.g. Slack/automation sessions), allow any
		// authenticated user — they already passed org-level auth to connect.
		if (context.session.created_by && context.session.created_by !== userId) {
			this.sendError(ws, "Not authorized to modify this session");
			return false;
		}
		return true;
	}

	private async handleGitStatus(ws: WebSocket, workspacePath?: string): Promise<void> {
		await this.ensureRuntimeReady();
		const status = await this.getGitOps().getStatus(workspacePath);
		this.sendMessage(ws, { type: "git_status", payload: status });
	}

	private async handleGitAction(
		ws: WebSocket,
		action: string,
		fn: () => Promise<{ success: boolean; code: GitResultCode; message: string; prUrl?: string }>,
		workspacePath?: string,
	): Promise<void> {
		await this.ensureRuntimeReady();
		try {
			const result = await fn();
			this.sendMessage(ws, { type: "git_result", payload: { action, ...result } });
			// Auto-refresh status on success (preserve workspacePath)
			if (result.success) {
				const status = await this.getGitOps().getStatus(workspacePath);
				this.sendMessage(ws, { type: "git_status", payload: status });
			}
		} catch (err) {
			this.sendMessage(ws, {
				type: "git_result",
				payload: {
					action,
					success: false,
					code: "UNKNOWN_ERROR" as GitResultCode,
					message: err instanceof Error ? err.message : "Unknown error",
				},
			});
		}
	}

	// ============================================
	// Private: SSE Event Handling
	// ============================================

	private handleOpenCodeEvent(event: OpenCodeEvent): void {
		this.touchActivity();
		this.eventProcessor.process(event);
	}

	private handleSseDisconnect(reason: string): void {
		this.log("SSE disconnected", { reason });

		// Only reconnect if we still have clients (or this is a headless automation session).
		if (this.clients.size === 0 && !this.shouldReconnectWithoutClients()) {
			this.log("No clients connected, skipping reconnection");
			return;
		}

		this.broadcastStatus("resuming", "Reconnecting to coding agent...");
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		const delays = this.env.reconnectDelaysMs;
		const delayIndex = Math.min(this.reconnectAttempt, delays.length - 1);
		const delay = delays[delayIndex];
		this.reconnectAttempt++;

		this.log("Scheduling reconnection", {
			attempt: this.reconnectAttempt,
			delayMs: delay,
		});

		setTimeout(() => {
			// Check again - clients may have disconnected during delay
			if (this.clients.size === 0 && !this.shouldReconnectWithoutClients()) {
				this.log("No clients connected, aborting reconnection");
				this.reconnectAttempt = 0;
				return;
			}

			this.ensureRuntimeReady()
				.then(() => {
					this.log("Reconnection successful");
					this.reconnectAttempt = 0;
				})
				.catch((err) => {
					this.logError("Reconnection failed, retrying...", err);
					this.scheduleReconnect();
				});
		}, delay);
	}

	// ============================================
	// Private: Migration
	// ============================================

	private startMigrationMonitor(): void {
		this.migrationController.start();
	}

	// ============================================
	// Private: Messaging
	// ============================================

	private broadcast(message: ServerMessage): void {
		const payload = JSON.stringify(message);
		for (const [ws] of this.clients) {
			try {
				ws.send(payload);
			} catch {
				// Ignore send failures
			}
		}
	}

	private sendMessage(ws: WebSocket, message: ServerMessage): void {
		try {
			ws.send(JSON.stringify(message));
		} catch {
			// ignore
		}
	}

	private broadcastStatus(
		status: "creating" | "resuming" | "running" | "paused" | "stopped" | "error" | "migrating",
		message?: string,
	): void {
		this.broadcast({
			type: "status",
			payload: { status, ...(message ? { message } : {}) },
		});
	}

	private sendStatus(
		ws: WebSocket,
		status: "creating" | "resuming" | "running" | "paused" | "stopped" | "error" | "migrating",
		message?: string,
	): void {
		this.sendMessage(ws, { type: "status", payload: { status, ...(message ? { message } : {}) } });
	}

	private sendError(ws: WebSocket, message: string): void {
		this.sendMessage(ws, { type: "error", payload: { message } });
	}

	private async sendInit(ws: WebSocket): Promise<void> {
		const openCodeUrl = this.runtime.getOpenCodeUrl();
		const openCodeSessionId = this.runtime.getOpenCodeSessionId();
		const previewUrl = this.runtime.getPreviewUrl();
		if (!openCodeUrl || !openCodeSessionId) {
			throw new Error("Missing agent session info");
		}

		this.log("Fetching OpenCode messages for init...", {
			openCodeSessionId,
			openCodeUrl,
		});
		const messages = await fetchOpenCodeMessages(openCodeUrl, openCodeSessionId);
		const roleCounts = messages.reduce<Record<string, number>>((acc, message) => {
			const role = message.info?.role ?? "unknown";
			acc[role] = (acc[role] ?? 0) + 1;
			return acc;
		}, {});
		this.log("Fetched OpenCode messages", {
			rawMessageCount: messages.length,
			roleCounts,
		});
		const transformed = mapOpenCodeMessages(messages);
		this.log("Sending init to client", { messageCount: transformed.length });

		const initPayload: ServerMessage = {
			type: "init",
			payload: {
				messages: transformed,
				config: previewUrl ? { previewTunnelUrl: previewUrl } : undefined,
			},
		};

		this.sendMessage(ws, initPayload);
	}

	// ============================================
	// Private: Utilities
	// ============================================

	private normalizeImages(
		images?: string[],
	): Array<{ data: string; mediaType: string }> | undefined {
		if (!images || images.length === 0) {
			return undefined;
		}

		const normalized: Array<{ data: string; mediaType: string }> = [];

		for (const dataUri of images) {
			const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
			if (match) {
				normalized.push({ mediaType: match[1], data: match[2] });
			}
		}

		return normalized.length > 0 ? normalized : undefined;
	}
}
