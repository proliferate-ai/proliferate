import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Message, TaskToolSummaryItem } from "@proliferate/shared";

export interface TaskToolMetadata {
	title?: string;
	summary?: TaskToolSummaryItem[];
	sessionId?: string;
}

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

export interface ExtendedMessage extends Omit<Message, "parts"> {
	parts?: MessagePart[];
}

export function convertToThreadMessage(
	message: ExtendedMessage,
	streamingText?: string,
): ThreadMessageLike {
	const content: ThreadMessageLike["content"] = [];

	if (message.parts && message.parts.length > 0) {
		for (const part of message.parts) {
			if (part.type === "image" && part.image) {
				(content as unknown[]).push({ type: "image", image: part.image });
			}
		}
		for (const part of message.parts) {
			if (part.type === "text") {
				if (part.text) {
					(content as unknown[]).push({ type: "text", text: part.text });
				}
			} else if (part.type === "tool") {
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
		if (streamingText) {
			const lastPart = message.parts[message.parts.length - 1];
			const alreadyFlushed = lastPart?.type === "text" && lastPart.text.endsWith(streamingText);
			if (!alreadyFlushed) {
				(content as unknown[]).push({ type: "text", text: streamingText });
			}
		}
	} else {
		const textContent = streamingText || message.content;
		if (textContent) {
			(content as unknown[]).push({ type: "text", text: textContent });
		}

		if (message.toolCalls) {
			for (const toolCall of message.toolCalls) {
				(content as unknown[]).push({
					type: "tool-call",
					toolCallId: toolCall.id,
					toolName: toolCall.tool,
					args: toolCall.args,
					result: toolCall.result,
				});
			}
		}
	}

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
