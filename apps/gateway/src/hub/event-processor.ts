/**
 * Event Processor
 *
 * Transforms OpenCode SSE events into ServerMessages for clients.
 * All tool execution is handled via HTTP callbacks (POST /tools/:toolName),
 * so the EventProcessor is a pure pass-through for SSE events.
 */

import type { Logger } from "@proliferate/logger";
import type {
	Message,
	ServerMessage,
	ToolEndMessage,
	ToolMetadataMessage,
	ToolStartMessage,
} from "@proliferate/shared";
import type {
	MessageUpdateProperties,
	OpenCodeEvent,
	PartUpdateProperties,
	SessionErrorProperties,
	SessionStatusProperties,
	ToolState,
} from "../types";

export interface EventProcessorCallbacks {
	/**
	 * Broadcast a message to all connected clients
	 */
	broadcast: (msg: ServerMessage) => void;

	/**
	 * Get the current OpenCode session ID
	 */
	getOpenCodeSessionId: () => string | null;

	// Phase 2a: telemetry hooks (optional for backwards compatibility)
	onToolStart?: (toolCallId: string) => void;
	onMessageComplete?: () => void;
	onTextPartComplete?: (text: string) => void;
	onToolMetadata?: (title: string | undefined) => void;
}

export class EventProcessor {
	private static readonly toolProgressHeartbeatMs = 15_000;
	private currentAssistantMessageId: string | null = null;
	private currentOpenCodeUserMessageId: string | null = null;
	private readonly toolStates = new Map<string, ToolState>();
	private readonly runningToolWatch = new Map<
		string,
		{
			toolName: string;
			startedAt: number;
			lastUpdateAt: number;
			lastStatusBroadcastAt: number;
		}
	>();
	private readonly sentToolEvents = new Set<string>();
	private readonly logger: Logger;

	constructor(
		private readonly callbacks: EventProcessorCallbacks,
		logger: Logger,
	) {
		this.logger = logger.child({ module: "event-processor" });
	}

	/**
	 * Process an OpenCode SSE event
	 */
	process(event: OpenCodeEvent): void {
		try {
			this.maybeBroadcastToolProgressHeartbeat(event.type);
			switch (event.type) {
				case "server.connected":
				case "server.heartbeat":
					return;
				case "message.updated":
					this.handleMessageUpdate(event.properties);
					return;
				case "message.part.updated":
					this.handlePartUpdate(event.properties);
					return;
				case "session.idle":
					this.handleSessionIdle();
					return;
				case "session.status":
					this.handleSessionStatus(event.properties);
					return;
				case "session.error":
					this.handleSessionError(event.properties);
					return;
				default:
					// Unknown event type - ignore
					return;
			}
		} catch (err) {
			this.logger.error({ err, eventType: event.type }, "Error processing event");
		}
	}

