import type {
	ToolEndMessage,
	ToolMetadataMessage,
	ToolStartMessage,
} from "@proliferate/gateway-clients";
import type { AutoStartOutputMessage } from "@proliferate/shared";
import type { ExtendedMessage, MessagePart, TaskToolMetadata } from "../message-converter";
import { type EnvRequest, type ServerPart, convertServerParts } from "./types";

// Using 'any' for SDK payloads since types don't align perfectly between SDK and frontend.
// Runtime validation ensures correctness.

type SetMessages = React.Dispatch<React.SetStateAction<ExtendedMessage[]>>;
type SetStreamingText = React.Dispatch<React.SetStateAction<Record<string, string>>>;

export interface MessageHandlerContext {
	setMessages: SetMessages;
	setStreamingText: SetStreamingText;
	setIsRunning: (running: boolean) => void;
	setIsMigrating: (migrating: boolean) => void;
	setIsInitialized: (initialized: boolean) => void;
	setPreviewUrl: (url: string | null) => void;
	setEnvRequest: (request: EnvRequest | null) => void;
	setAutoStartOutput: (output: AutoStartOutputMessage["payload"] | null) => void;
	setError: (error: string | null) => void;
	onTitleUpdate: (title: string) => void;
	streamingTextRef: React.MutableRefObject<Record<string, string>>;
	getLastAssistantMessageId: () => string | null;
	incrementActivityTick: () => void;
}

/** Handle init message - sets initial messages and config */
export function handleInit(payload: any, ctx: MessageHandlerContext) {
	if (!payload?.messages) return;

	ctx.streamingTextRef.current = {};
	ctx.setMessages(
		payload.messages.map((m: any) => {
			if (m.parts && m.parts.length > 0) {
				const parts = convertServerParts(m.parts as ServerPart[]);
				return { ...m, parts };
			}

			// Legacy fallback: Build parts from content + toolCalls
			const parts: MessagePart[] = [];
			if (m.content) {
				parts.push({ type: "text" as const, text: m.content });
			}
			if (m.toolCalls && m.toolCalls.length > 0) {
				for (const tc of m.toolCalls) {
					parts.push({
						type: "tool" as const,
						toolCallId: tc.id,
						toolName: tc.tool,
						args: tc.args,
						result: tc.result,
						isComplete: tc.status === "completed" || tc.status === "error",
					});
				}
			}
			return { ...m, parts };
		}),
	);

	if (payload.config?.previewTunnelUrl) {
		ctx.setPreviewUrl(payload.config.previewTunnelUrl);
	}
	ctx.setIsInitialized(true);
}

/** Handle new message or message update */
export function handleMessage(payload: any, ctx: MessageHandlerContext) {
	if (!payload) return;

	ctx.setMessages((prev) => {
		const exists = prev.some((m) => m.id === payload.id);
		if (exists) {
			return prev.map((m) => (m.id === payload.id ? { ...m, ...payload, parts: m.parts } : m));
		}

		// New message - convert server parts if provided
		let parts: MessagePart[] = [];
		if (payload.parts && payload.parts.length > 0) {
			parts = convertServerParts(payload.parts as ServerPart[]);
		}
		return [...prev, { ...payload, parts }];
	});

	if (payload.role === "assistant" && !payload.isComplete) {
		ctx.setIsRunning(true);
	}
}

/** Handle streaming token */
export function handleToken(
	payload: { messageId?: string; token?: string },
	ctx: MessageHandlerContext,
) {
	if (!payload?.messageId || !payload?.token) return;

	const msgId = payload.messageId;
	ctx.streamingTextRef.current[msgId] = (ctx.streamingTextRef.current[msgId] || "") + payload.token;

	ctx.setStreamingText((prev) => ({
		...prev,
		[msgId]: ctx.streamingTextRef.current[msgId],
	}));
}

