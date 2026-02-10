"use client";

import { type AppendMessage, useExternalStoreRuntime } from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertToThreadMessage } from "../message-converter";
import type { SessionStatus } from "./types";
import { useAutoTitle } from "./use-auto-title";
import { useSessionWebSocket } from "./use-session-websocket";
import { useWsToken } from "./use-ws-token";

export type { EnvRequest, EnvRequestKey, SessionStatus } from "./types";

interface UseCodingSessionRuntimeOptions {
	sessionId: string;
	initialPrompt?: string;
	initialImages?: string[];
	initialTitle?: string | null;
	clientType?: string | null;
}

/**
 * Main hook for coding session runtime.
 * Composes smaller hooks for token, websocket, and title management.
 */
export function useCodingSessionRuntime({
	sessionId,
	initialPrompt,
	initialImages,
	initialTitle,
	clientType,
}: UseCodingSessionRuntimeOptions) {
	const { token, isLoading: tokenLoading, error: tokenError } = useWsToken();
	const initialPromptSentRef = useRef(false);

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
		error: wsError,
		previewUrl,
		envRequest,
		activityTick,
		autoStartOutput,
		sendPrompt,
		sendCancel,
		sendRunAutoStart,
		clearEnvRequest,
	} = useSessionWebSocket({
		sessionId,
		token,
		onTitleUpdate: setWsTitle,
	});

	// Title management - single instance with actual messages
	const { sessionTitle } = useAutoTitle({
		sessionId,
		messages,
		initialPrompt,
		initialTitle: wsTitle || initialTitle,
	});

	// Auto-send initial prompt when initialized
	useEffect(() => {
		if (
			isInitialized &&
			initialPrompt &&
			!initialPromptSentRef.current &&
			messages.length === 0 &&
			clientType !== "automation"
		) {
			initialPromptSentRef.current = true;
			sendPrompt(
				initialPrompt,
				initialImages && initialImages.length > 0 ? initialImages : undefined,
			);
		}
	}, [isInitialized, initialPrompt, initialImages, messages.length, sendPrompt, clientType]);

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

	// Don't show running state when there are no messages and no prompt was sent —
	// the gateway may send status events that set isRunning before user interaction.
	const effectiveIsRunning =
		isRunning && (threadMessages.length > 0 || initialPromptSentRef.current);

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
		previewUrl,
		sessionTitle,
		envRequest,
		clearEnvRequest,
		activityTick,
		autoStartOutput,
		sendRunAutoStart,
		isMigrating,
	};
}
