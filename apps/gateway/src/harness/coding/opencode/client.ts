import { createLogger } from "@proliferate/logger";
import type { Message, MessagePart, ToolCall, ToolPart } from "@proliferate/shared";

const logger = createLogger({ service: "gateway" }).child({ module: "opencode" });
const opencodeLookupTimeoutMs = 5000;

function getBaseUrlHost(baseUrl: string): string | null {
	try {
		return new URL(baseUrl).host;
	} catch {
		return null;
	}
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
	// File/image part properties
	url?: string;
	mime?: string;
}

export interface OpenCodeMessage {
	info: OpenCodeMessageInfo;
	parts: OpenCodeMessagePart[];
}

export interface OpenCodeSessionCreateError extends Error {
	retryable?: boolean;
	status?: number;
	code?: string;
	phase?: "fetch" | "http";
}

function buildOpenCodeSessionCreateError(
	message: string,
	details: Partial<OpenCodeSessionCreateError>,
): OpenCodeSessionCreateError {
	const error = new Error(message) as OpenCodeSessionCreateError;
	error.retryable = details.retryable;
	error.status = details.status;
	error.code = details.code;
	error.phase = details.phase;
	return error;
}

export async function createOpenCodeSession(baseUrl: string, title?: string): Promise<string> {
	const startMs = Date.now();
	const host = getBaseUrlHost(baseUrl);
	logger.debug({ host, hasTitle: Boolean(title) }, "opencode.session.create.start");
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/session`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(title ? { title } : {}),
		});
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		const cause =
			err.cause && typeof err.cause === "object"
				? (err.cause as { code?: unknown; message?: unknown })
				: undefined;
		const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
		const causeMessage = typeof cause?.message === "string" ? cause.message : undefined;
		logger.debug(
			{
				host,
				durationMs: Date.now() - startMs,
				errorName: err.name,
				errorMessage: err.message,
				causeCode,
				causeMessage,
			},
			"opencode.session.create.fetch_error",
		);
		throw buildOpenCodeSessionCreateError(
			`OpenCode session create fetch failed: ${err.message}${causeCode ? ` (${causeCode})` : ""}`,
			{
				retryable: true,
				code: causeCode,
				phase: "fetch",
			},
		);
	}

	if (!response.ok) {
		const errorText = await response.text();
		const maxErrorPreviewLength = 300;
		const errorPreview =
			errorText.length > maxErrorPreviewLength
				? `${errorText.slice(0, maxErrorPreviewLength)}...`
				: errorText;
		logger.debug(
			{
				host,
				status: response.status,
				durationMs: Date.now() - startMs,
				errorLength: errorText.length,
			},
			"opencode.session.create.error",
		);
		const status = response.status;
		const retryable = status >= 500 || status === 408 || status === 429;
		throw buildOpenCodeSessionCreateError(
			`OpenCode session create failed: ${errorPreview}${
				errorText.length > maxErrorPreviewLength ? ` (truncated; length=${errorText.length})` : ""
			}`,
			{
				retryable,
				status,
				phase: "http",
			},
		);
	}

	const data = (await response.json()) as { id: string };
	logger.debug(
		{
			host,
			status: response.status,
			durationMs: Date.now() - startMs,
		},
		"opencode.session.create.ok",
	);
	return data.id;
}

export async function getOpenCodeSession(baseUrl: string, sessionId: string): Promise<boolean> {
	const startMs = Date.now();
	const response = await fetch(`${baseUrl}/session/${sessionId}`, {
		signal: AbortSignal.timeout(opencodeLookupTimeoutMs),
	});
	logger.debug(
		{
			host: getBaseUrlHost(baseUrl),
			ok: response.ok,
			status: response.status,
			durationMs: Date.now() - startMs,
		},
		"opencode.session.get",
	);
	return response.ok;
}

export interface OpenCodeSessionInfo {
	id: string;
	title: string;
	time: {
		created: number;
		updated: number;
	};
}

/**
 * List all OpenCode sessions, sorted by most recently updated first.
 */
export async function listOpenCodeSessions(baseUrl: string): Promise<OpenCodeSessionInfo[]> {
	const startMs = Date.now();
	const response = await fetch(`${baseUrl}/session`, {
		signal: AbortSignal.timeout(opencodeLookupTimeoutMs),
	});
	if (!response.ok) {
		logger.debug(
			{
				host: getBaseUrlHost(baseUrl),
				status: response.status,
				durationMs: Date.now() - startMs,
			},
			"opencode.session.list.error",
		);
		throw new Error(`OpenCode session list failed: ${response.status}`);
	}
	const sessions = (await response.json()) as OpenCodeSessionInfo[];
	logger.debug(
		{
			host: getBaseUrlHost(baseUrl),
			status: response.status,
			durationMs: Date.now() - startMs,
			count: sessions.length,
		},
		"opencode.session.list.ok",
	);
	return sessions;
}

/**
 * Update a tool part's result in OpenCode.
 * Used by intercepted tools to persist their real result back to OpenCode.
 */
export async function updateToolResult(
	baseUrl: string,
	sessionId: string,
	messageId: string,
	partId: string,
	result: string,
): Promise<void> {
	// Retry with delay - the message might still be streaming when we first try
	const maxRetries = 5;
	const retryDelayMs = 1000;

	logger.info({ sessionId, messageId, partId }, "Updating tool result");
	logger.debug(
		{ host: getBaseUrlHost(baseUrl), sessionId, messageId, partId },
		"opencode.tool_result.update.start",
	);

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const getStartMs = Date.now();
			// Fetch the current part to get its full structure
			const getUrl = `${baseUrl}/session/${sessionId}/message/${messageId}`;
			const getResponse = await fetch(getUrl);
			logger.debug(
				{
					host: getBaseUrlHost(baseUrl),
					sessionId,
					messageId,
					partId,
					attempt: attempt + 1,
					status: getResponse.status,
					ok: getResponse.ok,
					durationMs: Date.now() - getStartMs,
				},
				"opencode.tool_result.update.get",
			);
			if (!getResponse.ok) {
				if (attempt < maxRetries - 1) {
					logger.info(
						{ attempt: attempt + 1, maxRetries, status: getResponse.status },
						"Retrying part update",
					);
					await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
					continue;
				}
				logger.warn(
					{ status: getResponse.status, partId, messageId },
					"Failed to fetch message for part update",
				);
				return;
			}

			const message = (await getResponse.json()) as { parts: OpenCodeMessagePart[] };
			const part = message.parts.find((p) => p.id === partId);
			if (!part) {
				logger.warn({ partId, messageId }, "Part not found in message");
				logger.debug(
					{ host: getBaseUrlHost(baseUrl), sessionId, messageId, partId },
					"opencode.tool_result.update.part_missing",
				);
				return;
			}

			// Update the part with the new result
			// ToolStateCompleted requires: status, input, output, title, metadata, time (start + end)
			const now = Date.now();
			const updatedPart: OpenCodeMessagePart = {
				...part,
				state: {
					status: "completed",
					input: part.state?.input || {},
					output: result,
					title: part.state?.title || "",
					metadata: part.state?.metadata || {},
					time: {
						start: part.state?.time?.start || now,
						end: now,
					},
				},
			};

			const patchStartMs = Date.now();
			const patchResponse = await fetch(
				`${baseUrl}/session/${sessionId}/message/${messageId}/part/${partId}`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(updatedPart),
				},
			);

			if (!patchResponse.ok) {
				logger.warn(
					{ status: patchResponse.status, partId, messageId },
					"Failed to update tool result",
				);
				logger.debug(
					{
						host: getBaseUrlHost(baseUrl),
						sessionId,
						messageId,
						partId,
						status: patchResponse.status,
						durationMs: Date.now() - patchStartMs,
					},
					"opencode.tool_result.update.patch_error",
				);
			} else {
				logger.info({ partId }, "Tool result updated successfully");
				logger.debug(
					{
						host: getBaseUrlHost(baseUrl),
						sessionId,
						messageId,
						partId,
						status: patchResponse.status,
						durationMs: Date.now() - patchStartMs,
					},
					"opencode.tool_result.update.patch_ok",
				);
			}
			return;
		} catch (err) {
			logger.debug(
				{
					host: getBaseUrlHost(baseUrl),
					sessionId,
					messageId,
					partId,
					attempt: attempt + 1,
					error: err instanceof Error ? err.message : String(err),
				},
				"opencode.tool_result.update.exception",
			);
			if (attempt < maxRetries - 1) {
				logger.info({ attempt: attempt + 1 }, "Retrying part update after error");
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
				continue;
			}
			logger.warn({ err }, "Failed to update tool result");
		}
	}
}

export async function fetchOpenCodeMessages(
	baseUrl: string,
	sessionId: string,
): Promise<OpenCodeMessage[]> {
	const startMs = Date.now();
	logger.info({ sessionId }, "Fetching messages");
	const response = await fetch(`${baseUrl}/session/${sessionId}/message`, {
		signal: AbortSignal.timeout(opencodeLookupTimeoutMs),
	});
	logger.debug({ sessionId, status: response.status, ok: response.ok }, "Messages response");
	if (!response.ok) {
		logger.debug(
			{
				host: getBaseUrlHost(baseUrl),
				sessionId,
				status: response.status,
				durationMs: Date.now() - startMs,
			},
			"opencode.messages.fetch.error",
		);
		throw new Error(`OpenCode messages fetch failed: ${response.status}`);
	}

	const messages = (await response.json()) as OpenCodeMessage[];
	logger.info({ sessionId, count: messages.length }, "Messages fetched");
	logger.debug(
		{
			host: getBaseUrlHost(baseUrl),
			sessionId,
			status: response.status,
			durationMs: Date.now() - startMs,
			count: messages.length,
		},
		"opencode.messages.fetch.ok",
	);
	return messages;
}

export async function sendPromptAsync(
	baseUrl: string,
	sessionId: string,
	content: string,
	images?: Array<{ data: string; mediaType: string }>,
): Promise<void> {
	const startMs = Date.now();
	const parts: Array<{
		type: string;
		text?: string;
		mime?: string;
		url?: string;
		filename?: string;
	}> = [{ type: "text", text: content }];

	// Add image parts as file parts with data URIs
	// OpenCode expects { type: "file", mime, url } format
	for (const image of images || []) {
		parts.push({
			type: "file",
			mime: image.mediaType,
			url: `data:${image.mediaType};base64,${image.data}`,
			filename: "image.png",
		});
	}

	logger.info({ sessionId, partsCount: parts.length }, "Sending prompt");
	logger.debug(
		{
			host: getBaseUrlHost(baseUrl),
			sessionId,
			contentLength: content.length,
			partsCount: parts.length,
		},
		"opencode.prompt_async.start",
	);
	const response = await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ parts }),
	});

	if (!response.ok && response.status !== 204) {
		const errorText = await response.text();
		logger.debug(
			{
				host: getBaseUrlHost(baseUrl),
				sessionId,
				status: response.status,
				durationMs: Date.now() - startMs,
			},
			"opencode.prompt_async.error",
		);
		throw new Error(`OpenCode prompt failed: ${errorText}`);
	}
	logger.info({ sessionId, status: response.status }, "Prompt sent");
	logger.debug(
		{
			host: getBaseUrlHost(baseUrl),
			sessionId,
			status: response.status,
			durationMs: Date.now() - startMs,
		},
		"opencode.prompt_async.ok",
	);
}

export async function abortOpenCodeSession(baseUrl: string, sessionId: string): Promise<void> {
	const startMs = Date.now();
	const response = await fetch(`${baseUrl}/session/${sessionId}/abort`, { method: "POST" });
	if (!response.ok) {
		const errorText = await response.text();
		logger.debug(
			{
				host: getBaseUrlHost(baseUrl),
				sessionId,
				status: response.status,
				durationMs: Date.now() - startMs,
			},
			"opencode.abort.error",
		);
		throw new Error(`OpenCode abort failed: ${errorText}`);
	}
	logger.debug(
		{
			host: getBaseUrlHost(baseUrl),
			sessionId,
			status: response.status,
			durationMs: Date.now() - startMs,
		},
		"opencode.abort.ok",
	);
}

function mapToolStatus(status?: string): "pending" | "running" | "completed" | "error" {
	if (status === "completed" || status === "error" || status === "running") {
		return status;
	}
	return "pending";
}

export function mapOpenCodeMessages(messages: OpenCodeMessage[]): Message[] {
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

			// Handle image/file parts (OpenCode stores images as file parts with data URIs)
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

		// Preserve assistant-side errors for init/history hydration.
		// Without this fallback, failed assistant turns become visually blank.
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
