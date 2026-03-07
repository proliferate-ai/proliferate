/**
 * Maps Sandbox Agent UniversalEvent → RuntimeDaemonEvent.
 *
 * Sandbox Agent emits a normalized UniversalEvent schema for all agents.
 * The gateway's EventProcessor expects RuntimeDaemonEvent with OpenCode-style
 * event types (message.updated, message.part.updated, session.idle, etc.).
 * This mapper bridges the two schemas.
 */

import type { RuntimeDaemonEvent } from "@proliferate/shared/contracts/harness";

// ---------------------------------------------------------------------------
// Sandbox Agent UniversalEvent types (from universal_events.rs)
// ---------------------------------------------------------------------------

export type UniversalEventType =
	| "session.started"
	| "session.ended"
	| "turn.started"
	| "turn.ended"
	| "item.started"
	| "item.delta"
	| "item.completed"
	| "error"
	| "permission.requested"
	| "permission.resolved"
	| "question.requested"
	| "question.resolved"
	| "agent.unparsed";

export type UniversalEventSource = "agent" | "daemon";

export type UniversalItemKind = "message" | "tool_call" | "tool_result";

export interface UniversalContentPart {
	type: "text" | "tool_call" | "tool_result" | "image" | "file";
	text?: string;
	toolCallId?: string;
	toolName?: string;
	args?: Record<string, unknown>;
	result?: string;
	status?: string;
	url?: string;
	mime?: string;
}

export interface UniversalEventData {
	/** For item events: the kind of item */
	kind?: UniversalItemKind;
	/** For item events: unique item ID */
	itemId?: string;
	/** For item events: parent item ID */
	parentItemId?: string;
	/** For item.delta: the delta content */
	delta?: UniversalContentPart;
	/** For item.started/completed: full content parts */
	content?: UniversalContentPart[];
	/** For item.completed: item status */
	status?: "completed" | "failed" | "cancelled";
	/** For error events */
	message?: string;
	code?: string;
	/** For turn events: role */
	role?: "user" | "assistant";
}

export interface UniversalEvent {
	event_id: string;
	sequence: number;
	time: string;
	session_id: string;
	native_session_id?: string;
	synthetic: boolean;
	source: UniversalEventSource;
	event_type: UniversalEventType;
	data: UniversalEventData;
	raw?: unknown;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function mapUniversalEventToRuntimeDaemonEvent(
	event: UniversalEvent,
	bindingId: string,
): RuntimeDaemonEvent | null {
	const base = {
		source: "daemon" as const,
		bindingId,
		sourceSeq: event.sequence,
		sourceEventKey: `${bindingId}:${event.sequence}`,
		occurredAt: event.time,
	};

	switch (event.event_type) {
		case "session.started":
			return {
				...base,
				channel: "server",
				type: "server.connected",
				isTerminal: false,
				payload: { sessionId: event.session_id },
			};

		case "session.ended":
			return {
				...base,
				channel: "session",
				type: "session.idle",
				isTerminal: true,
				payload: { sessionId: event.session_id },
			};

		case "turn.started":
			return {
				...base,
				channel: "session",
				type: "session.status",
				isTerminal: false,
				payload: { status: "busy", role: event.data.role },
			};

		case "turn.ended":
			return {
				...base,
				channel: "session",
				type: "session.idle",
				isTerminal: true,
				payload: { status: "idle" },
			};

		case "item.started": {
			const kind = event.data.kind ?? "message";
			if (kind === "message") {
				return {
					...base,
					channel: "message",
					type: "message.updated",
					isTerminal: false,
					itemId: event.data.itemId,
					payload: {
						id: event.data.itemId,
						role: event.data.role ?? "assistant",
						parts: mapContentParts(event.data.content),
					},
				};
			}
			// tool_call and tool_result come as message part updates
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				isTerminal: false,
				itemId: event.data.itemId,
				parentItemId: event.data.parentItemId,
				toolCallId: extractToolCallId(event.data.content),
				payload: {
					id: event.data.itemId,
					kind,
					parts: mapContentParts(event.data.content),
				},
			};
		}

		case "item.delta": {
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				isTerminal: false,
				itemId: event.data.itemId,
				toolCallId: event.data.delta?.toolCallId,
				payload: {
					id: event.data.itemId,
					delta: event.data.delta
						? mapContentPart(event.data.delta)
						: undefined,
				},
			};
		}

		case "item.completed": {
			return {
				...base,
				channel: "message",
				type: "message.updated",
				isTerminal: false,
				itemId: event.data.itemId,
				parentItemId: event.data.parentItemId,
				toolCallId: extractToolCallId(event.data.content),
				payload: {
					id: event.data.itemId,
					status: event.data.status ?? "completed",
					parts: mapContentParts(event.data.content),
				},
			};
		}

		case "error":
			return {
				...base,
				channel: "session",
				type: "session.error",
				isTerminal: true,
				payload: {
					message: event.data.message ?? "Unknown error",
					code: event.data.code,
				},
			};

		case "permission.requested":
			return {
				...base,
				channel: "session",
				type: "session.status",
				isTerminal: false,
				approvalId: event.data.itemId,
				payload: {
					status: "paused_for_approval",
					kind: "permission",
					itemId: event.data.itemId,
				},
			};

		case "permission.resolved":
			return {
				...base,
				channel: "session",
				type: "session.status",
				isTerminal: false,
				approvalId: event.data.itemId,
				payload: {
					status: "busy",
					kind: "permission_resolved",
					itemId: event.data.itemId,
				},
			};

		// Unparsed agent events and questions are passed through as-is
		case "agent.unparsed":
		case "question.requested":
		case "question.resolved":
			return {
				...base,
				channel: "session",
				type: event.event_type,
				isTerminal: false,
				payload: event.data,
			};

		default:
			return null;
	}
}

function mapContentParts(parts?: UniversalContentPart[]): unknown[] | undefined {
	if (!parts?.length) return undefined;
	return parts.map(mapContentPart);
}

function mapContentPart(part: UniversalContentPart): unknown {
	switch (part.type) {
		case "text":
			return { type: "text", text: part.text ?? "" };
		case "tool_call":
			return {
				type: "tool",
				toolCallId: part.toolCallId,
				toolName: part.toolName,
				args: part.args ?? {},
				status: part.status ?? "running",
			};
		case "tool_result":
			return {
				type: "tool",
				toolCallId: part.toolCallId,
				toolName: part.toolName,
				result: part.result,
				status: part.status ?? "completed",
			};
		case "image":
			return { type: "image", image: part.url };
		default:
			return part;
	}
}

function extractToolCallId(parts?: UniversalContentPart[]): string | undefined {
	if (!parts) return undefined;
	for (const part of parts) {
		if (part.toolCallId) return part.toolCallId;
	}
	return undefined;
}
