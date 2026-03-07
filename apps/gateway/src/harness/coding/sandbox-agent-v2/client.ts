/**
 * Sandbox Agent ACP HTTP client.
 *
 * Communicates with the Rivet Sandbox Agent via the ACP (Agent Client Protocol).
 * The Sandbox Agent runs on port 2468 inside the sandbox, proxied through
 * Caddy at /v1/* on port 20000.
 *
 * ACP endpoints:
 *   POST   /v1/acp              — Create a new ACP server (agent session)
 *   POST   /v1/acp/{serverId}   — Send an envelope (prompt) to the server
 *   GET    /v1/acp/{serverId}   — SSE stream of UniversalEvents
 *   DELETE /v1/acp/{serverId}   — Terminate and clean up the server
 */

import { createLogger } from "@proliferate/logger";
import type { Message, MessagePart, ToolCall, ToolPart } from "@proliferate/shared";

const logger = createLogger({ service: "gateway" }).child({
	module: "sandbox-agent-v2-runtime",
});

function withAuthHeaders(authToken: string): HeadersInit {
	return {
		Authorization: `Bearer ${authToken}`,
		"Content-Type": "application/json",
	};
}

// ---------------------------------------------------------------------------
// ACP session lifecycle
// ---------------------------------------------------------------------------

export type AcpAgent = "claude" | "opencode" | "pi";

export interface AcpCreateServerResult {
	serverId: string;
}

export async function createAcpServer(
	baseUrl: string,
	authToken: string,
	agent: AcpAgent,
): Promise<AcpCreateServerResult> {
	const response = await fetch(`${baseUrl}/v1/acp`, {
		method: "POST",
		headers: withAuthHeaders(authToken),
		body: JSON.stringify({ agent }),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`ACP server create failed (${response.status}): ${text}`);
	}
	const payload = (await response.json()) as { server_id?: string; serverId?: string };
	const serverId = payload.server_id ?? payload.serverId;
	if (!serverId) {
		throw new Error("ACP server create returned no server ID");
	}
	return { serverId };
}

export async function sendAcpEnvelope(
	baseUrl: string,
	authToken: string,
	serverId: string,
	content: string,
	images?: Array<{ data: string; mediaType: string }>,
): Promise<void> {
	const parts: Array<{
		type: string;
		text?: string;
		mime?: string;
		url?: string;
		filename?: string;
	}> = [{ type: "text", text: content }];

	for (const image of images ?? []) {
		parts.push({
			type: "file",
			mime: image.mediaType,
			url: `data:${image.mediaType};base64,${image.data}`,
			filename: "image.png",
		});
	}

	const response = await fetch(`${baseUrl}/v1/acp/${encodeURIComponent(serverId)}`, {
		method: "POST",
		headers: withAuthHeaders(authToken),
		body: JSON.stringify({ parts }),
	});
	if (!response.ok && response.status !== 204) {
		const text = await response.text();
		throw new Error(`ACP envelope send failed (${response.status}): ${text}`);
	}
}

export async function deleteAcpServer(
	baseUrl: string,
	authToken: string,
	serverId: string,
): Promise<void> {
	const response = await fetch(`${baseUrl}/v1/acp/${encodeURIComponent(serverId)}`, {
		method: "DELETE",
		headers: { Authorization: `Bearer ${authToken}` },
	});
	if (!response.ok && response.status !== 404) {
		const text = await response.text();
		throw new Error(`ACP server delete failed (${response.status}): ${text}`);
	}
}

// ---------------------------------------------------------------------------
// Message collection (fetches from ACP state endpoint)
// ---------------------------------------------------------------------------

export interface AcpMessagePart {
	type: string;
	text?: string;
	toolCallId?: string;
	toolName?: string;
	args?: Record<string, unknown>;
	result?: string;
	status?: string;
	url?: string;
	mime?: string;
}

export interface AcpMessage {
	id: string;
	role: "user" | "assistant";
	parts: AcpMessagePart[];
	createdAt?: number;
	completedAt?: number;
	error?: string;
}

function mapToolStatus(status?: string): "pending" | "running" | "completed" | "error" {
	if (status === "completed" || status === "error" || status === "running") {
		return status;
	}
	return "pending";
}

export function mapAcpMessages(messages: AcpMessage[]): Message[] {
	return messages.map((message) => {
		const createdAt = message.createdAt ?? Date.now();
		const isComplete =
			message.role === "user" ? true : Boolean(message.completedAt || message.error);

		const parts: MessagePart[] = [];
		const toolCalls: ToolCall[] = [];
		let content = "";

		for (const part of message.parts) {
			if (part.type === "text" && part.text) {
				parts.push({ type: "text", text: part.text });
				content += part.text;
				continue;
			}
			if (part.type === "image" && part.url) {
				parts.push({ type: "image", image: part.url });
				continue;
			}
			if (part.toolCallId && part.toolName) {
				const status = mapToolStatus(part.status);
				const toolPart: ToolPart = {
					type: "tool",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					args: part.args ?? {},
					result: part.result,
					status,
				};
				parts.push(toolPart);
				toolCalls.push({
					id: part.toolCallId,
					tool: part.toolName,
					args: part.args ?? {},
					result: part.result,
					status,
					startedAt: Date.now(),
					completedAt: status === "completed" || status === "error" ? Date.now() : undefined,
				});
			}
		}

		if (message.role === "assistant" && parts.length === 0 && !content && message.error) {
			parts.push({ type: "text", text: message.error });
			content = message.error;
		}

		return {
			id: message.id,
			role: message.role,
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
