import type { ExtendedMessage, MessagePart } from "../message-converter";

export interface EnvRequestKey {
	key: string;
	description?: string;
	type?: "env" | "secret";
	required?: boolean;
	suggestions?: Array<{
		label: string;
		value?: string;
		instructions?: string;
	}>;
}

export interface EnvRequest {
	toolCallId: string;
	keys: EnvRequestKey[];
}

export interface SessionState {
	messages: ExtendedMessage[];
	streamingText: Record<string, string>;
	isConnected: boolean;
	isInitialized: boolean;
	isRunning: boolean;
	error: string | null;
	previewUrl: string | null;
	sessionTitle: string | null;
	envRequest: EnvRequest | null;
}

export type SessionStatus = "loading" | "connecting" | "ready" | "error" | "migrating";

/** Server part format from WebSocket messages */
export interface ServerPart {
	type: string;
	text?: string;
	image?: string;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	result?: unknown;
	status?: string;
}

/** Convert server parts to frontend MessagePart format */
export function convertServerParts(serverParts: ServerPart[]): MessagePart[] {
	return serverParts.map((p) => {
		if (p.type === "text") {
			return { type: "text" as const, text: p.text || "" };
		}
		if (p.type === "image") {
			return { type: "image" as const, image: p.image || "" };
		}
		// Tool part
		return {
			type: "tool" as const,
			toolCallId: p.toolCallId || "",
			toolName: p.toolName || "",
			args: p.args,
			result: p.result,
			isComplete: p.status === "completed" || p.status === "error",
		};
	});
}