	private handleMessageUpdate(properties: MessageUpdateProperties): void {
		const info = properties?.info;
		if (!info) {
			return;
		}

		const messageId = typeof info.id === "string" ? info.id : null;
		const role = typeof info.role === "string" ? info.role : null;
		if (!messageId || !role) {
			return;
		}

		const openCodeSessionId = this.callbacks.getOpenCodeSessionId();
		const sessionId =
			typeof info.sessionID === "string"
				? info.sessionID
				: typeof info.sessionId === "string"
					? info.sessionId
					: null;
		if (openCodeSessionId && sessionId && sessionId !== openCodeSessionId) {
			this.logger.debug(
				{ messageId, role, sessionId, openCodeSessionId },
				"Dropping message update from different OpenCode session",
			);
			return;
		}

		// Track the user message ID so we can ignore its parts.
		if (role === "user") {
			if (this.currentOpenCodeUserMessageId === null) {
				this.currentOpenCodeUserMessageId = messageId;
			}
			return;
		}

		if (role !== "assistant") {
			return;
		}

		this.logger.debug(
			{
				messageId,
				role,
				sessionId,
				hasError: Boolean(info.error),
				completedAt: info.time?.completed ?? null,
			},
			"Processing assistant message update",
		);

		// If OpenCode creates an assistant message but fails before emitting any parts, we still want
		// clients to see the assistant "start" (and any error attached to the message).
		if (!this.currentAssistantMessageId) {
			this.currentAssistantMessageId = messageId;
			const assistantMessage: Message = {
				id: messageId,
				role: "assistant",
				content: "",
				isComplete: false,
				createdAt: Date.now(),
			};
			this.callbacks.broadcast({ type: "message", payload: assistantMessage });
		}

		if (this.currentAssistantMessageId !== messageId) {
			return;
		}

		const errorMessage = getOpenCodeErrorMessage(info.error);
		if (errorMessage) {
			if (isAbortLikeOpenCodeError(info.error)) {
				this.logger.debug(
					{ messageId, errorMessage, openCodeSessionId: sessionId ?? null },
					"Ignoring expected abort error on assistant message update",
				);
			} else {
				this.logger.debug(
					{ messageId, errorMessage, openCodeSessionId: sessionId ?? null },
					"Assistant message update includes error",
				);
				this.callbacks.broadcast({ type: "error", payload: { message: errorMessage } });
			}
		}

		const completed = info.time?.completed;
		if (completed) {
			this.completeCurrentMessage();
		}
	}

	/**
	 * Reset state for a new prompt
	 */
	resetForNewPrompt(): void {
		this.currentAssistantMessageId = null;
		this.currentOpenCodeUserMessageId = null;
		this.toolStates.clear();
		this.runningToolWatch.clear();
		this.sentToolEvents.clear();
	}

	/**
	 * Get the current assistant message ID
	 */
	getCurrentAssistantMessageId(): string | null {
		return this.currentAssistantMessageId;
	}

	/**
	 * Clear the current assistant message ID (e.g., on cancel)
	 */
	clearCurrentAssistantMessageId(): void {
		this.currentAssistantMessageId = null;
		this.toolStates.clear();
		this.runningToolWatch.clear();
		this.sentToolEvents.clear();
	}

	/**
	 * Check if any tools are still running
	 */
	hasRunningTools(): boolean {
		return Array.from(this.toolStates.values()).some((state) => state.status === "running");
	}

	private handlePartUpdate(props: PartUpdateProperties): void {
		const { part, delta } = props;

		// Validate required fields exist
		if (!part || !part.id || !part.messageID || !part.type) {
			this.logger.warn(
				{
					hasPart: !!part,
					hasId: !!part?.id,
					hasMessageID: !!part?.messageID,
					hasType: !!part?.type,
				},
				"Invalid part update - missing required fields",
			);
			return;
		}

		const openCodeSessionId = this.callbacks.getOpenCodeSessionId();

		// Filter to current session
		if (openCodeSessionId && part.sessionID !== openCodeSessionId) {
			this.logger.debug(
				{
					partId: part.id,
					partType: part.type,
					partSessionId: part.sessionID,
					openCodeSessionId,
				},
				"Dropping part update from different OpenCode session",
			);
			return;
		}

		if (part.type === "text") {
			this.handleTextPart(part, delta);
		} else if (part.callID && part.tool) {
			this.logger.debug(
				{
					partId: part.id,
					messageId: part.messageID,
					sessionId: part.sessionID,
					toolCallId: part.callID,
					toolName: part.tool,
					toolStatus: part.state?.status ?? null,
					hasInput: Boolean(part.state?.input),
					hasOutput: Boolean(part.state?.output),
					hasError: Boolean(part.state?.error),
				},
				"Processing tool part update",
			);
			this.handleToolPart(part, part.callID, part.tool);
		} else {
			this.logger.debug(
				{
					partId: part.id,
					partType: part.type,
					hasCallId: Boolean(part.callID),
					hasTool: Boolean(part.tool),
				},
				"Ignoring non-text/non-tool part update",
			);
		}
	}

