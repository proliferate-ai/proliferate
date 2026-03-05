"use client";

import type { SessionStatus } from "@/hooks/sessions/coding-runtime/types";
import { useAutoTitle } from "@/hooks/sessions/coding-runtime/use-auto-title";
import { useSessionWebSocket } from "@/hooks/sessions/coding-runtime/use-session-websocket";
import { convertToThreadMessage } from "@/lib/sessions/coding-message-converter";
import { type AppendMessage, useExternalStoreRuntime } from "@assistant-ui/react";
import { useCallback, useMemo, useState } from "react";
import { useWsToken } from "./use-ws-token";

export type {
	EnvRequest,
	EnvRequestKey,
	SessionStatus,
} from "@/hooks/sessions/coding-runtime/types";

interface UseCodingSessionRuntimeOptions {
	sessionId: string;
	initialPrompt?: string;
	initialImages?: string[];
	initialTitle?: string | null;
}

/**
 * Main hook for coding session runtime.
 * Composes smaller hooks for token, websocket, and title management.
 *
 * Note: The initial prompt is now auto-sent by the gateway after sandbox boot.
 * Title generation is handled server-side via an async BullMQ job.
 */
export function useCodingSessionRuntime({
	sessionId,
	initialPrompt,
	initialTitle,
}: UseCodingSessionRuntimeOptions) {
	void initialPrompt;
	const { token, isLoading: tokenLoading, error: tokenError } = useWsToken();

	// Track title updates from WebSocket
	const [wsTitle, setWsTitle] = useState<string | null>(null);

	// WebSocket and message state
	const {
		messages,
		streamingText,
		isConnected,
		isInitialized,
		isRunning,
		isMigrating,
		statusMessage,
		error: wsError,
		previewUrl,
		envRequest,
		activityTick,
		autoStartOutput,
		gitState,
		gitResult,
		gitDiff,
		pendingApprovals,
		workspaceState,
		sendPrompt,
		sendCancel,
		sendRunAutoStart,
		sendGetGitStatus,
		sendGetGitDiff,
		sendGitCreateBranch,
		sendGitCommit,
		sendGitPush,
		sendGitCreatePr,
		clearEnvRequest,
		clearGitResult,
	} = useSessionWebSocket({
		sessionId,
		token,
		onTitleUpdate: setWsTitle,
	});

	// Title management - single instance with actual messages
	const { sessionTitle, updateTitle } = useAutoTitle({
		sessionId,
		initialTitle: wsTitle || initialTitle,
	});

	// Convert messages for assistant-ui
	const threadMessages = useMemo(() => {
		return messages.map((msg) => convertToThreadMessage(msg, streamingText[msg.id]));
	}, [messages, streamingText]);

	// onNew callback for assistant-ui
	const onNew = useCallback(
		async (message: AppendMessage) => {
			if (!isConnected) return;

			const textContent = message.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n");

			const images = message.content
				.filter((part): part is { type: "image"; image: string } => part.type === "image")
				.map((part) => part.image);

			if (!textContent.trim() && images.length === 0) return;

			sendPrompt(textContent, images.length > 0 ? images : undefined);
		},
		[isConnected, sendPrompt],
	);

	// onCancel callback for assistant-ui
	const onCancel = useCallback(async () => {
		if (!isConnected) return;
		sendCancel();
	}, [isConnected, sendCancel]);

	const effectiveIsRunning = isRunning && threadMessages.length > 0;

	const runtime = useExternalStoreRuntime({
		messages: threadMessages,
		isRunning: effectiveIsRunning,
		onNew,
		onCancel,
		convertMessage: (message) => message,
	});

	// Derive status
	const status: SessionStatus = tokenLoading
		? "loading"
		: tokenError || wsError
			? "error"
			: !isConnected || !isInitialized
				? "connecting"
				: isMigrating
					? "migrating"
					: "ready";

	return {
		status,
		runtime,
		error: tokenError || wsError,
		messages,
		statusMessage,
		previewUrl,
		sessionTitle,
		updateTitle,
		envRequest,
		clearEnvRequest,
		activityTick,
		autoStartOutput,
		sendRunAutoStart,
		isMigrating,
		gitState,
		gitResult,
		gitDiff,
		sendGetGitStatus,
		sendGetGitDiff,
		sendGitCreateBranch,
		sendGitCommit,
		sendGitPush,
		sendGitCreatePr,
		clearGitResult,
		pendingApprovals,
		workspaceState,
		wsToken: token,
	};
}
