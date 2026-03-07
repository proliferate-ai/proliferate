import { createLogger } from "@proliferate/logger";
import type { Message, MessagePart, ToolCall, ToolPart } from "@proliferate/shared";

const logger = createLogger({ service: "gateway" }).child({
	module: "sandbox-agent-v1-runtime",
});
const runtimeLookupTimeoutMs = 5000;

function withRuntimeUrl(baseUrl: string, path: string): string {
	return `${baseUrl}${path}`;
}

function withAuthHeaders(authToken: string): HeadersInit {
	return {
		Authorization: `Bearer ${authToken}`,
		"Content-Type": "application/json",
	};
}

export interface RuntimeSessionInfo {
	id: string;
	title: string;
	time: {
		created: number;
		updated: number;
	};
}

export interface OpenCodeMessageInfo {
	id: string;
	role: "user" | "assistant";
	time?: {
		created?: number;
		completed?: number;
	};
	error?: unknown;
}

export interface OpenCodeToolState {
	status?: "pending" | "running" | "completed" | "error";
	input?: Record<string, unknown>;
	output?: string;
	error?: string;
	metadata?: Record<string, unknown>;
	title?: string;
	time?: {
		start?: number;
		end?: number;
	};
}

export interface OpenCodeMessagePart {
	id: string;
	messageID: string;
	sessionID: string;
	type: string;
	text?: string;
	ignored?: boolean;
	callID?: string;
	tool?: string;
	state?: OpenCodeToolState;
	url?: string;
	mime?: string;
}

export interface OpenCodeMessage {
	info: OpenCodeMessageInfo;
	parts: OpenCodeMessagePart[];
}

export async function createRuntimeSession(
	baseUrl: string,
	authToken: string,
	title?: string,
): Promise<string> {
	const response = await fetch(withRuntimeUrl(baseUrl, "/_proliferate/v1/runtime/session/create"), {
		method: "POST",
		headers: withAuthHeaders(authToken),
		body: JSON.stringify(title ? { title } : {}),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Runtime session create failed (${response.status}): ${text}`);
	}
	const payload = (await response.json()) as { id: string };
	return payload.id;
}

export async function getRuntimeSession(
	baseUrl: string,
	authToken: string,
	sessionId: string,
): Promise<boolean> {
	const response = await fetch(
		withRuntimeUrl(
			baseUrl,
			`/_proliferate/v1/runtime/session/get?session_id=${encodeURIComponent(sessionId)}`,
		),
		{
			headers: { Authorization: `Bearer ${authToken}` },
			signal: AbortSignal.timeout(runtimeLookupTimeoutMs),
		},
	);
	if (response.status === 404) {
		return false;
	}
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Runtime session lookup failed (${response.status}): ${text}`);
	}
	const payload = (await response.json()) as { exists?: boolean };
	return Boolean(payload.exists);
}

export async function listRuntimeSessions(
	baseUrl: string,
	authToken: string,
): Promise<RuntimeSessionInfo[]> {
	const response = await fetch(withRuntimeUrl(baseUrl, "/_proliferate/v1/runtime/session/list"), {
		headers: { Authorization: `Bearer ${authToken}` },
		signal: AbortSignal.timeout(runtimeLookupTimeoutMs),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Runtime session list failed (${response.status}): ${text}`);
	}
	const payload = (await response.json()) as { sessions?: RuntimeSessionInfo[] };
	return payload.sessions ?? [];
}

export async function sendRuntimePrompt(
	baseUrl: string,
	authToken: string,
	sessionId: string,
	content: string,
	images?: Array<{ data: string; mediaType: string }>,
): Promise<void> {
	const response = await fetch(withRuntimeUrl(baseUrl, "/_proliferate/v1/runtime/session/prompt"), {
		method: "POST",
		headers: withAuthHeaders(authToken),
		body: JSON.stringify({
			sessionId,
			content,
			images: images ?? [],
		}),
	});
	if (!response.ok && response.status !== 204) {
		const text = await response.text();
		throw new Error(`Runtime prompt failed (${response.status}): ${text}`);
	}
}

export async function interruptRuntimeSession(
	baseUrl: string,
	authToken: string,
	sessionId: string,
): Promise<void> {
	const response = await fetch(
		withRuntimeUrl(baseUrl, "/_proliferate/v1/runtime/session/interrupt"),
		{
			method: "POST",
			headers: withAuthHeaders(authToken),
			body: JSON.stringify({ sessionId }),
		},
	);
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Runtime interrupt failed (${response.status}): ${text}`);
	}
}