	private handleTextPart(part: PartUpdateProperties["part"], delta: string | undefined): void {
		// First text part after sending prompt is the user message - track its ID to skip
		if (this.currentOpenCodeUserMessageId === null) {
			this.currentOpenCodeUserMessageId = part.messageID;
		}

		// Skip user message parts - only emit events for assistant messages
		if (part.messageID === this.currentOpenCodeUserMessageId) {
			return;
		}

		// First assistant text part - create assistant message with OpenCode's ID
		if (!this.currentAssistantMessageId) {
			this.currentAssistantMessageId = part.messageID;
			const assistantMessage: Message = {
				id: part.messageID,
				role: "assistant",
				content: "",
				isComplete: false,
				createdAt: Date.now(),
			};
			this.callbacks.broadcast({ type: "message", payload: assistantMessage });
		}

		if (delta) {
			// Streaming token
			this.callbacks.broadcast({
				type: "token",
				payload: {
					messageId: this.currentAssistantMessageId,
					partId: part.id,
					token: delta,
				},
			});
		} else if (!delta && part.text) {
			// Text part complete
			this.callbacks.broadcast({
				type: "text_part_complete",
				payload: {
					messageId: this.currentAssistantMessageId,
					partId: part.id,
					text: part.text,
				},
			});
			this.callbacks.onTextPartComplete?.(part.text);
		}
	}

