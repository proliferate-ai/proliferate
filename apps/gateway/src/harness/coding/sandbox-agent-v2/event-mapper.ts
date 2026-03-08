import type { RuntimeDaemonEvent } from "@proliferate/shared/contracts/harness";

// ---------------------------------------------------------------------------
// ACP JSON-RPC event types (actual format from sandbox-agent SSE)
// ---------------------------------------------------------------------------

export interface AcpJsonRpcEvent {
	jsonrpc: "2.0";
	id?: string | number;
	method?: string;
	params?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: { code: number; message: string; data?: unknown };
}

// Session update types from sandbox-agent's session/update notifications
// OpenCode uses: agent_message_start/chunk/complete, tool_call_start/delta/complete, tool_result, busy, idle
// Pi uses: agent_message_chunk, tool_call, tool_call_update, session_info_update
type SessionUpdateType =
	| "agent_message_chunk"
	| "agent_message_start"
	| "agent_message_complete"
	| "tool_call_start"
	| "tool_call_delta"
	| "tool_call_complete"
	| "tool_result"
	| "tool_call"
	| "tool_call_update"
	| "session_info_update"
	| "usage_update"
	| "available_commands_update"
	| "title_update"
	| "mode_update"
	| "busy"
	| "idle";

interface SessionUpdate {
	sessionId: string;
	update: {
		sessionUpdate: SessionUpdateType;
		content?: { type: string; text: string };
		toolCall?: { id: string; name: string; arguments?: string };
		delta?: string;
		result?: string;
		cost?: { amount: number; currency: string };
		[key: string]: unknown;
	};
}

// ---------------------------------------------------------------------------
// Sequence counter (since JSON-RPC events don't have a sequence field)
// ---------------------------------------------------------------------------

let seqCounter = 0;
function nextSeq(): number {
	return ++seqCounter;
}

// ---------------------------------------------------------------------------
// Track current assistant message ID per binding
// ---------------------------------------------------------------------------

const currentAssistantMessageIds = new Map<string, string>();

/** Track tool names by callId so updates can carry the name. */
const toolNamesByCallId = new Map<string, string>();

