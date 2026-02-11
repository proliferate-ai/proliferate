"use client";

import { GATEWAY_URL } from "@/lib/gateway";
import {
	type ServerMessage,
	type SyncWebSocket,
	type ToolEndMessage,
	type ToolMetadataMessage,
	type ToolStartMessage,
	createSyncClient,
} from "@proliferate/gateway-clients";
import type {
	ActionApprovalRequestMessage,
	AutoStartOutputMessage,
	GitResultMessage,
	GitState,
	GitStatusMessage,
} from "@proliferate/shared";
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
	gitState: GitState | null;
	gitResult: GitResultMessage["payload"] | null;
	pendingApprovals: ActionApprovalRequestMessage["payload"][];
	sendPrompt: (content: string, images?: string[]) => void;
	sendCancel: () => void;
	sendRunAutoStart: (
		runId: string,
		mode?: "test" | "start",
		commands?: import("@proliferate/shared").PrebuildServiceCommand[],
	) => void;
	sendGetGitStatus: (workspacePath?: string) => void;
	sendGitCreateBranch: (branchName: string, workspacePath?: string) => void;
	sendGitCommit: (
		message: string,
		opts?: { includeUntracked?: boolean; files?: string[]; workspacePath?: string },
	) => void;
	sendGitPush: (workspacePath?: string) => void;
	sendGitCreatePr: (
		title: string,
		body?: string,
		baseBranch?: string,
		workspacePath?: string,
	) => void;
	clearEnvRequest: () => void;
	clearGitResult: () => void;
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
	const [gitState, setGitState] = useState<GitState | null>(null);
	const [gitResult, setGitResult] = useState<GitResultMessage["payload"] | null>(null);
	const [pendingApprovals, setPendingApprovals] = useState<
		ActionApprovalRequestMessage["payload"][]
	>([]);

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
		if (!GATEWAY_URL) {
			setError("No gateway URL configured");
			return;
		}
		if (!token) {
			return;
		}

		const ctx: MessageHandlerContext = {
			setMessages,
			setStreamingText,
			setIsRunning,
			setIsMigrating,
			setIsInitialized,
			setPreviewUrl,
			setEnvRequest,
			setAutoStartOutput,
			setGitState,
			setGitResult,
			setPendingApprovals,
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
				setIsConnected(true);
				setError(null);
			},
			onClose: () => {
				setIsConnected(false);
				setIsRunning(false);
			},
			onReconnectFailed: () => {
				setError("Connection lost");
			},
			onEvent: (data: ServerMessage) => {
				handleServerMessage(data, ctx);
			},
		});

		wsRef.current = ws;

		return () => {
			ws.close();
			wsRef.current = null;
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

	const sendGetGitStatus = useCallback((workspacePath?: string) => {
		wsRef.current?.sendGetGitStatus(workspacePath);
	}, []);

	const sendGitCreateBranch = useCallback((branchName: string, workspacePath?: string) => {
		wsRef.current?.sendGitCreateBranch(branchName, workspacePath);
	}, []);

	const sendGitCommit = useCallback(
		(
			message: string,
			opts?: { includeUntracked?: boolean; files?: string[]; workspacePath?: string },
		) => {
			wsRef.current?.sendGitCommit(message, opts);
		},
		[],
	);

	const sendGitPush = useCallback((workspacePath?: string) => {
		wsRef.current?.sendGitPush(workspacePath);
	}, []);

	const sendGitCreatePr = useCallback(
		(title: string, body?: string, baseBranch?: string, workspacePath?: string) => {
			wsRef.current?.sendGitCreatePr(title, body, baseBranch, workspacePath);
		},
		[],
	);

	const clearEnvRequest = useCallback(() => {
		setEnvRequest(null);
	}, []);

	const clearGitResult = useCallback(() => {
		setGitResult(null);
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
		gitState,
		gitResult,
		pendingApprovals,
		sendPrompt,
		sendCancel,
		sendRunAutoStart,
		sendGetGitStatus,
		sendGitCreateBranch,
		sendGitCommit,
		sendGitPush,
		sendGitCreatePr,
		clearEnvRequest,
		clearGitResult,
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

		case "git_status":
			if (data.payload) {
				ctx.setGitState(data.payload as GitState);
			}
			break;

		case "git_result":
			if (data.payload) {
				ctx.setGitResult(data.payload as GitResultMessage["payload"]);
			}
			break;

		case "action_approval_request":
			if (data.payload) {
				ctx.setPendingApprovals((prev) => [
					...prev,
					data.payload as ActionApprovalRequestMessage["payload"],
				]);
			}
			break;

		case "action_approval_result":
		case "action_completed":
			if (data.payload?.invocationId) {
				ctx.setPendingApprovals((prev) =>
					prev.filter((a) => a.invocationId !== data.payload.invocationId),
				);
			}
			break;
	}
}