	private handleToolPart(
		part: PartUpdateProperties["part"],
		toolCallId: string,
		toolName: string,
	): void {
		// Ensure assistant message exists
		if (!this.currentAssistantMessageId) {
			this.currentAssistantMessageId = part.messageID;
			const assistantMessage: Message = {
				id: part.messageID,
				role: "assistant",
				content: "",
				isComplete: false,
				createdAt: Date.now(),
			};
			this.callbacks.broadcast({ type: "message", payload: assistantMessage });
		}

		const args = part.state?.input || {};
		const status = part.state?.status;
		const hasArgs = Object.keys(args).length > 0;
		const now = Date.now();

		const startKey = `${part.id}:start`;
		const argsKey = `${part.id}:args`;
		const endKey = `${part.id}:end`;

		// Emit tool_start on first sighting
		if (!this.sentToolEvents.has(startKey)) {
			this.sentToolEvents.add(startKey);
			if (hasArgs) {
				this.sentToolEvents.add(argsKey);
			}
			const payload: ToolStartMessage = {
				type: "tool_start",
				payload: {
					messageId: this.currentAssistantMessageId || undefined,
					partId: part.id,
					toolCallId,
					tool: toolName,
					args,
				},
			};
			this.callbacks.broadcast(payload);
			this.logger.debug(
				{
					partId: part.id,
					toolCallId,
					toolName,
					messageId: this.currentAssistantMessageId,
					hasArgs,
				},
				"Emitted tool_start",
			);
			this.callbacks.onToolStart?.(toolCallId);
			this.toolStates.set(toolCallId, {
				startEmitted: true,
				argsEmitted: hasArgs,
				endEmitted: false,
				status: "running",
			});
			this.runningToolWatch.set(toolCallId, {
				toolName,
				startedAt: now,
				lastUpdateAt: now,
				lastStatusBroadcastAt: 0,
			});
		} else if (hasArgs && !this.sentToolEvents.has(argsKey)) {
			this.sentToolEvents.add(argsKey);
			const payload: ToolStartMessage = {
				type: "tool_start",
				payload: {
					messageId: this.currentAssistantMessageId || undefined,
					partId: part.id,
					toolCallId,
					tool: toolName,
					args,
				},
			};
			this.callbacks.broadcast(payload);
			this.logger.debug(
				{
					partId: part.id,
					toolCallId,
					toolName,
					messageId: this.currentAssistantMessageId,
				},
				"Emitted tool_start (args update)",
			);
			const watch = this.runningToolWatch.get(toolCallId);
			if (watch) {
				watch.lastUpdateAt = now;
				watch.toolName = toolName;
			}
		}

		// Handle metadata (e.g., task summaries)
		const metadata = part.state?.metadata;
		if (metadata?.summary) {
			const summaryStateCounts = metadata.summary.reduce<Record<string, number>>((acc, item) => {
				const key = item.state.status || "unknown";
				acc[key] = (acc[key] ?? 0) + 1;
				return acc;
			}, {});
			const summarySignature = metadata.summary
				.map((item) => `${item.id}:${item.tool}:${item.state.status}:${item.state.title ?? ""}`)
				.join("|");
			const summaryTitle = part.state?.title ?? "";
			const summaryKey = `${part.id}:summary:${summaryTitle}:${summarySignature}`;
			if (!this.sentToolEvents.has(summaryKey)) {
				this.sentToolEvents.add(summaryKey);
				const payload: ToolMetadataMessage = {
					type: "tool_metadata",
					payload: {
						toolCallId,
						tool: toolName,
						title: part.state?.title,
						metadata,
					},
				};
				this.callbacks.broadcast(payload);
				this.logger.debug(
					{
						partId: part.id,
						toolCallId,
						toolName,
						summaryLength: metadata.summary.length,
					},
					"Emitted tool_metadata",
				);
				this.logger.info(
					{
						partId: part.id,
						messageId: this.currentAssistantMessageId,
						toolCallId,
						toolName,
						title: part.state?.title,
						summaryLength: metadata.summary.length,
						summaryStateCounts,
					},
					"Forwarded tool metadata update",
				);
				this.callbacks.onToolMetadata?.(part.state?.title);
				const watch = this.runningToolWatch.get(toolCallId);
				if (watch) {
					watch.lastUpdateAt = now;
					watch.toolName = toolName;
				}
			} else {
				this.logger.debug(
					{
						partId: part.id,
						toolCallId,
						toolName,
						summaryLength: metadata.summary.length,
						summaryStateCounts,
						summarySignatureLength: summarySignature.length,
						title: summaryTitle || null,
					},
					"Skipped duplicate tool_metadata event",
				);
			}
		}

		// Handle completion
		if (status === "completed" || status === "error") {
			if (!this.sentToolEvents.has(endKey)) {
				this.sentToolEvents.add(endKey);
				const result = part.state?.output || part.state?.error || " ";
				const payload: ToolEndMessage = {
					type: "tool_end",
					payload: {
						partId: part.id,
						toolCallId,
						tool: toolName,
						result,
						durationMs: 0,
					},
				};
				this.callbacks.broadcast(payload);
				this.logger.debug(
					{
						partId: part.id,
						toolCallId,
						toolName,
						status,
					},
					"Emitted tool_end",
				);
				const state = this.toolStates.get(toolCallId);
				if (state) {
					state.status = status === "completed" ? "completed" : "error";
					state.endEmitted = true;
				}
				this.runningToolWatch.delete(toolCallId);
			}
		}
	}

	private handleSessionIdle(): void {
		this.completeCurrentMessage();
	}

	private handleSessionStatus(properties: SessionStatusProperties): void {
		if (!properties) {
			return;
		}
		if (properties.status?.type === "idle") {
			this.completeCurrentMessage();
		}
	}

	private completeCurrentMessage(): void {
		if (!this.currentAssistantMessageId) {
			return;
		}

		if (this.hasRunningTools()) {
			return;
		}

		const hadTools = this.toolStates.size > 0;

		this.callbacks.onMessageComplete?.();
		this.callbacks.broadcast({
			type: "message_complete",
			payload: { messageId: this.currentAssistantMessageId },
		});
		this.logger.debug(
			{
				messageId: this.currentAssistantMessageId,
				hadTools,
				toolStateCount: this.toolStates.size,
			},
			"Emitted message_complete",
		);

		if (hadTools) {
			// Agentic loop: clear state so the next assistant message can be created
			// after tool results are processed by OpenCode.
			this.currentAssistantMessageId = null;
		}
		// Text-only responses: keep currentAssistantMessageId set to prevent
		// duplicate messages from OpenCode. resetForNewPrompt() clears it
		// when the next user prompt arrives.

		this.toolStates.clear();
		this.runningToolWatch.clear();
		this.sentToolEvents.clear();
	}

