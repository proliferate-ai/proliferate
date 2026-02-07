import type { Message, MessagePart, ToolCall, ToolPart } from "@proliferate/shared";

const latencyPrefix = "[P-LATENCY]";

function getBaseUrlHost(baseUrl: string): string | null {
	try {
		return new URL(baseUrl).host;
	} catch {
		return null;
	}
}

function logLatency(event: string, data?: Record<string, unknown>): void {
	console.log(`${latencyPrefix} ${event}`, data || {});
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

export async function createOpenCodeSession(baseUrl: string, title?: string): Promise<string> {
	const startMs = Date.now();
	logLatency("opencode.session.create.start", {
		host: getBaseUrlHost(baseUrl),
		hasTitle: Boolean(title),
	});
	const response = await fetch(`${baseUrl}/session`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(title ? { title } : {}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		logLatency("opencode.session.create.error", {
			host: getBaseUrlHost(baseUrl),
			status: response.status,
			durationMs: Date.now() - startMs,
		});
		throw new Error(`Agent session create failed: ${errorText}`);
	}

	const data = (await response.json()) as { id: string };
	logLatency("opencode.session.create.ok", {
		host: getBaseUrlHost(baseUrl),
		status: response.status,
		durationMs: Date.now() - startMs,
	});
	return data.id;
}

export async function getOpenCodeSession(baseUrl: string, sessionId: string): Promise<boolean> {
	const startMs = Date.now();
	const response = await fetch(`${baseUrl}/session/${sessionId}`);
	logLatency("opencode.session.get", {
		host: getBaseUrlHost(baseUrl),
		ok: response.ok,
		status: response.status,
		durationMs: Date.now() - startMs,
	});
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
	const response = await fetch(`${baseUrl}/session`);
	if (!response.ok) {
		logLatency("opencode.session.list.error", {
			host: getBaseUrlHost(baseUrl),
			status: response.status,
			durationMs: Date.now() - startMs,
		});
		throw new Error(`Agent session list failed: ${response.status}`);
	}
	const sessions = (await response.json()) as OpenCodeSessionInfo[];
	logLatency("opencode.session.list.ok", {
		host: getBaseUrlHost(baseUrl),
		status: response.status,
		durationMs: Date.now() - startMs,
		count: sessions.length,
	});
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

	console.log(
		`[OpenCode] Updating tool result for session=${sessionId}, message=${messageId}, part=${partId}`,
	);
	logLatency("opencode.tool_result.update.start", {
		host: getBaseUrlHost(baseUrl),
		sessionId,
		messageId,
		partId,
	});

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const getStartMs = Date.now();
			// Fetch the current part to get its full structure
			const getUrl = `${baseUrl}/session/${sessionId}/message/${messageId}`;
			const getResponse = await fetch(getUrl);
			logLatency("opencode.tool_result.update.get", {
				host: getBaseUrlHost(baseUrl),
				sessionId,
				messageId,
				partId,
				attempt: attempt + 1,
				status: getResponse.status,
				ok: getResponse.ok,
				durationMs: Date.now() - getStartMs,
			});
			if (!getResponse.ok) {
				const errorText = await getResponse.text();
				if (attempt < maxRetries - 1) {
					console.log(
						`[OpenCode] Retrying part update (attempt ${attempt + 1}/${maxRetries}): ${getResponse.status} - ${errorText.slice(0, 200)}`,
					);
					await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
					continue;
				}
				console.warn(
					`[OpenCode] Failed to fetch message for part update: ${getResponse.status} - ${errorText}`,
				);
				return;
			}

			const message = (await getResponse.json()) as { parts: OpenCodeMessagePart[] };
			const part = message.parts.find((p) => p.id === partId);
			if (!part) {
				console.warn(`[OpenCode] Part ${partId} not found in message ${messageId}`);
				logLatency("opencode.tool_result.update.part_missing", {
					host: getBaseUrlHost(baseUrl),
					sessionId,
					messageId,
					partId,
				});
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
				const errorText = await patchResponse.text();
				console.warn(
					`[OpenCode] Failed to update tool result: ${patchResponse.status} - ${errorText}`,
					{ partId, messageId },
				);
				logLatency("opencode.tool_result.update.patch_error", {
					host: getBaseUrlHost(baseUrl),
					sessionId,
					messageId,
					partId,
					status: patchResponse.status,
					durationMs: Date.now() - patchStartMs,
				});
			} else {
				console.log(`[OpenCode] Tool result updated successfully for part=${partId}`);
				logLatency("opencode.tool_result.update.patch_ok", {
					host: getBaseUrlHost(baseUrl),
					sessionId,
					messageId,
					partId,
					status: patchResponse.status,
					durationMs: Date.now() - patchStartMs,
				});
			}
			return;
		} catch (err) {
			logLatency("opencode.tool_result.update.exception", {
				host: getBaseUrlHost(baseUrl),
				sessionId,
				messageId,
				partId,
				attempt: attempt + 1,
				error: err instanceof Error ? err.message : String(err),
			});
			if (attempt < maxRetries - 1) {
				console.log(`[OpenCode] Retrying part update after error (attempt ${attempt + 1})`);
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
				continue;
			}
			console.warn("[OpenCode] Failed to update tool result:", err);
		}
	}
}