/** Get or create an assistant message ID for tool events that need one. */
function ensureAssistantMessage(bindingId: string): string {
	let messageId = currentAssistantMessageIds.get(bindingId);
	if (!messageId) {
		messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		currentAssistantMessageIds.set(bindingId, messageId);
	}
	return messageId;
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Map an ACP JSON-RPC SSE event to one or more RuntimeDaemonEvents.
 * Returns null for events that have no meaningful mapping (init, errors, etc).
 */
export function mapAcpJsonRpcEvent(
	event: AcpJsonRpcEvent,
	bindingId: string,
): RuntimeDaemonEvent | RuntimeDaemonEvent[] | null {
	const seq = nextSeq();
	const base = {
		source: "daemon" as const,
		bindingId,
		sourceSeq: seq,
		sourceEventKey: `${bindingId}:${seq}`,
		occurredAt: new Date().toISOString(),
		isTerminal: false,
	};

	// Handle JSON-RPC errors
	if (event.error) {
		return {
			...base,
			channel: "session",
			type: "session.error",
			isTerminal: false,
			payload: {
				type: "session.error",
				properties: {
					error: {
						name: `JsonRpcError_${event.error.code}`,
						data: {
							message: event.error.message,
						},
					},
				},
			},
		};
	}

	// Handle JSON-RPC responses (to our requests)
	if (event.id !== undefined && event.result) {
		// Response to session/prompt — contains stopReason
		if (event.result.stopReason) {
			currentAssistantMessageIds.delete(bindingId);
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
		// Other responses (initialize, session/new) — ignore
		return null;
	}

	// Handle JSON-RPC notifications (method calls from agent)
	if (!event.method || !event.params) {
		return null;
	}

	// Ignore adapter noise (console.log from agent process)
	if (event.method === "_adapter/invalid_stdout") {
		return null;
	}

	if (event.method === "session/update") {
		return mapSessionUpdate(event.params as unknown as SessionUpdate, bindingId, base);
	}

	return null;
}

function mapSessionUpdate(
	params: SessionUpdate,
	bindingId: string,
	base: Omit<RuntimeDaemonEvent, "channel" | "type" | "payload">,
): RuntimeDaemonEvent | RuntimeDaemonEvent[] | null {
	const update = params.update;
	if (!update?.sessionUpdate) {
		return null;
	}

	switch (update.sessionUpdate) {
		case "agent_message_start": {
			const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			currentAssistantMessageIds.set(bindingId, messageId);
			return {
				...base,
				channel: "message",
				type: "message.updated",
				itemId: messageId,
				payload: {
					type: "message.updated",
					properties: {
						info: {
							id: messageId,
							sessionID: bindingId,
							role: "assistant",
							time: {},
						},
					},
				},
			};
		}

		case "agent_message_chunk": {
			const text = update.content?.text ?? "";
			let messageId = currentAssistantMessageIds.get(bindingId);

			const deltaEvent: RuntimeDaemonEvent = {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: messageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				payload: {
					type: "message.part.updated",
					properties: {
						part: {
							id: messageId ?? "",
							sessionID: bindingId,
							messageID: messageId ?? "",
							type: "text",
						},
						delta: text,
					},
				},
			};

			// Auto-create message if we haven't seen agent_message_start
			if (!messageId) {
				messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				currentAssistantMessageIds.set(bindingId, messageId);
				// Update delta event IDs to use the generated messageId
				deltaEvent.itemId = messageId;
				(
					deltaEvent.payload as { properties: { part: { id: string; messageID: string } } }
				).properties.part.id = messageId;
				(
					deltaEvent.payload as { properties: { part: { id: string; messageID: string } } }
				).properties.part.messageID = messageId;

				const startEvent: RuntimeDaemonEvent = {
					...base,
					sourceEventKey: `${bindingId}:${base.sourceSeq}-start`,
					channel: "message",
					type: "message.updated",
					itemId: messageId,
					payload: {
						type: "message.updated",
						properties: {
							info: {
								id: messageId,
								sessionID: bindingId,
								role: "assistant",
								time: {},
							},
						},
					},
				};
				return [startEvent, deltaEvent];
			}

			return deltaEvent;
		}

		case "agent_message_complete": {
			const messageId = currentAssistantMessageIds.get(bindingId);
			if (!messageId) {
				return null;
			}
			currentAssistantMessageIds.delete(bindingId);
			return {
				...base,
				channel: "message",
				type: "message.updated",
				itemId: messageId,
				payload: {
					type: "message.updated",
					properties: {
						info: {
							id: messageId,
							sessionID: bindingId,
							role: "assistant",
							time: { completed: Date.now() },
						},
					},
				},
			};
		}

		case "tool_call_start": {
			const toolCall = update.toolCall ?? (update as Record<string, unknown>);
			const callId = (toolCall.id as string) ?? `tc-${Date.now()}`;
			const toolName = (toolCall.name as string) ?? "unknown";
			toolNamesByCallId.set(callId, toolName);
			const args = (toolCall.arguments as string) ?? "{}";
			const msgId = ensureAssistantMessage(bindingId);
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: callId,
				toolCallId: callId,
				payload: {
					type: "message.part.updated",
					properties: {
						part: {
							id: callId,
							sessionID: bindingId,
							messageID: msgId,
							type: "tool",
							callID: callId,
							tool: toolName,
							state: {
								status: "running",
								input: safeParseJson(args),
							},
						},
					},
				},
			};
		}

		case "tool_call_complete": {
			const toolCall = update.toolCall ?? (update as Record<string, unknown>);
			const callId = (toolCall.id as string) ?? "";
			const toolName = (toolCall.name as string) || toolNamesByCallId.get(callId) || "unknown";
			toolNamesByCallId.delete(callId);
			const args = (toolCall.arguments as string) ?? "{}";
			const msgId = ensureAssistantMessage(bindingId);
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: callId,
				toolCallId: callId,
				payload: {
					type: "message.part.updated",
					properties: {
						part: {
							id: callId,
							sessionID: bindingId,
							messageID: msgId,
							type: "tool",
							callID: callId,
							tool: toolName,
							state: {
								status: "completed",
								input: safeParseJson(args),
							},
						},
					},
				},
			};
		}

		case "tool_result": {
			const callId = ((update as Record<string, unknown>).callId as string) ?? "";
			const output = ((update as Record<string, unknown>).result as string) ?? "";
			const toolName = toolNamesByCallId.get(callId) || "unknown";
			toolNamesByCallId.delete(callId);
			const msgId = ensureAssistantMessage(bindingId);
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: callId,
				toolCallId: callId,
				payload: {
					type: "message.part.updated",
					properties: {
						part: {
							id: callId,
							sessionID: bindingId,
							messageID: msgId,
							type: "tool",
							callID: callId,
							tool: toolName,
							state: {
								status: "completed",
								output,
							},
						},
					},
				},
			};
		}

		case "busy": {
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

		case "idle": {
			currentAssistantMessageIds.delete(bindingId);
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

		// Pi: tool_call — initial tool invocation (equivalent to tool_call_start)
		case "tool_call": {
			const callId = (update.toolCallId as string) ?? `tc-${Date.now()}`;
			const toolName = (update.title as string) ?? "unknown";
			toolNamesByCallId.set(callId, toolName);
			const rawInput = update.rawInput;
			const msgId = ensureAssistantMessage(bindingId);
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: callId,
				toolCallId: callId,
				payload: {
					type: "message.part.updated",
					properties: {
						part: {
							id: callId,
							sessionID: bindingId,
							messageID: msgId,
							type: "tool",
							callID: callId,
							tool: toolName,
							state: {
								status: "running",
								input:
									typeof rawInput === "object" && rawInput !== null
										? (rawInput as Record<string, unknown>)
										: {},
							},
						},
					},
				},
			};
		}

		// Pi: tool_call_update — tool progress/completion
		case "tool_call_update": {
			const callId = (update.toolCallId as string) ?? "";
			const status = update.status as string;
			const isFinal = status === "completed" || status === "failed";
			const rawOutput = update.rawOutput as Record<string, unknown> | undefined;
			let output = "";
			if (rawOutput?.content && Array.isArray(rawOutput.content)) {
				output = rawOutput.content
					.map((c: Record<string, unknown>) => (c.text as string) ?? "")
					.join("");
			}
			const toolName = toolNamesByCallId.get(callId) ?? "unknown";
			if (isFinal) {
				toolNamesByCallId.delete(callId);
			}
			const msgId = ensureAssistantMessage(bindingId);
			return {
				...base,
				channel: "message",
				type: "message.part.updated",
				itemId: callId,
				toolCallId: callId,
				payload: {
					type: "message.part.updated",
					properties: {
						part: {
							id: callId,
							sessionID: bindingId,
							messageID: msgId,
							type: "tool",
							callID: callId,
							tool: toolName,
							state: {
								status: isFinal ? "completed" : "running",
								...(output ? { output } : {}),
							},
						},
					},
				},
			};
		}

		// Pi: session_info_update — maps to busy/idle based on _meta.piAcp.running
		case "session_info_update": {
			const meta = update._meta as Record<string, unknown> | undefined;
			const piAcp = meta?.piAcp as Record<string, unknown> | undefined;
			const running = piAcp?.running;

			if (running === true) {
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

			if (running === false) {
				// Complete the current message if one is in progress
				const messageId = currentAssistantMessageIds.get(bindingId);
				const events: RuntimeDaemonEvent[] = [];
				if (messageId) {
					currentAssistantMessageIds.delete(bindingId);
					events.push({
						...base,
						sourceEventKey: `${bindingId}:${base.sourceSeq}-complete`,
						channel: "message",
						type: "message.updated",
						itemId: messageId,
						payload: {
							type: "message.updated",
							properties: {
								info: {
									id: messageId,
									sessionID: bindingId,
									role: "assistant",
									time: { completed: Date.now() },
								},
							},
						},
					});
				}
				events.push({
					...base,
					channel: "session",
					type: "session.idle",
					payload: {
						type: "session.idle",
						properties: {},
					},
				});
				return events;
			}

			return null;
		}

		// usage_update, available_commands_update, title_update, mode_update — ignore
		default:
			return null;
	}
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
