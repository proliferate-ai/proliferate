import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Message, TaskToolSummaryItem, ToolCall } from "@proliferate/shared";

// Metadata for task tools - rolling summary of sub-agent progress
export interface TaskToolMetadata {
	title?: string;
	summary?: TaskToolSummaryItem[];
	sessionId?: string;
}

// A part can be text, image, or a tool call - maintaining order
export type MessagePart =
	| { type: "text"; text: string }
	| { type: "image"; image: string }
	| {
			type: "tool";
			toolCallId: string;
			toolName: string;
			args: unknown;
			result?: unknown;
			isComplete: boolean;
			metadata?: TaskToolMetadata;
	  };

// ExtendedMessage uses local MessagePart type (with isComplete) instead of shared MessagePart (with status)
export interface ExtendedMessage extends Omit<Message, "parts"> {
	// Ordered parts array - text and tools interleaved (uses local MessagePart type)
	parts?: MessagePart[];
}

export function convertToThreadMessage(
	message: ExtendedMessage,
	streamingText?: string,
): ThreadMessageLike {
	const content: ThreadMessageLike["content"] = [];

	// If we have ordered parts, use them directly
	// But always render images first, then text, then tools
	if (message.parts && message.parts.length > 0) {
		// First pass: add all images
		for (const part of message.parts) {
			if (part.type === "image" && part.image) {
				(content as unknown[]).push({ type: "image", image: part.image });
			}
		}
		// Second pass: add text and tools
		for (const part of message.parts) {
			if (part.type === "text") {
				if (part.text) {
					(content as unknown[]).push({ type: "text", text: part.text });
				}
			} else if (part.type === "tool") {
				// For task tools, merge metadata into args so it's available in the tool UI
				const argsWithMetadata = part.metadata
					? { ...(part.args as object), __metadata: part.metadata }
					: part.args;
				(content as unknown[]).push({
					type: "tool-call",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					args: argsWithMetadata,
					result: part.result,
				});
			}
		}
		// Append streaming text at the end if available (for text being typed after tools)
		// Skip if this text was already flushed to parts (prevents duplicate due to React batching)
		if (streamingText) {
			const lastPart = message.parts[message.parts.length - 1];
			const alreadyFlushed = lastPart?.type === "text" && lastPart.text.endsWith(streamingText);
			if (!alreadyFlushed) {
				(content as unknown[]).push({ type: "text", text: streamingText });
			}
		}
	} else {
		// Fallback: use content string + toolCalls array (old structure)
		const textContent = streamingText || message.content;
		if (textContent) {
			(content as unknown[]).push({ type: "text", text: textContent });
		}

		if (message.toolCalls) {
			for (const tc of message.toolCalls) {
				(content as unknown[]).push({
					type: "tool-call",
					toolCallId: tc.id,
					toolName: tc.tool,
					args: tc.args,
					result: tc.result,
				});
			}
		}
	}

	// Status is only supported for assistant messages
	if (message.role === "assistant") {
		return {
			id: message.id,
			role: message.role,
			content,
			createdAt: new Date(message.createdAt),
			status: message.isComplete ? { type: "complete", reason: "stop" } : { type: "running" },
		};
	}

	return {
		id: message.id,
		role: message.role,
		content,
		createdAt: new Date(message.createdAt),
	};
}
