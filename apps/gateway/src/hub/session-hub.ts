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
import { sessions } from "@proliferate/services";
import type {
	ClientMessage,
	ClientSource,
	GitResultCode,
	Message,
	SandboxProviderType,
	ServerMessage,
} from "@proliferate/shared";
import type { SessionRuntimeStatus } from "@proliferate/shared/contracts/sessions";
import { getSandboxProvider } from "@proliferate/shared/providers";
import type { WebSocket } from "ws";
import type { RuntimeDaemonEvent } from "../harness/contracts/coding";
import type { GatewayEnv } from "../lib/env";
import { uploadVerificationFiles } from "../lib/s3";
import { OWNER_LEASE_TTL_MS, setRuntimeLease } from "../lib/session-leases";
import type { ClientConnection, OpenCodeEvent, SandboxInfo } from "../types";
import { MigrationInProgressError, SessionRuntime } from "./session-runtime";
import { GitOperations } from "./session/git/git-operations";
import {
	type IdleControllerDeps,
	type IdleControllerState,
	addProxyConnection as addProxyConnectionState,
	clearAgentIdle,
	markAgentIdle,
	shouldIdleSnapshot as shouldIdleSnapshotState,
	startIdleMonitor as startIdleMonitorState,
	stopIdleMonitor as stopIdleMonitorState,
	touchActivity as touchIdleActivity,
	trackToolCallEnd as trackToolCallEndState,
	trackToolCallStart as trackToolCallStartState,
} from "./session/idle/idle-controller";
import {
	type OwnerLeaseControllerDeps,
	type OwnerLeaseControllerState,
	startOwnerLeaseRenewal,
	stopOwnerLeaseRenewal,
} from "./session/leases/owner-lease-controller";
import { MigrationController } from "./session/migration/migration-controller";
import {
	type ReconnectControllerDeps,
	type ReconnectControllerState,
	cancelReconnect as cancelReconnectState,
	scheduleReconnect as scheduleReconnectState,
} from "./session/reconnect/reconnect-controller";
import type { RuntimeFacade } from "./session/runtime/contracts/runtime-facade";
import { EventProcessor } from "./session/runtime/event-processor";
import type { SessionContext, SessionRecord } from "./session/runtime/session-context-store";
import { SessionTelemetry, extractPrUrls } from "./session/runtime/session-telemetry";
import {
	projectOperatorStatus,
	recordLifecycleEvent,
	touchLastVisibleUpdate,
} from "./session/session-lifecycle";
import { runCancelWorkflow } from "./session/workflows/cancel-workflow";
import { runGitActionWorkflow, runGitStatusWorkflow } from "./session/workflows/git-workflow";
import { buildInitMessages } from "./session/workflows/init-workflow";
import { runPromptWorkflow } from "./session/workflows/prompt-workflow";
import { runSaveSnapshotWorkflow } from "./session/workflows/snapshot-workflow";
import { SESSION_LIFECYCLE_EVENT } from "./shared/lifecycle-events";
import type { HubStatus, HubStatusOrNull } from "./shared/status";
import type { PromptOptions } from "./shared/types";

interface HubDependencies {
	env: GatewayEnv;
	sessionId: string;
	context: SessionContext;
	onEvict?: () => void;
}

/** Renewal interval: ~1/3 of owner lease TTL. */
const LEASE_RENEW_INTERVAL_MS = Math.floor(OWNER_LEASE_TTL_MS / 3);

function isOpenCodeEvent(value: unknown): value is OpenCodeEvent {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as { type?: unknown };
	return typeof candidate.type === "string";
}

export class SessionHub {
	private readonly env: GatewayEnv;
	private readonly sessionId: string;
	private readonly logger: Logger;
	private readonly instanceId: string;

	// Client connections
	private readonly clients = new Map<WebSocket, ClientConnection>();

	// SSE and event processing
	private readonly eventProcessor: EventProcessor;
	private readonly runtime: RuntimeFacade;

	private lifecycleStartTime = 0;

	// Migration controller
	private readonly migrationController: MigrationController;

	// Reconnection state
	private reconnectAttempt = 0;
	private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;
	private reconnectGeneration = 0;
	private latestBroadcastStatus: HubStatusOrNull = null;

	// Session leases
	private leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
	private lastLeaseRenewAt = 0;
	private ownsOwnerLease = false;

