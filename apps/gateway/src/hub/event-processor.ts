/**
 * Event Processor
 *
 * Transforms OpenCode SSE events into ServerMessages for clients.
 * Handles tool interception and state tracking.
 */

import type {
	Message,
	ServerMessage,
	ToolEndMessage,
	ToolMetadataMessage,
	ToolStartMessage,
} from "@proliferate/shared";
import type {
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
	 * Handle an intercepted tool call
	 */
	onInterceptedTool: (
		toolName: string,
		args: Record<string, unknown>,
		partId: string,
		messageId: string,
		toolCallId: string,
	) => void;

	/**
	 * Get the current OpenCode session ID
	 */
	getOpenCodeSessionId: () => string | null;
}

export class EventProcessor {
	private currentAssistantMessageId: string | null = null;
	private currentOpenCodeUserMessageId: string | null = null;
	private readonly toolStates = new Map<string, ToolState>();
	private readonly sentToolEvents = new Set<string>();
	private readonly interceptedTools: Set<string>;

	constructor(
		private readonly callbacks: EventProcessorCallbacks,
		interceptedToolNames: string[],
	) {
		this.interceptedTools = new Set(interceptedToolNames);
	}

	/**
	 * Process an OpenCode SSE event
	 */
	process(event: OpenCodeEvent): void {
		try {
			switch (event.type) {
				case "server.connected":
				case "server.heartbeat":
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
			console.error("[EventProcessor] Error processing event:", event.type, err);
		}
	}

	/**
	 * Reset state for a new prompt
	 */
	resetForNewPrompt(): void {
		this.currentAssistantMessageId = null;
		this.currentOpenCodeUserMessageId = null;
		this.toolStates.clear();
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
		this.sentToolEvents.clear();
	}

	/**
	 * Check if any tools are still running
	 */
	hasRunningTools(): boolean {
		return Array.from(this.toolStates.values()).some((state) => state.status === "running");
	}

	/**
	 * Mark a tool event as sent (used by intercepted tool handlers)
	 */
	markToolEventSent(partId: string, event: "start" | "args" | "end"): void {
		this.sentToolEvents.add(`${partId}:${event}`);
	}

	/**
	 * Update tool status (used by intercepted tool handlers)
	 */
	setToolStatus(toolCallId: string, status: "running" | "completed" | "error"): void {
		const state = this.toolStates.get(toolCallId);
		if (state) {
			state.status = status;
		} else {
			this.toolStates.set(toolCallId, {
				startEmitted: true,
				argsEmitted: false,
				endEmitted: status !== "running",
				status,
			});
		}
	}

	private handlePartUpdate(props: PartUpdateProperties): void {
		const { part, delta } = props;

		// Validate required fields exist
		if (!part || !part.id || !part.messageID || !part.type) {
			console.warn("[EventProcessor] Invalid part update - missing required fields", {
				hasPart: !!part,
				hasId: !!part?.id,
				hasMessageID: !!part?.messageID,
				hasType: !!part?.type,
			});
			return;
		}

		const openCodeSessionId = this.callbacks.getOpenCodeSessionId();

		// Filter to current session
		if (openCodeSessionId && part.sessionID !== openCodeSessionId) {
			return;
		}

		if (part.type === "text") {
			this.handleTextPart(part, delta);
		} else if (part.type === "tool" && part.callID && part.tool) {
			this.handleToolPart(part, part.callID, part.tool);
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

		const startKey = `${part.id}:start`;
		const argsKey = `${part.id}:args`;
		const endKey = `${part.id}:end`;

		// Check if this tool should be intercepted
		if (this.interceptedTools.has(toolName) && !this.sentToolEvents.has(endKey)) {
			if (!this.sentToolEvents.has(startKey)) {
				this.sentToolEvents.add(startKey);

				// Send tool_start
				const startPayload: ToolStartMessage = {
					type: "tool_start",
					payload: {
						messageId: this.currentAssistantMessageId || undefined,
						partId: part.id,
						toolCallId,
						tool: toolName,
						args,
					},
				};
				this.callbacks.broadcast(startPayload);
				this.toolStates.set(toolCallId, {
					startEmitted: true,
					argsEmitted: hasArgs,
					endEmitted: false,
					status: "running",
				});

				// Delegate to intercepted tool handler
				this.callbacks.onInterceptedTool(toolName, args, part.id, part.messageID, toolCallId);
			}
			return;
		}

		// Normal tool processing
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
			this.toolStates.set(toolCallId, {
				startEmitted: true,
				argsEmitted: hasArgs,
				endEmitted: false,
				status: "running",
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
		}

		// Handle metadata (e.g., task summaries)
		const metadata = part.state?.metadata;
		if (metadata?.summary) {
			const summaryKey = `${part.id}:summary:${metadata.summary.length}`;
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
				const state = this.toolStates.get(toolCallId);
				if (state) {
					state.status = status === "completed" ? "completed" : "error";
					state.endEmitted = true;
				}
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

		this.callbacks.broadcast({
			type: "message_complete",
			payload: { messageId: this.currentAssistantMessageId },
		});
		this.currentAssistantMessageId = null;
		this.toolStates.clear();
		this.sentToolEvents.clear();
	}

	private handleSessionError(properties: SessionErrorProperties): void {
		if (!properties) {
			return;
		}
		const { error } = properties;

		// Skip MessageAbortedError - expected when user cancels
		if (error?.name === "MessageAbortedError") {
			return;
		}

		const errorMessage = error?.data?.message || error?.name || "Unknown error";
		this.callbacks.broadcast({ type: "error", payload: { message: errorMessage } });
	}
}