	private handleSessionError(properties: SessionErrorProperties): void {
		if (!properties) {
			return;
		}
		const { error } = properties;

		if (isAbortLikeOpenCodeError(error)) {
			this.logger.debug(
				{
					errorName: error?.name ?? null,
					errorMessage: error?.data?.message ?? null,
				},
				"Ignoring expected abort error on session.error",
			);
			return;
		}

		const errorMessage = error?.data?.message || error?.name || "Unknown error";
		this.callbacks.broadcast({ type: "error", payload: { message: errorMessage } });
	}

	private maybeBroadcastToolProgressHeartbeat(sourceEventType: OpenCodeEvent["type"]): void {
		if (this.runningToolWatch.size === 0) {
			return;
		}

		const now = Date.now();
		for (const [toolCallId, watch] of this.runningToolWatch) {
			const quietForMs = now - watch.lastUpdateAt;
			const sinceLastHeartbeatMs = now - watch.lastStatusBroadcastAt;

			if (quietForMs < EventProcessor.toolProgressHeartbeatMs) {
				continue;
			}
			if (sinceLastHeartbeatMs < EventProcessor.toolProgressHeartbeatMs) {
				continue;
			}

			const elapsedSeconds = Math.max(1, Math.floor((now - watch.startedAt) / 1000));
			const quietSeconds = Math.max(1, Math.floor(quietForMs / 1000));
			const message = `Working on ${watch.toolName} (${elapsedSeconds}s elapsed, no update for ${quietSeconds}s)`;

			this.callbacks.broadcast({
				type: "status",
				payload: {
					status: "running",
					message,
				},
			});
			this.logger.debug(
				{
					toolCallId,
					toolName: watch.toolName,
					elapsedSeconds,
					quietSeconds,
					sourceEventType,
				},
				"Broadcasted tool progress heartbeat",
			);
			watch.lastStatusBroadcastAt = now;
		}
	}
}

function getOpenCodeErrorMessage(error: unknown): string | null {
	if (!error) {
		return null;
	}
	if (typeof error === "string") {
		return error;
	}
	if (typeof error !== "object") {
		return String(error);
	}

	const err = error as {
		name?: unknown;
		message?: unknown;
		data?: { message?: unknown } | null;
	};
	if (typeof err.data?.message === "string" && err.data.message) {
		return err.data.message;
	}
	if (typeof err.message === "string" && err.message) {
		return err.message;
	}
	if (typeof err.name === "string" && err.name) {
		return err.name;
	}
	return null;
}

function isAbortLikeOpenCodeError(error: unknown): boolean {
	if (!error) {
		return false;
	}

	const details =
		typeof error === "string"
			? { name: null, message: error, dataMessage: null }
			: typeof error === "object"
				? {
						name:
							typeof (error as { name?: unknown }).name === "string"
								? ((error as { name?: unknown }).name as string)
								: null,
						message:
							typeof (error as { message?: unknown }).message === "string"
								? ((error as { message?: unknown }).message as string)
								: null,
						dataMessage:
							typeof (error as { data?: { message?: unknown } | null }).data?.message === "string"
								? ((error as { data?: { message?: unknown } | null }).data?.message as string)
								: null,
					}
				: { name: null, message: String(error), dataMessage: null };

	const normalizedName = details.name?.toLowerCase();
	if (normalizedName === "messageabortederror" || normalizedName === "aborterror") {
		return true;
	}

	const messages = [details.message, details.dataMessage]
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.toLowerCase());

	return messages.some(
		(message) =>
			message.includes("operation was aborted") ||
			message.includes("signal is aborted") ||
			message === "aborterror",
	);
}