export async function fetchRuntimeMessages(
	baseUrl: string,
	authToken: string,
	sessionId: string,
): Promise<OpenCodeMessage[]> {
	const response = await fetch(
		withRuntimeUrl(
			baseUrl,
			`/_proliferate/v1/runtime/session/messages?session_id=${encodeURIComponent(sessionId)}`,
		),
		{
			headers: { Authorization: `Bearer ${authToken}` },
			signal: AbortSignal.timeout(runtimeLookupTimeoutMs),
		},
	);
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Runtime messages failed (${response.status}): ${text}`);
	}
	const payload = (await response.json()) as { messages?: OpenCodeMessage[] };
	return payload.messages ?? [];
}

function mapToolStatus(status?: string): "pending" | "running" | "completed" | "error" {
	if (status === "completed" || status === "error" || status === "running") {
		return status;
	}
	return "pending";
}

function getOpenCodeMessageError(error: unknown): string | null {
	if (!error) return null;
	if (typeof error === "string") return error;
	if (typeof error !== "object") return String(error);

	const obj = error as {
		name?: unknown;
		message?: unknown;
		data?: { message?: unknown } | null;
	};
	if (typeof obj.data?.message === "string" && obj.data.message) return obj.data.message;
	if (typeof obj.message === "string" && obj.message) return obj.message;
	if (typeof obj.name === "string" && obj.name) return obj.name;
	return null;
}

export function mapRuntimeMessages(messages: OpenCodeMessage[]): Message[] {
	return messages.map((message) => {
		const createdAt = message.info.time?.created || Date.now();
		const isComplete =
			message.info.role === "user"
				? true
				: Boolean(message.info.time?.completed || message.info.error);

		const parts: MessagePart[] = [];
		const toolCalls: ToolCall[] = [];
		let content = "";

		for (const part of message.parts || []) {
			if (part.type === "text" && !part.ignored && part.text) {
				parts.push({ type: "text", text: part.text });
				content += part.text;
				continue;
			}
			if (part.type === "file" && part.url && part.mime?.startsWith("image/")) {
				parts.push({ type: "image", image: part.url });
				continue;
			}
			if (part.callID && part.tool) {
				const status = mapToolStatus(part.state?.status);
				const toolPart: ToolPart = {
					type: "tool",
					toolCallId: part.callID,
					toolName: part.tool,
					args: part.state?.input || {},
					result: part.state?.output || part.state?.error,
					status,
				};
				parts.push(toolPart);
				toolCalls.push({
					id: part.callID,
					tool: part.tool,
					args: part.state?.input || {},
					result: part.state?.output || part.state?.error,
					status,
					startedAt: Date.now(),
					completedAt: status === "completed" || status === "error" ? Date.now() : undefined,
				});
			}
		}

		if (message.info.role === "assistant" && parts.length === 0 && !content) {
			const errorText = getOpenCodeMessageError(message.info.error);
			if (errorText) {
				parts.push({ type: "text", text: errorText });
				content = errorText;
			}
		}

		return {
			id: message.info.id,
			role: message.info.role,
			content,
			isComplete,
			createdAt,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			parts: parts.length > 0 ? parts : undefined,
		};
	});
}

export function logRuntimeLookupError(error: unknown, context: Record<string, unknown>): void {
	logger.debug(
		{
			...context,
			error: error instanceof Error ? error.message : String(error),
		},
		"runtime.lookup.error",
	);
}
