"use client";

import { GATEWAY_URL } from "@/lib/gateway";
import {
	type ServerMessage,
	type SyncClient,
	type SyncWebSocket,
	type ToolEndMessage,
	type ToolMetadataMessage,
	type ToolStartMessage,
	createSyncClient,
} from "@proliferate/gateway-clients";
import type { AutoStartOutputMessage } from "@proliferate/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtendedMessage } from "../message-converter";
import {
	type MessageHandlerContext,
	handleInit,
	handleMessage,
	handleMessageCancelled,
	handleMessageComplete,
	handleToken,
	handleToolEnd,
	handleToolMetadata,
	handleToolStart,
} from "./message-handlers";
import type { EnvRequest } from "./types";

interface UseSessionWebSocketOptions {
	sessionId: string;
	token: string | null;
	onTitleUpdate: (title: string) => void;
}

interface UseSessionWebSocketReturn {
	messages: ExtendedMessage[];
	streamingText: Record<string, string>;
	isConnected: boolean;
	isInitialized: boolean;
	isRunning: boolean;
	isMigrating: boolean;
	error: string | null;
	previewUrl: string | null;
	envRequest: EnvRequest | null;
	activityTick: number;
	autoStartOutput: AutoStartOutputMessage["payload"] | null;
	sendPrompt: (content: string, images?: string[]) => void;
	sendCancel: () => void;
	sendRunAutoStart: (
		runId: string,
		mode?: "test" | "start",
		commands?: import("@proliferate/shared").PrebuildServiceCommand[],
	) => void;
	clearEnvRequest: () => void;
}

/**
 * Manages WebSocket connection and message state for a coding session.
 */
