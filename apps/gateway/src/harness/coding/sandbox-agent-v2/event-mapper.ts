import type { RuntimeDaemonEvent } from "@proliferate/shared/contracts/harness";

// ---------------------------------------------------------------------------
// UniversalEvent types (mirrors sandbox-agent Rust structs)
// ---------------------------------------------------------------------------

export type UniversalEventSource = "agent" | "user" | "system";

export type UniversalEventType =
	| "session.started"
	| "session.ended"
	| "turn.started"
	| "turn.ended"
	| "item.started"
	| "item.delta"
	| "item.completed"
	| "error";

export type ContentPartType = "text" | "toolCall" | "toolResult";

export interface TextContentPart {
	type: "text";
	text: string;
}

export interface ToolCallContentPart {
	type: "toolCall";
	name: string;
	arguments: string;
	call_id: string;
}

export interface ToolResultContentPart {
	type: "toolResult";
	call_id: string;
	output: string;
}

export type ContentPart = TextContentPart | ToolCallContentPart | ToolResultContentPart;

export type ItemKind = "message" | "toolCall" | "toolResult" | "status";
export type ItemStatus = "inProgress" | "completed" | "failed";

export interface UniversalItem {
	id: string;
	kind: ItemKind;
	role?: "user" | "assistant" | "tool";
	status: ItemStatus;
	content: ContentPart[];
}

export interface SessionStartedData {
	metadata: Record<string, unknown>;
}

export interface SessionEndedData {
	reason: string;
	terminated_by?: string;
}

export interface TurnStartedData {
	phase: "started";
	turn_id?: string;
}

export interface TurnEndedData {
	phase: "ended";
}

export interface ItemStartedData {
	item: UniversalItem;
}

export interface ItemDeltaData {
	item_id: string;
	delta: string;
}

export interface ItemCompletedData {
	item: UniversalItem;
}

export interface ErrorData {
	message: string;
	code?: string;
	details?: Record<string, unknown>;
}

export interface UniversalEvent {
	event_id: string;
	sequence: number;
	time: string;
	session_id: string;
	native_session_id?: string | null;
	synthetic: boolean;
	source: UniversalEventSource;
	type: UniversalEventType;
	data: unknown;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function buildToolUsePartFromContentPart(
	cp: ToolCallContentPart,
	itemId: string,
): Record<string, unknown> {
	return {
		id: itemId,
		sessionID: "",
		messageID: "",
		type: "tool",
		callID: cp.call_id,
		tool: cp.name,
		state: {
			status: "running",
			input: safeParseJson(cp.arguments),
		},
	};
}

function buildToolResultPartFromContentPart(
	cp: ToolResultContentPart,
	itemId: string,
): Record<string, unknown> {
	return {
		id: itemId,
		sessionID: "",
		messageID: "",
		type: "tool",
		callID: cp.call_id,
		tool: "",
		state: {
			status: "completed",
			output: cp.output,
		},
	};
}

function safeParseJson(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return { value: parsed };
	} catch {
		return { value };
	}
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Map a sandbox-agent UniversalEvent to a RuntimeDaemonEvent that the
 * gateway EventProcessor can consume.
 *
 * Returns null for events that have no meaningful mapping.
 */
export function mapUniversalEvent(
	event: UniversalEvent,
	bindingId: string,
): RuntimeDaemonEvent | null {
	const base = {
		source: "daemon" as const,
		bindingId,
		sourceSeq: event.sequence,
		sourceEventKey: `${bindingId}:${event.sequence}`,
		occurredAt: event.time,
		isTerminal: false,
	};

	switch (event.type) {
		case "session.started": {
			return {
				...base,
				channel: "server",
				type: "server.connected",
				payload: {
					type: "server.connected",
					properties: {},
				},
			};
		}

		case "session.ended": {
			return {
				...base,
				channel: "session",
				type: "session.idle",
				isTerminal: true,
				payload: {
					type: "session.idle",
					properties: {},
				},
			};
		}

		case "turn.started": {
			return {
				...base,
				channel: "session",
				type: "session.status",
				payload: {
					type: "session.status",
					properties: {
						status: { type: "busy" },
					},
				},
			};
		}

		case "turn.ended": {
			return {
				...base,
				channel: "session",
				type: "session.idle",
				payload: {
					type: "session.idle",
					properties: {},
				},
			};
		}

		case "item.started": {
			const data = event.data as ItemStartedData;
			if (!data?.item) {
				return null;
			}
			return mapItemStarted(data.item, event, base);
		}

		case "item.delta": {
			const data = event.data as ItemDeltaData;
			if (!data?.item_id || typeof data.delta !== "string") {
				return null;
			}
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: data.item_id,
				payload: {
					type: "message.part.updated",
					properties: {
						part: {
							id: data.item_id,
							sessionID: event.session_id,
							messageID: data.item_id,
							type: "text",
						},
						delta: data.delta,
					},
				},
			};
		}

		case "item.completed": {
			const data = event.data as ItemCompletedData;
			if (!data?.item) {
				return null;
			}
			return mapItemCompleted(data.item, event, base);
		}

		case "error": {
			const data = event.data as ErrorData;
			return {
				...base,
				channel: "session",
				type: "session.error",
				isTerminal: true,
				payload: {
					type: "session.error",
					properties: {
						error: {
							name: data?.code ?? "UniversalEventError",
							data: {
								message: data?.message ?? "Unknown error",
							},
						},
					},
				},
			};
		}

		default:
			return null;
	}
}

