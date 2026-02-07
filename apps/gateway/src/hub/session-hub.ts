/**
 * Session Hub
 *
 * Core hub class that bridges clients and OpenCode sandboxes.
 * Manages client connections, sandbox lifecycle, and message routing.
 */

import { randomUUID } from "crypto";
import { prebuilds, sessions } from "@proliferate/services";
import type {
	ClientMessage,
	ClientSource,
	Message,
	SandboxProviderType,
	ServerMessage,
	SessionEventMessage,
	SnapshotResultMessage,
	ToolEndMessage,
} from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import type { WebSocket } from "ws";
import type { GatewayEnv } from "../lib/env";
import {
	abortOpenCodeSession,
	fetchOpenCodeMessages,
	mapOpenCodeMessages,
	sendPromptAsync,
	updateToolResult,
} from "../lib/opencode";
import { publishSessionEvent } from "../lib/redis";
import { uploadVerificationFiles } from "../lib/s3";
import type { SessionContext } from "../lib/session-store";
import type { ClientConnection, OpenCodeEvent, SandboxInfo } from "../types";
import { getInterceptedToolHandler, getInterceptedToolNames } from "./capabilities/tools";
import { EventProcessor } from "./event-processor";
import { MigrationController } from "./migration-controller";
import { MigrationInProgressError, SessionRuntime } from "./session-runtime";
import type { PromptOptions } from "./types";

interface HubDependencies {
	env: GatewayEnv;
	sessionId: string;
	context: SessionContext;
}

export class SessionHub {
	private readonly env: GatewayEnv;
	private readonly sessionId: string;
	private readonly shortId: string;

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

	constructor(deps: HubDependencies) {
		this.env = deps.env;
		this.sessionId = deps.sessionId;
		this.shortId = deps.sessionId.slice(0, 8);

		this.eventProcessor = new EventProcessor(
			{
				broadcast: (msg) => this.broadcast(msg),
				onInterceptedTool: (toolName, args, partId, messageId, toolCallId) =>
					this.handleInterceptedTool(toolName, args, partId, messageId, toolCallId),
				getOpenCodeSessionId: () => this.runtime.getOpenCodeSessionId(),
			},
			getInterceptedToolNames(),
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

		this.migrationController = new MigrationController({
			sessionId: this.sessionId,
			runtime: this.runtime,
			eventProcessor: this.eventProcessor,
			broadcast: (message) => this.broadcast(message),
			broadcastStatus: (status, message) => this.broadcastStatus(status, message),
			log: (message, data) => this.log(message, data),
			logError: (message, error) => this.logError(message, error),
			getClientCount: () => this.clients.size,
		});
	}

	getSessionId(): string {
		return this.sessionId;
	}

	// ============================================
	// Logging
	// ============================================

	private log(message: string, data?: Record<string, unknown>): void {
		const elapsed = this.lifecycleStartTime ? `+${Date.now() - this.lifecycleStartTime}ms` : "";
		const dataStr = data ? ` ${JSON.stringify(data)}` : "";
		console.log(`[Hub:${this.shortId}] ${elapsed} ${message}${dataStr}`);
	}

	private logError(message: string, error?: unknown): void {
		const elapsed = this.lifecycleStartTime ? `+${Date.now() - this.lifecycleStartTime}ms` : "";
		console.error(`[Hub:${this.shortId}] ${elapsed} ${message}`, error);
	}

	// ============================================
	// Client Management
	// ============================================

	addClient(ws: WebSocket, userId?: string): void {
		const connectionId = randomUUID();
		this.clients.set(ws, { connectionId, userId });
		this.log("Client connected", { connectionId, userId, totalClients: this.clients.size });

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
						console.error("Failed to handle prompt", err);
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
					console.error("Failed to cancel", err);
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
			console.error("Failed to handle HTTP prompt", err);
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
			console.error("Failed to handle HTTP cancel", err);
		});
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
	 * Get the session context.
	 */
	getContext(): SessionContext {
		return this.runtime.getContext();
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
		const result = await provider.snapshot(this.sessionId, context.session.sandbox_id);
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
	 * Stop the migration monitor and clean up resources.
	 */
	stopMigrationMonitor(): void {
		this.migrationController.stop();
	}

	/**
	 * Trigger snapshot/migration due to sandbox expiry.
	 */
	async runExpiryMigration(): Promise<void> {
		await this.migrationController.runExpiryMigration();
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
		console.log("[P-LATENCY] prompt.ensure_runtime_ready", {
			sessionId: this.sessionId,
			shortId: this.shortId,
			durationMs: Date.now() - ensureStartMs,
		});

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
		console.log("[P-LATENCY] prompt.send_prompt_async", {
			sessionId: this.sessionId,
			shortId: this.shortId,
			durationMs: Date.now() - sendStartMs,
			contentLength: content.length,
			imageCount: options?.images?.length || 0,
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
	// Private: SSE Event Handling
	// ============================================

	private handleOpenCodeEvent(event: OpenCodeEvent): void {
		this.eventProcessor.process(event);
	}

	private handleSseDisconnect(reason: string): void {
		this.log("SSE disconnected", { reason });

		// Only reconnect if we still have clients
		if (this.clients.size === 0) {
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
			if (this.clients.size === 0) {
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

	private async handleInterceptedTool(
		toolName: string,
		args: Record<string, unknown>,
		partId: string,
		messageId: string,
		toolCallId: string,
	): Promise<void> {
		const handler = getInterceptedToolHandler(toolName);
		if (!handler) {
			return;
		}

		try {
			const result = await handler.execute(this, args);

			// Update OpenCode with the result
			const openCodeUrl = this.runtime.getOpenCodeUrl();
			const openCodeSessionId = this.runtime.getOpenCodeSessionId();
			if (openCodeUrl && openCodeSessionId) {
				await updateToolResult(openCodeUrl, openCodeSessionId, messageId, partId, result.result);
			}

			this.eventProcessor.markToolEventSent(partId, "end");
			const endPayload: ToolEndMessage = {
				type: "tool_end",
				payload: {
					partId,
					toolCallId,
					tool: toolName,
					result: result.result,
					durationMs: 0,
				},
			};
			this.broadcast(endPayload);
			this.eventProcessor.setToolStatus(toolCallId, result.success ? "completed" : "error");
		} catch (err) {
			this.eventProcessor.markToolEventSent(partId, "end");
			const endPayload: ToolEndMessage = {
				type: "tool_end",
				payload: {
					partId,
					toolCallId,
					tool: toolName,
					result: `Tool failed: ${err instanceof Error ? err.message : "Unknown error"}`,
					durationMs: 0,
				},
			};
			this.broadcast(endPayload);
			this.eventProcessor.setToolStatus(toolCallId, "error");
		}
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