export function useSessionWebSocket({
	sessionId,
	token,
	onTitleUpdate,
}: UseSessionWebSocketOptions): UseSessionWebSocketReturn {
	const [messages, setMessages] = useState<ExtendedMessage[]>([]);
	const [streamingText, setStreamingText] = useState<Record<string, string>>({});
	const [isConnected, setIsConnected] = useState(false);
	const [isInitialized, setIsInitialized] = useState(false);
	const [isRunning, setIsRunning] = useState(false);
	const [isMigrating, setIsMigrating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [envRequest, setEnvRequest] = useState<EnvRequest | null>(null);
	const [activityTick, setActivityTick] = useState(0);
	const [autoStartOutput, setAutoStartOutput] = useState<AutoStartOutputMessage["payload"] | null>(
		null,
	);

	const streamingTextRef = useRef<Record<string, string>>({});
	const messagesRef = useRef<ExtendedMessage[]>([]);
	const wsRef = useRef<SyncWebSocket | null>(null);

	// Keep messagesRef in sync
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	const getLastAssistantMessageId = useCallback((): string | null => {
		const last = messagesRef.current.findLast((m) => m.role === "assistant");
		return last?.id || null;
	}, []);

	useEffect(() => {
		console.log("[WS] useEffect triggered, GATEWAY_URL:", GATEWAY_URL, "token:", !!token);
		if (!GATEWAY_URL) {
			console.error("[WS] No GATEWAY_URL configured");
			return;
		}
		if (!token) {
			console.log("[WS] Waiting for token...");
			return;
		}

		console.log("[WS] Connecting to gateway for session:", sessionId);

		const ctx: MessageHandlerContext = {
			setMessages,
			setStreamingText,
			setIsRunning,
			setIsMigrating,
			setIsInitialized,
			setPreviewUrl,
			setEnvRequest,
			setAutoStartOutput,
			setError,
			onTitleUpdate,
			streamingTextRef,
			getLastAssistantMessageId,
			incrementActivityTick: () => setActivityTick((t) => t + 1),
		};

		const client = createSyncClient({
			baseUrl: GATEWAY_URL,
			auth: { type: "token", token },
			source: "web",
		});

		const ws = client.connect(sessionId, {
			onOpen: () => {
				console.log("[WS] Connected! Waiting for init message...");
				setIsConnected(true);
				setError(null);
			},
			onClose: () => {
				console.log("[WS] Connection closed");
				setIsConnected(false);
				setIsRunning(false);
			},
			onReconnect: (attempt) => {
				console.log(`[WS] Reconnecting (attempt ${attempt})...`);
			},
			onReconnectFailed: () => {
				console.error("[WS] Reconnection failed");
				setError("Connection lost");
			},
			onEvent: (data: ServerMessage) => {
				if (data.type === "init") {
					console.log("[WS] Received init message");
				} else if (data.type === "error") {
					console.error("[WS] Received error:", data.payload);
				}
				handleServerMessage(data, ctx);
			},
		});

		wsRef.current = ws;

		return () => {
			ws.close();
		};
	}, [token, sessionId, onTitleUpdate, getLastAssistantMessageId]);

	const sendPrompt = useCallback((content: string, images?: string[]) => {
		wsRef.current?.sendPrompt(content, images);
		setIsRunning(true); // Show cursor immediately while waiting for assistant response
	}, []);

	const sendCancel = useCallback(() => {
		wsRef.current?.sendCancel();
	}, []);

	const sendRunAutoStart = useCallback(
		(
			runId: string,
			mode?: "test" | "start",
			commands?: import("@proliferate/shared").PrebuildServiceCommand[],
		) => {
			setAutoStartOutput(null);
			wsRef.current?.sendRunAutoStart(runId, mode, commands);
		},
		[],
	);

	const clearEnvRequest = useCallback(() => {
		setEnvRequest(null);
	}, []);

	return {
		messages,
		streamingText,
		isConnected,
		isInitialized,
		isRunning,
		isMigrating,
		error,
		previewUrl,
		envRequest,
		activityTick,
		autoStartOutput,
		sendPrompt,
		sendCancel,
		sendRunAutoStart,
		clearEnvRequest,
	};
}

/** Route server messages to appropriate handlers */
function handleServerMessage(data: ServerMessage, ctx: MessageHandlerContext) {
	switch (data.type) {
		case "init":
			handleInit(data.payload, ctx);
			break;

		case "message":
			handleMessage(data.payload, ctx);
			break;

		case "token":
			handleToken(data.payload as { messageId?: string; token?: string }, ctx);
			break;

		case "tool_start":
			handleToolStart(data as ToolStartMessage, ctx);
			break;

		case "tool_end":
			handleToolEnd(data as ToolEndMessage, ctx);
			ctx.incrementActivityTick();
			break;

		case "tool_metadata":
			handleToolMetadata(data as ToolMetadataMessage, ctx);
			break;

		case "message_complete":
			handleMessageComplete(data.payload as { messageId?: string }, ctx);
			ctx.incrementActivityTick();
			break;

		case "message_cancelled":
			handleMessageCancelled(data.payload as { messageId?: string }, ctx);
			break;

		case "error":
			if (data.payload?.message) {
				ctx.setError(data.payload.message);
				ctx.setIsRunning(false);
			}
			break;

		case "session_paused":
			ctx.setIsRunning(false);
			break;

		case "session_resumed":
			ctx.setError(null);
			break;

		case "status":
			if (data.payload?.status === "resuming") {
				ctx.setIsRunning(true);
				ctx.setIsMigrating(false);
			} else if (data.payload?.status === "migrating") {
				ctx.setIsMigrating(true);
			} else if (data.payload?.status === "running") {
				ctx.setIsMigrating(false);
			}
			break;

		case "preview_url":
			if (data.payload?.url) {
				ctx.setPreviewUrl(data.payload.url);
			}
			break;

		case "title_update":
			if (data.payload?.title) {
				ctx.onTitleUpdate(data.payload.title);
			}
			break;

		case "auto_start_output":
			if (data.payload) {
				ctx.setAutoStartOutput(data.payload);
			}
			break;
	}
}
