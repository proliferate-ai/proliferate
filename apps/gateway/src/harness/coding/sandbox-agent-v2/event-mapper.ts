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

	// Payloads are shaped as OpenCodeEvent `properties` so that
	// handleRuntimeDaemonEvent can bridge them directly into the EventProcessor.
	switch (event.event_type) {
		case "session.started":
			return {
				...base,
				channel: "server",
				type: "server.connected",
				isTerminal: false,
				payload: {},
			};

		case "session.ended":
			return {
				...base,
				channel: "session",
				type: "session.idle",
				isTerminal: true,
				payload: {},
			};

		case "turn.started":
			return {
				...base,
				channel: "session",
				type: "session.status",
				isTerminal: false,
				payload: { status: { type: "busy" } },
			};

		case "turn.ended":
			return {
				...base,
				channel: "session",
				type: "session.idle",
				isTerminal: false,
				payload: {},
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
						info: {
							id: event.data.itemId,
							role: event.data.role ?? "assistant",
							sessionId: event.session_id,
						},
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
				payload: buildPartUpdatePayload(event),
			};
		}

		case "item.delta":
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				isTerminal: false,
				itemId: event.data.itemId,
				toolCallId: event.data.delta?.toolCallId,
				payload: buildDeltaPartPayload(event),
			};

		case "item.completed":
			return {
				...base,
				channel: "message",
				type: "message.updated",
				isTerminal: false,
				itemId: event.data.itemId,
				parentItemId: event.data.parentItemId,
				toolCallId: extractToolCallId(event.data.content),
				payload: {
					info: {
						id: event.data.itemId,
						role: "assistant",
						sessionId: event.session_id,
						time: { completed: Date.now() },
					},
				},
			};

		case "error":
			return {
				...base,
				channel: "session",
				type: "session.error",
				isTerminal: true,
				payload: {
					error: {
						name: event.data.code ?? "agent_error",
						data: { message: event.data.message ?? "Unknown error" },
					},
				},
			};

		case "permission.requested":
			return {
				...base,
				channel: "session",
				type: "session.status",
				isTerminal: false,
				approvalId: event.data.itemId,
				payload: { status: { type: "paused_for_approval" } },
			};

		case "permission.resolved":
			return {
				...base,
				channel: "session",
				type: "session.status",
				isTerminal: false,
				approvalId: event.data.itemId,
				payload: { status: { type: "busy" } },
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

// ---------------------------------------------------------------------------
// Payload builders — produce shapes matching OpenCodeEvent property types
// so the gateway EventProcessor can consume them directly.
// ---------------------------------------------------------------------------

/**
 * Build a PartUpdateProperties-shaped payload for item.started (tool_call/tool_result).
 */
function buildPartUpdatePayload(event: UniversalEvent): unknown {
	const firstPart = event.data.content?.[0];
	const partType = event.data.kind === "tool_call" ? "tool-use" : "tool-result";
	return {
		part: {
			id: event.data.itemId ?? "",
			sessionID: event.session_id,
			messageID: event.data.parentItemId ?? "",
			type: partType,
			callID: firstPart?.toolCallId,
			tool: firstPart?.toolName,
			state: firstPart
				? {
						status: firstPart.status ?? "running",
						input: firstPart.args,
						output: firstPart.result,
					}
				: undefined,
		},
	};
}

/**
 * Build a PartUpdateProperties-shaped payload for item.delta.
 */
function buildDeltaPartPayload(event: UniversalEvent): unknown {
	const delta = event.data.delta;
	if (!delta) {
		return { part: { id: event.data.itemId ?? "", sessionID: event.session_id, messageID: "", type: "text" } };
	}
	if (delta.type === "text") {
		return {
			part: {
				id: event.data.itemId ?? "",
				sessionID: event.session_id,
				messageID: event.data.parentItemId ?? "",
				type: "text",
			},
			delta: delta.text ?? "",
		};
	}
	// Tool delta
	return {
		part: {
			id: event.data.itemId ?? "",
			sessionID: event.session_id,
			messageID: event.data.parentItemId ?? "",
			type: "tool-use",
			callID: delta.toolCallId,
			tool: delta.toolName,
			state: {
				status: delta.status ?? "running",
				input: delta.args,
				output: delta.result,
			},
		},
	};
}

function extractToolCallId(parts?: UniversalContentPart[]): string | undefined {
	if (!parts) return undefined;
	for (const part of parts) {
		if (part.toolCallId) return part.toolCallId;
	}
	return undefined;
}