/** Handle tool start - add tool part to message */
export function handleToolStart(data: ToolStartMessage, ctx: MessageHandlerContext) {
	const payload = data.payload;
	const messageId = payload.messageId || ctx.getLastAssistantMessageId();

	// Detect env request tool
	const toolArgs = payload.args as Record<string, unknown> | undefined;
	if (payload.tool === "request_env_variables" && toolArgs?.keys) {
		ctx.setEnvRequest({
			toolCallId: payload.toolCallId,
			keys: toolArgs.keys as EnvRequest["keys"],
		});
	}

	if (!messageId) return;

	flushStreamingText(messageId, ctx);

	ctx.setMessages((prev) =>
		prev.map((m) => {
			if (m.id !== messageId || m.role !== "assistant") return m;

			const parts = [...(m.parts || [])];
			const existingIndex = parts.findIndex(
				(p) => p.type === "tool" && p.toolCallId === payload.toolCallId,
			);

			if (existingIndex >= 0) {
				parts[existingIndex] = { ...parts[existingIndex], args: payload.args } as MessagePart;
			} else {
				parts.push({
					type: "tool",
					toolCallId: payload.toolCallId,
					toolName: payload.tool,
					args: payload.args,
					isComplete: false,
				});
			}
			return { ...m, parts };
		}),
	);
}

/** Handle tool end - mark tool as complete with result */
export function handleToolEnd(data: ToolEndMessage, ctx: MessageHandlerContext) {
	const payload = data.payload;
	// Ensure result is truthy (empty string causes issues)
	const result = payload.result || " ";

	ctx.setMessages((prev) =>
		prev.map((m) => {
			if (m.role !== "assistant" || !m.parts) return m;

			const parts = m.parts.map((p) => {
				if (p.type === "tool" && p.toolCallId === payload.toolCallId) {
					return { ...p, result, isComplete: true };
				}
				return p;
			});
			return { ...m, parts };
		}),
	);
}

/** Handle tool metadata update (sub-agent progress) */
export function handleToolMetadata(data: ToolMetadataMessage, ctx: MessageHandlerContext) {
	const payload = data.payload;

	ctx.setMessages((prev) =>
		prev.map((m) => {
			if (m.role !== "assistant" || !m.parts) return m;

			const parts = m.parts.map((p) => {
				if (p.type === "tool" && p.toolCallId === payload.toolCallId) {
					const metadata: TaskToolMetadata = {
						title: payload.title,
						summary: payload.metadata?.summary,
						sessionId: payload.metadata?.sessionId,
					};
					return { ...p, metadata };
				}
				return p;
			});
			return { ...m, parts };
		}),
	);
}

/** Handle message complete */
export function handleMessageComplete(payload: { messageId?: string }, ctx: MessageHandlerContext) {
	if (!payload?.messageId) return;

	flushStreamingText(payload.messageId, ctx);
	ctx.setMessages((msgs) =>
		msgs.map((m) => (m.id === payload.messageId ? { ...m, isComplete: true } : m)),
	);
	ctx.setIsRunning(false);
}

/** Handle message cancelled */
export function handleMessageCancelled(
	payload: { messageId?: string },
	ctx: MessageHandlerContext,
) {
	if (!payload?.messageId) return;

	flushStreamingText(payload.messageId, ctx);
	ctx.setMessages((msgs) =>
		msgs.map((m) => (m.id === payload.messageId ? { ...m, isComplete: true } : m)),
	);
	ctx.setIsRunning(false);
}

/** Flush accumulated streaming text into message parts */
function flushStreamingText(messageId: string, ctx: MessageHandlerContext) {
	const text = ctx.streamingTextRef.current[messageId];
	if (!text) return;

	// Clear ref first (prevents double-flush)
	delete ctx.streamingTextRef.current[messageId];

	ctx.setStreamingText((prev) => {
		const { [messageId]: _, ...rest } = prev;
		return rest;
	});

	ctx.setMessages((msgs) =>
		msgs.map((m) => {
			if (m.id !== messageId) return m;

			const parts = [...(m.parts || [])];
			const lastPart = parts[parts.length - 1];

			if (lastPart?.type === "text") {
				parts[parts.length - 1] = { ...lastPart, text: lastPart.text + text };
			} else {
				parts.push({ type: "text", text });
			}
			return { ...m, parts };
		}),
	);
}