export async function fetchOpenCodeMessages(
	baseUrl: string,
	sessionId: string,
): Promise<OpenCodeMessage[]> {
	const startMs = Date.now();
	console.log("[OpenCode] Fetching messages", { sessionId, baseUrl });
	const response = await fetch(`${baseUrl}/session/${sessionId}/message`);
	console.log("[OpenCode] Messages response", {
		sessionId,
		status: response.status,
		ok: response.ok,
	});
	if (!response.ok) {
		logLatency("opencode.messages.fetch.error", {
			host: getBaseUrlHost(baseUrl),
			sessionId,
			status: response.status,
			durationMs: Date.now() - startMs,
		});
		throw new Error(`Agent messages fetch failed: ${response.status}`);
	}

	const messages = (await response.json()) as OpenCodeMessage[];
	console.log("[OpenCode] Messages fetched", {
		sessionId,
		count: messages.length,
		sampleIds: messages.slice(0, 3).map((m) => m.info?.id),
	});
	logLatency("opencode.messages.fetch.ok", {
		host: getBaseUrlHost(baseUrl),
		sessionId,
		status: response.status,
		durationMs: Date.now() - startMs,
		count: messages.length,
	});
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

	console.log("[OpenCode] Sending prompt", {
		sessionId,
		baseUrl,
		partsCount: parts.length,
	});
	logLatency("opencode.prompt_async.start", {
		host: getBaseUrlHost(baseUrl),
		sessionId,
		contentLength: content.length,
		partsCount: parts.length,
	});
	const response = await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ parts }),
	});

	if (!response.ok && response.status !== 204) {
		const errorText = await response.text();
		logLatency("opencode.prompt_async.error", {
			host: getBaseUrlHost(baseUrl),
			sessionId,
			status: response.status,
			durationMs: Date.now() - startMs,
		});
		throw new Error(`Agent prompt failed: ${errorText}`);
	}
	console.log("[OpenCode] Prompt sent", {
		sessionId,
		status: response.status,
	});
	logLatency("opencode.prompt_async.ok", {
		host: getBaseUrlHost(baseUrl),
		sessionId,
		status: response.status,
		durationMs: Date.now() - startMs,
	});
}

export async function abortOpenCodeSession(baseUrl: string, sessionId: string): Promise<void> {
	const startMs = Date.now();
	const response = await fetch(`${baseUrl}/session/${sessionId}/abort`, { method: "POST" });
	if (!response.ok) {
		const errorText = await response.text();
		logLatency("opencode.abort.error", {
			host: getBaseUrlHost(baseUrl),
			sessionId,
			status: response.status,
			durationMs: Date.now() - startMs,
		});
		throw new Error(`Agent abort failed: ${errorText}`);
	}
	logLatency("opencode.abort.ok", {
		host: getBaseUrlHost(baseUrl),
		sessionId,
		status: response.status,
		durationMs: Date.now() - startMs,
	});
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

			if (part.type === "tool" && part.callID && part.tool) {
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