	// Idle snapshot tracking
	private activeHttpToolCalls = 0;
	private idleCheckTimer: ReturnType<typeof setInterval> | null = null;

	// Activity & proxy tracking for idle snapshotting
	private readonly proxyConnections = new Set<string>();
	private lastActivityAt = Date.now();
	private lastKnownAgentIdleAt: number | null = null;

	// In-memory guard for initial prompt sending (prevents concurrent sends)
	private initialPromptSending = false;

	// Hub eviction callback (set by HubManager)
	private readonly onEvict?: () => void;

	// Phase 2a: telemetry
	private readonly telemetry: SessionTelemetry;
	private telemetryFlushTimer: ReturnType<typeof setInterval> | null = null;

	constructor(deps: HubDependencies) {
		this.env = deps.env;
		this.sessionId = deps.sessionId;
		this.instanceId = randomUUID();
		this.logger = createLogger({ service: "gateway" }).child({
			module: "hub",
			sessionId: deps.sessionId,
		});

		this.telemetry = new SessionTelemetry(deps.sessionId);

		this.eventProcessor = new EventProcessor(
			{
				broadcast: (msg) => this.broadcast(msg),
				getOpenCodeSessionId: () => this.runtime.getOpenCodeSessionId(),
				onToolStart: (toolCallId) => this.telemetry.recordToolCall(toolCallId),
				onMessageComplete: () => {
					this.telemetry.recordMessageComplete();
					// K3: Update lastVisibleUpdateAt on new assistant output
					touchLastVisibleUpdate(this.sessionId, this.logger);
				},
				onTextPartComplete: (text) => {
					for (const url of extractPrUrls(text)) {
						this.telemetry.recordPrUrl(url);
					}
				},
				onToolMetadata: (title) => {
					if (title) this.telemetry.updateLatestTask(title);
				},
			},
			this.logger,
		);

		// Debounced telemetry flush (every 30s)
		this.telemetryFlushTimer = setInterval(() => {
			this.flushTelemetry().catch((err) => {
				this.logError("Debounced telemetry flush failed", err);
			});
		}, 30_000);

		this.runtime = new SessionRuntime({
			env: this.env,
			sessionId: this.sessionId,
			context: deps.context,
			onEvent: (event) => this.handleRuntimeDaemonEvent(event),
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
			env: this.env,
			shouldIdleSnapshot: () => this.shouldIdleSnapshot(),
			onIdleSnapshotComplete: () => {
				this.stopIdleMonitor();
			},
			cancelReconnect: () => this.cancelReconnect(),
			flushTelemetry: () => this.flushTelemetry(),
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

	private isCompletedAutomationSession(): boolean {
		const session = this.runtime.getContext().session;
		return (
			session.client_type === "automation" &&
			(session.status === "paused" || session.status === "stopped") &&
			Boolean(session.outcome)
		);
	}

	private buildCompletedAutomationFallbackMessages(): Message[] {
		const session = this.runtime.getContext().session;
		const fallbackMessages: Message[] = [];
		const now = Date.now();
		const initialPrompt = session.initial_prompt?.trim();
		const summary =
			session.summary?.trim() ||
			(session.outcome ? `Automation ${session.outcome}.` : null) ||
			(session.latest_task ? `Latest task: ${session.latest_task}` : null);

		if (initialPrompt) {
			fallbackMessages.push({
				id: `${this.sessionId}:fallback:user`,
				role: "user",
				content: initialPrompt,
				isComplete: true,
				createdAt: now - 1,
				source: "automation",
				parts: [{ type: "text", text: initialPrompt }],
			});
		}

		if (summary) {
			fallbackMessages.push({
				id: `${this.sessionId}:fallback:assistant`,
				role: "assistant",
				content: summary,
				isComplete: true,
				createdAt: now,
				source: "automation",
				parts: [{ type: "text", text: summary }],
			});
		}

		return fallbackMessages;
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
		this.touchActivity();
		this.log("Client removed", { remainingClients: this.clients.size });
	}

	private async initializeClient(ws: WebSocket, userId?: string): Promise<void> {
		try {
			if (this.isCompletedAutomationSession()) {
				this.log("Initializing completed automation session without runtime resume");
				await this.sendInit(ws);
				this.sendStatus(ws, "paused", "Automation run completed");
				this.log("Client initialized for completed automation session", { userId });
				return;
			}

			this.sendStatus(ws, "resuming", "Connecting to coding agent...");
			await this.ensureRuntimeReady();
			await this.sendInit(ws);
			this.sendStatus(ws, "running");
			this.log("Client initialized and running", { userId });

			// Auto-send initial prompt if not yet sent
			await this.maybeSendInitialPrompt();
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

	/**
	 * Eager start: boot the sandbox and send the initial prompt without a WebSocket client.
	 * Called by the eager-start HTTP endpoint to start sessions in the background.
	 *
	 * For manager sessions that are already running, this triggers a new wake cycle
	 * so the manager picks up newly queued wake events (e.g. from tick engine).
	 */
	async eagerStart(): Promise<void> {
		this.log("Eager start requested");
		if (this.runtime.isReady() && this.runtime.getContext().session.kind === "manager") {
			this.log("Manager runtime already ready — triggering new wake cycle");
			await this.runtime.triggerManagerWakeCycle();
			this.log("Manager wake cycle triggered");
			return;
		}
		await this.ensureRuntimeReady();
		await this.maybeSendInitialPrompt();
		this.log("Eager start complete");
	}

	/**
	 * Auto-send the initial prompt to OpenCode if it hasn't been sent yet.
	 * Guards against re-sends via both an in-memory flag and the initial_prompt_sent_at DB column.
	 */
	private async maybeSendInitialPrompt(): Promise<void> {
		// In-memory guard: prevent concurrent sends from eager-start + WebSocket init
		if (this.initialPromptSending) {
			return;
		}

		const context = this.runtime.getContext();
		const { session } = context;

		if (!context.initialPrompt || session.initial_prompt_sent_at) {
			return;
		}

		const senderId = session.created_by;
		if (!senderId) {
			this.log("Skipping initial prompt auto-send: no created_by on session");
			return;
		}

		this.initialPromptSending = true;
		this.log("Auto-sending initial prompt");
		const sentAt = new Date().toISOString();

		try {
			// Mark as sent immediately to prevent duplicate sends on concurrent connections.
			await sessions.updateSession(this.sessionId, { initialPromptSentAt: sentAt });
			session.initial_prompt_sent_at = sentAt;

			// Use handlePrompt to broadcast to clients + send to OpenCode.
			await this.handlePrompt(context.initialPrompt, senderId, { source: "web" });
		} catch (err) {
			this.logError("Failed to auto-send initial prompt", err);

			// Roll back sent marker so the next runtime init can retry.
			try {
				await sessions.updateSession(this.sessionId, { initialPromptSentAt: null });
				session.initial_prompt_sent_at = null;
			} catch (clearErr) {
				this.logError("Failed to clear initial_prompt_sent_at after send failure", clearErr);
			}

			throw err;
		} finally {
			this.initialPromptSending = false;
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
	async postPrompt(
		content: string,
		userId: string,
		source?: ClientSource,
		images?: string[],
	): Promise<void> {
		if (this.isCompletedAutomationSession()) {
			throw new Error("Cannot send messages to a completed automation session.");
		}
		const normalizedImages = this.normalizeImages(images);
		await this.handlePrompt(content, userId, { images: normalizedImages, source });
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
		trackToolCallStartState(this.getIdleControllerState());
	}

	/**
	 * Decrement active HTTP tool call counter.
	 * Called by tool routes when a tool execution completes.
	 */
	trackToolCallEnd(): void {
		trackToolCallEndState(this.getIdleControllerState());
	}

	/**
	 * Register a proxy connection (terminal/VS Code WS).
	 * Returns an idempotent cleanup function.
	 */
	addProxyConnection(): () => void {
		return addProxyConnectionState(this.getIdleControllerState());
	}

	/**
	 * Full idle snapshot predicate: checks all conditions including
	 * grace period, clients/proxies, agent idle, SSE state, and sandbox existence.
	 */
	shouldIdleSnapshot(): boolean {
		return shouldIdleSnapshotState(this.getIdleControllerState(), this.getIdleControllerDeps());
	}

	private getIdleGraceMs(): number {
		const sessionType = this.runtime.getContext().session.client_type;
		if (sessionType === "slack") {
			return 30_000;
		}
		return this.env.idleSnapshotGraceSeconds * 1000;
	}

	private getOwnerLeaseControllerState(): OwnerLeaseControllerState {
		const self = this;
		return {
			get leaseRenewTimer() {
				return self.leaseRenewTimer;
			},
			set leaseRenewTimer(value) {
				self.leaseRenewTimer = value;
			},
			get lastLeaseRenewAt() {
				return self.lastLeaseRenewAt;
			},
			set lastLeaseRenewAt(value) {
				self.lastLeaseRenewAt = value;
			},
			get ownsOwnerLease() {
				return self.ownsOwnerLease;
			},
			set ownsOwnerLease(value) {
				self.ownsOwnerLease = value;
			},
		};
	}

	private getOwnerLeaseControllerDeps(): OwnerLeaseControllerDeps {
		return {
			sessionId: this.sessionId,
			instanceId: this.instanceId,
			renewIntervalMs: LEASE_RENEW_INTERVAL_MS,
			logger: this.logger,
			onSelfTerminate: () => this.selfTerminate(),
		};
	}

	private getReconnectControllerState(): ReconnectControllerState {
		const self = this;
		return {
			get reconnectAttempt() {
				return self.reconnectAttempt;
			},
			set reconnectAttempt(value) {
				self.reconnectAttempt = value;
			},
			get reconnectTimerId() {
				return self.reconnectTimerId;
			},
			set reconnectTimerId(value) {
				self.reconnectTimerId = value;
			},
			get reconnectGeneration() {
				return self.reconnectGeneration;
			},
			set reconnectGeneration(value) {
				self.reconnectGeneration = value;
			},
		};
	}

	private getReconnectControllerDeps(): ReconnectControllerDeps {
		return {
			reconnectDelaysMs: this.env.reconnectDelaysMs,
			logger: this.logger,
			getClientCount: () => this.clients.size,
			ensureRuntimeReady: (options) => this.ensureRuntimeReady(options),
		};
	}

	private getIdleControllerState(): IdleControllerState {
		const self = this;
		return {
			get activeHttpToolCalls() {
				return self.activeHttpToolCalls;
			},
			set activeHttpToolCalls(value) {
				self.activeHttpToolCalls = value;
			},
			get idleCheckTimer() {
				return self.idleCheckTimer;
			},
			set idleCheckTimer(value) {
				self.idleCheckTimer = value;
			},
			get lastActivityAt() {
				return self.lastActivityAt;
			},
			set lastActivityAt(value) {
				self.lastActivityAt = value;
			},
			get lastKnownAgentIdleAt() {
				return self.lastKnownAgentIdleAt;
			},
			set lastKnownAgentIdleAt(value) {
				self.lastKnownAgentIdleAt = value;
			},
			proxyConnections: self.proxyConnections,
		};
	}

	private getIdleControllerDeps(): IdleControllerDeps {
		return {
			checkIntervalMs: 30_000,
			getClientType: () => this.runtime.getContext().session.client_type ?? null,
			getSessionKind: () => this.runtime.getContext().session.kind || null,
			getClientCount: () => this.clients.size,
			getHasRunningTools: () => this.eventProcessor.hasRunningTools(),
			getCurrentAssistantMessageId: () => this.eventProcessor.getCurrentAssistantMessageId(),
			isRuntimeReady: () => this.runtime.isReady(),
			hasSandbox: () => Boolean(this.runtime.getContext().session.sandbox_id),
			getIdleGraceMs: () => this.getIdleGraceMs(),
			logInfo: (message) => this.log(message),
			logError: (message, error) => this.logError(message, error),
			runIdleSnapshot: () => this.migrationController.runIdleSnapshot(),
		};
	}

	// ============================================
	// Core Operations
	// ============================================

	/**
	 * Ensure sandbox, OpenCode session, and SSE are ready.
	 */
	async ensureRuntimeReady(options?: { reason?: "auto_reconnect" }): Promise<void> {
		this.lifecycleStartTime = Date.now();
		await this.startLeaseRenewal();
		try {
			await this.runtime.ensureRuntimeReady(options);
		} catch (err) {
			// Preserve prior behavior: failed runtime init should not keep ownership.
			this.stopLeaseRenewal();
			throw err;
		}
		clearAgentIdle(this.getIdleControllerState()); // fresh sandbox, agent state unknown
		this.telemetry.startRunning(); // idempotent: only sets if not already running
		this.startMigrationMonitor();
		await setRuntimeLease(this.sessionId);

		// K5: Record session started event
		const orgId = this.runtime.getContext().session.organization_id;
		recordLifecycleEvent(this.sessionId, SESSION_LIFECYCLE_EVENT.STARTED, this.logger);

		// K4: Project operator status to "active"
		projectOperatorStatus({
			sessionId: this.sessionId,
			organizationId: orgId,
			runtimeStatus: "running",
			hasPendingApproval: false,
			logger: this.logger,
		});
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
	): Promise<{ snapshotId: string; target: "configuration" | "session" }> {
		return runSaveSnapshotWorkflow({
			sessionId: this.sessionId,
			context: this.runtime.getContext(),
			message,
			logger: this.logger,
			broadcast: (resultMessage) => this.broadcast(resultMessage),
			log: (logMessage, data) => this.log(logMessage, data),
		});
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
		this.stopIdleMonitor();
		this.cancelReconnect();
		if (this.telemetryFlushTimer) {
			clearInterval(this.telemetryFlushTimer);
			this.telemetryFlushTimer = null;
		}
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
		await startOwnerLeaseRenewal(
			this.getOwnerLeaseControllerState(),
			this.getOwnerLeaseControllerDeps(),
		);
	}

	private stopLeaseRenewal(): void {
		stopOwnerLeaseRenewal(this.getOwnerLeaseControllerState(), this.getOwnerLeaseControllerDeps());
	}

	/**
	 * Self-terminate on split-brain detection.
	 * Aborts in-flight work, drops WS clients, disconnects SSE.
	 */
	private selfTerminate(): void {
		this.stopLeaseRenewal();
		this.migrationController.stop();
		this.stopIdleMonitor();
		this.cancelReconnect();

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
	// Private: Idle Snapshot Monitor (30s interval)
	// ============================================

	touchActivity(): void {
		touchIdleActivity(this.getIdleControllerState());
	}

	/**
	 * Start a 30s polling interval that checks idle snapshot conditions.
	 * Called once when the runtime becomes ready. Safe to call multiple times.
	 */
	private startIdleMonitor(): void {
		startIdleMonitorState(this.getIdleControllerState(), this.getIdleControllerDeps());
	}

	private stopIdleMonitor(): void {
		stopIdleMonitorState(this.getIdleControllerState());
	}

	/**
	 * Flush accumulated telemetry to DB (best-effort).
	 * Delegates to SessionTelemetry's single-flight mutex.
	 */
	async flushTelemetry(): Promise<void> {
		await this.telemetry.flush(sessions.flushSessionTelemetry);
	}

	// ============================================
	// Private: Prompt Handling
	// ============================================

	private async handlePrompt(
		content: string,
		userId: string,
		options?: PromptOptions,
	): Promise<void> {
		const ensureStartMs = Date.now();
		await runPromptWorkflow(
			{
				sessionId: this.sessionId,
				isCompletedAutomationSession: () => this.isCompletedAutomationSession(),
				getMigrationState: () => this.migrationController.getState(),
				touchActivity: () => this.touchActivity(),
				getLastKnownAgentIdleAt: () => this.lastKnownAgentIdleAt,
				clearAgentIdle: () => clearAgentIdle(this.getIdleControllerState()),
				projectActiveStatusFromIdle: () => {
					const orgId = this.runtime.getContext().session.organization_id;
					void projectOperatorStatus({
						sessionId: this.sessionId,
						organizationId: orgId,
						runtimeStatus: "running",
						hasPendingApproval: false,
						isAgentIdle: false,
						logger: this.logger,
					});
				},
				log: (message, data) => this.log(message, data),
				logError: (message, error) => this.logError(message, error),
				ensureRuntimeReady: () => this.ensureRuntimeReady(),
				getOpenCodeSessionId: () => this.runtime.getOpenCodeSessionId(),
				getOpenCodeUrl: () => this.runtime.getOpenCodeUrl(),
				broadcast: (message) => this.broadcast(message),
				recordUserPromptTelemetry: () => this.telemetry.recordUserPrompt(),
				getSessionClientType: () => this.runtime.getContext().session.client_type ?? null,
				resetEventProcessorForNewPrompt: () => this.eventProcessor.resetForNewPrompt(),
				sendPromptToRuntime: (promptContent, images) =>
					this.runtime.sendPrompt(promptContent, images),
			},
			content,
			userId,
			options,
		);
		this.logger.debug({ durationMs: Date.now() - ensureStartMs }, "prompt.ensure_runtime_ready");
	}

	private async handleRunAutoStart(runId: string, inlineCommands?: unknown): Promise<void> {
		await this.ensureRuntimeReady();
		const { parseConfigurationServiceCommands } = await import("@proliferate/shared/sandbox");
		const parsed = inlineCommands ? parseConfigurationServiceCommands(inlineCommands) : undefined;
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
		await runCancelWorkflow({
			ensureRuntimeReady: () => this.ensureRuntimeReady(),
			onMigrationInProgress: () => this.broadcastStatus("migrating", "Extending session..."),
			getOpenCodeUrl: () => this.runtime.getOpenCodeUrl(),
			getOpenCodeSessionId: () => this.runtime.getOpenCodeSessionId(),
			interruptCurrentRun: () => this.runtime.interruptCurrentRun(),
			getCurrentAssistantMessageId: () => this.eventProcessor.getCurrentAssistantMessageId(),
			clearCurrentAssistantMessageId: () => this.eventProcessor.clearCurrentAssistantMessageId(),
			broadcastCancelled: (messageId) => {
				this.broadcast({
					type: "message_cancelled",
					payload: { messageId },
				});
			},
			log: (message, data) => this.log(message, data),
			logError: (message, error) => this.logError(message, error),
			isMigrationInProgressError: (error) => error instanceof MigrationInProgressError,
		});
	}

	private handleGetStatus(ws: WebSocket): void {
		let status: HubStatus;
		if (this.isCompletedAutomationSession()) {
			status = "paused";
		} else if (this.migrationController.getState() === "migrating") {
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
		if (this.isCompletedAutomationSession()) {
			this.sendInit(ws)
				.then(() => this.sendStatus(ws, "paused", "Automation run completed"))
				.catch((err) => {
					this.logError("Failed to send completed automation messages", err);
					this.sendError(ws, "Failed to fetch messages");
				});
			return;
		}

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
		return new GitOperations(
			info.provider,
			info.sandboxId,
			this.runtime.getContext().gitIdentity,
			this.runtime.getContext().repos,
			this.logger,
		);
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
		await runGitStatusWorkflow(
			{
				ensureRuntimeReady: () => this.ensureRuntimeReady(),
				refreshGitContext: () => this.runtime.refreshGitContext(),
				getGitOps: () => this.getGitOps(),
				sendMessage: (socket, message) => this.sendMessage(socket, message as ServerMessage),
				logError: (message, error) => this.logError(message, error),
			},
			ws,
			workspacePath,
		);
	}

	private async handleGitAction(
		ws: WebSocket,
		action: string,
		fn: () => Promise<{ success: boolean; code: GitResultCode; message: string; prUrl?: string }>,
		workspacePath?: string,
	): Promise<void> {
		await runGitActionWorkflow(
			{
				ensureRuntimeReady: () => this.ensureRuntimeReady(),
				refreshGitContext: () => this.runtime.refreshGitContext(),
				getGitOps: () => this.getGitOps(),
				sendMessage: (socket, message) => this.sendMessage(socket, message as ServerMessage),
				logError: (message, error) => this.logError(message, error),
				recordPrUrl: (url) => this.telemetry.recordPrUrl(url),
			},
			{
				ws,
				action,
				workspacePath,
				run: fn,
			},
		);
	}

	// ============================================
	// Private: SSE Event Handling
	// ============================================

	private handleRuntimeDaemonEvent(event: RuntimeDaemonEvent): void {
		const rawEvent = event.payload;
		if (!isOpenCodeEvent(rawEvent)) {
			this.logger.warn({ eventType: event.type }, "Ignoring unsupported daemon event payload");
			return;
		}

		this.touchActivity();
		const wasBusy = this.eventProcessor.getCurrentAssistantMessageId() !== null;
		this.eventProcessor.process(rawEvent);
		const nowIdle = this.eventProcessor.getCurrentAssistantMessageId() === null;
		const reportedIdle =
			event.type === "session.idle" ||
			(event.type === "session.status" &&
				(rawEvent.properties as { status?: { type?: string } } | undefined)?.status?.type ===
					"idle");

		const becameIdle = (wasBusy && nowIdle) || reportedIdle;

		if (wasBusy && nowIdle) {
			markAgentIdle(this.getIdleControllerState());
		}
		if (reportedIdle) {
			// Text-only completions can retain assistant message id for de-dup; treat explicit idle as done.
			markAgentIdle(this.getIdleControllerState());
		}

		// K4: Project needs_input when agent becomes idle
		if (becameIdle) {
			const orgId = this.runtime.getContext().session.organization_id;
			void projectOperatorStatus({
				sessionId: this.sessionId,
				organizationId: orgId,
				runtimeStatus: "running",
				hasPendingApproval: false,
				isAgentIdle: true,
				logger: this.logger,
			});
		}
	}

	private handleSseDisconnect(reason: string): void {
		const context = this.runtime.getContext();
		const isHeadlessAutomation =
			this.clients.size === 0 &&
			context.session.client_type === "automation" &&
			context.session.status === "running";
		this.log("SSE disconnected", {
			reason,
			connectedClients: this.clients.size,
			clientType: context.session.client_type ?? null,
			sessionStatus: context.session.status ?? null,
			sandboxId: context.session.sandbox_id ?? null,
			sandboxExpiresAt: context.session.sandbox_expires_at ?? null,
			isHeadlessAutomation,
		});

		// For headless automation runs, avoid reconnect loops that churn OpenCode session identity.
		// We'll reconnect when a client explicitly attaches (workspace open / get_messages).
		if (isHeadlessAutomation) {
			this.log("Skipping auto-reconnect for headless automation session");
			return;
		}

		// Only reconnect automatically when at least one WS client is attached.
		if (this.clients.size === 0) {
			this.log("No clients connected, skipping reconnection");
			return;
		}

		this.broadcastStatus("resuming", "Reconnecting to coding agent...");
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		scheduleReconnectState(this.getReconnectControllerState(), this.getReconnectControllerDeps());
	}

	private cancelReconnect(): void {
		cancelReconnectState(this.getReconnectControllerState());
	}

	// ============================================
	// Private: Migration
	// ============================================

	private startMigrationMonitor(): void {
		this.migrationController.start();
		this.startIdleMonitor();
	}

	// ============================================
	// Private: Messaging
	// ============================================

	private broadcast(message: ServerMessage): void {
		if (
			message.type === "status" ||
			message.type === "tool_start" ||
			message.type === "tool_metadata" ||
			message.type === "tool_end" ||
			message.type === "message_complete" ||
			message.type === "error"
		) {
			const payload = "payload" in message ? message.payload : undefined;
			this.logger.debug(
				{
					type: message.type,
					clientCount: this.clients.size,
					status:
						message.type === "status" && payload && typeof payload === "object"
							? ((payload as { status?: string }).status ?? null)
							: null,
					statusMessage:
						message.type === "status" && payload && typeof payload === "object"
							? ((payload as { message?: string }).message ?? null)
							: null,
					toolCallId:
						(message.type === "tool_start" ||
							message.type === "tool_metadata" ||
							message.type === "tool_end") &&
						payload &&
						typeof payload === "object"
							? ((payload as { toolCallId?: string }).toolCallId ?? null)
							: null,
					tool:
						(message.type === "tool_start" ||
							message.type === "tool_metadata" ||
							message.type === "tool_end") &&
						payload &&
						typeof payload === "object"
							? ((payload as { tool?: string }).tool ?? null)
							: null,
				},
				"Broadcasting session event to WS clients",
			);
		}

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

	private broadcastStatus(status: HubStatus, message?: string): void {
		this.latestBroadcastStatus = status;
		this.logger.info(
			{
				status,
				message: message ?? null,
				clientCount: this.clients.size,
			},
			"Broadcasting session status",
		);
		this.broadcast({
			type: "status",
			payload: { status, ...(message ? { message } : {}) },
		});

		// K3/K4/K5: Fire lifecycle side-effects on status transitions (best-effort, non-blocking)
		this.handleStatusLifecycle(status);
	}

	/**
	 * Fire best-effort lifecycle side-effects when broadcast status changes.
	 * K3: lastVisibleUpdateAt, K4: operator status, K5: session events.
	 */
	private handleStatusLifecycle(status: HubStatus): void {
		const orgId = this.runtime.getContext().session.organization_id;

		if (status === "paused") {
			// K5: Record session paused event
			recordLifecycleEvent(this.sessionId, SESSION_LIFECYCLE_EVENT.PAUSED, this.logger);
			// K3: Touch visible update on pause
			touchLastVisibleUpdate(this.sessionId, this.logger);
		} else if (status === "stopped") {
			// K3: Touch visible update on terminal state
			touchLastVisibleUpdate(this.sessionId, this.logger);
			// K4: Project terminal operator status (ready_for_review)
			projectOperatorStatus({
				sessionId: this.sessionId,
				organizationId: orgId,
				runtimeStatus: "completed",
				hasPendingApproval: false,
				logger: this.logger,
			});
			// K5: Record terminal event
			recordLifecycleEvent(this.sessionId, SESSION_LIFECYCLE_EVENT.COMPLETED, this.logger);
		} else if (status === "error") {
			// K3: Touch visible update on error
			touchLastVisibleUpdate(this.sessionId, this.logger);
			// K4: Project errored operator status
			projectOperatorStatus({
				sessionId: this.sessionId,
				organizationId: orgId,
				runtimeStatus: "failed",
				hasPendingApproval: false,
				logger: this.logger,
			});
			// K5: Record failure event
			recordLifecycleEvent(this.sessionId, SESSION_LIFECYCLE_EVENT.FAILED, this.logger);
		} else if (status === "running") {
			// K3: Touch visible update when session starts running
			touchLastVisibleUpdate(this.sessionId, this.logger);
		} else if (status === "resuming") {
			// K5: Record session resumed event
			recordLifecycleEvent(this.sessionId, SESSION_LIFECYCLE_EVENT.RESUMED, this.logger);
			// K3: Touch visible update on resume
			touchLastVisibleUpdate(this.sessionId, this.logger);
		}
	}

	private sendStatus(ws: WebSocket, status: HubStatus, message?: string): void {
		this.logger.debug(
			{
				status,
				message: message ?? null,
			},
			"Sending session status to WS client",
		);
		this.sendMessage(ws, { type: "status", payload: { status, ...(message ? { message } : {}) } });
	}

	private sendError(ws: WebSocket, message: string): void {
		this.sendMessage(ws, { type: "error", payload: { message } });
	}

	private async sendInit(ws: WebSocket): Promise<void> {
		const { initPayload, snapshotPayload } = await buildInitMessages({
			sessionId: this.sessionId,
			getRuntimeSession: () => this.runtime.getContext().session,
			getFreshControlPlaneSession: (base) => this.getFreshControlPlaneSession(base),
			getOpenCodeUrl: () => this.runtime.getOpenCodeUrl(),
			getOpenCodeSessionId: () => this.runtime.getOpenCodeSessionId(),
			getPreviewUrl: () => this.runtime.getPreviewUrl(),
			isCompletedAutomationSession: () => this.isCompletedAutomationSession(),
			collectOutputs: () => this.runtime.collectOutputs(),
			buildCompletedAutomationFallbackMessages: () =>
				this.buildCompletedAutomationFallbackMessages(),
			log: (message, data) => this.log(message, data),
			logError: (message, error) => this.logError(message, error),
			reconnectGeneration: this.reconnectGeneration,
			mapHubStatusToControlPlaneRuntime: () =>
				this.mapHubStatusToControlPlaneRuntime(this.latestBroadcastStatus),
		});
		this.sendMessage(ws, initPayload);
		this.sendMessage(ws, snapshotPayload);
	}

	private mapHubStatusToControlPlaneRuntime(status: HubStatusOrNull): SessionRuntimeStatus | null {
		switch (status) {
			case "creating":
			case "resuming":
			case "migrating":
				return "starting";
			case "running":
				return "running";
			case "paused":
				return "paused";
			case "error":
				return "failed";
			case "stopped":
			case null:
				return null;
		}
	}

	private async getFreshControlPlaneSession(base: SessionRecord): Promise<SessionRecord> {
		try {
			const fresh = await sessions.findSessionByIdInternal(this.sessionId);
			if (!fresh) {
				return base;
			}

			return {
				...base,
				status: fresh.status ?? base.status ?? null,
				runtime_status:
					(fresh.runtimeStatus as SessionRuntimeStatus | null) ?? base.runtime_status ?? null,
				operator_status:
					(fresh.operatorStatus as SessionRecord["operator_status"]) ??
					base.operator_status ??
					null,
				capabilities_version: fresh.capabilitiesVersion ?? base.capabilities_version ?? null,
				visibility: (fresh.visibility as SessionRecord["visibility"]) ?? base.visibility ?? null,
				worker_id: fresh.workerId ?? base.worker_id ?? null,
				worker_run_id: fresh.workerRunId ?? base.worker_run_id ?? null,
				sandbox_id: fresh.sandboxId ?? base.sandbox_id ?? null,
			};
		} catch (error) {
			this.logError("Failed to refresh control-plane snapshot session state", error);
			return base;
		}
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