function mapItemStarted(
	item: UniversalItem,
	event: UniversalEvent,
	base: Omit<RuntimeDaemonEvent, "channel" | "type" | "payload">,
): RuntimeDaemonEvent | null {
	switch (item.kind) {
		case "message": {
			if (item.role === "assistant") {
				// Emit a message.updated to create the assistant message
				return {
					...base,
					channel: "message",
					type: "message.updated",
					itemId: item.id,
					payload: {
						type: "message.updated",
						properties: {
							info: {
								id: item.id,
								sessionID: event.session_id,
								role: "assistant",
								time: {},
							},
						},
					},
				};
			}
			if (item.role === "user") {
				return {
					...base,
					channel: "message",
					type: "message.updated",
					itemId: item.id,
					payload: {
						type: "message.updated",
						properties: {
							info: {
								id: item.id,
								sessionID: event.session_id,
								role: "user",
								time: {},
							},
						},
					},
				};
			}
			return null;
		}

		case "toolCall": {
			const toolCallPart = item.content.find(
				(cp): cp is ToolCallContentPart => cp.type === "toolCall",
			);
			if (!toolCallPart) {
				return null;
			}
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: item.id,
				toolCallId: toolCallPart.call_id,
				payload: {
					type: "message.part.updated",
					properties: {
						part: buildToolUsePartFromContentPart(toolCallPart, item.id),
					},
				},
			};
		}

		case "toolResult": {
			const toolResultPart = item.content.find(
				(cp): cp is ToolResultContentPart => cp.type === "toolResult",
			);
			if (!toolResultPart) {
				return null;
			}
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: item.id,
				toolCallId: toolResultPart.call_id,
				payload: {
					type: "message.part.updated",
					properties: {
						part: buildToolResultPartFromContentPart(toolResultPart, item.id),
					},
				},
			};
		}

		default:
			return null;
	}
}

function mapItemCompleted(
	item: UniversalItem,
	event: UniversalEvent,
	base: Omit<RuntimeDaemonEvent, "channel" | "type" | "payload">,
): RuntimeDaemonEvent | null {
	switch (item.kind) {
		case "message": {
			if (item.role !== "assistant") {
				return null;
			}
			return {
				...base,
				channel: "message",
				type: "message.updated",
				itemId: item.id,
				payload: {
					type: "message.updated",
					properties: {
						info: {
							id: item.id,
							sessionID: event.session_id,
							role: "assistant",
							time: { completed: Date.now() },
							...(item.status === "failed" ? { error: { name: "ItemFailed" } } : {}),
						},
					},
				},
			};
		}

		case "toolCall": {
			const toolCallPart = item.content.find(
				(cp): cp is ToolCallContentPart => cp.type === "toolCall",
			);
			if (!toolCallPart) {
				return null;
			}
			const completedStatus = item.status === "failed" ? "error" : "completed";
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: item.id,
				toolCallId: toolCallPart.call_id,
				payload: {
					type: "message.part.updated",
					properties: {
						part: {
							id: item.id,
							sessionID: event.session_id,
							messageID: "",
							type: "tool",
							callID: toolCallPart.call_id,
							tool: toolCallPart.name,
							state: {
								status: completedStatus,
								input: safeParseJson(toolCallPart.arguments),
							},
						},
					},
				},
			};
		}

		case "toolResult": {
			const toolResultPart = item.content.find(
				(cp): cp is ToolResultContentPart => cp.type === "toolResult",
			);
			if (!toolResultPart) {
				return null;
			}
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: item.id,
				toolCallId: toolResultPart.call_id,
				payload: {
					type: "message.part.updated",
					properties: {
						part: {
							id: item.id,
							sessionID: event.session_id,
							messageID: "",
							type: "tool",
							callID: toolResultPart.call_id,
							tool: "",
							state: {
								status: "completed",
								output: toolResultPart.output,
							},
						},
					},
				},
			};
		}

		default:
			return null;
	}
}
