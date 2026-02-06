"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ExtendedMessage } from "../message-converter";

const MAX_TITLE_LENGTH = 50;

function deriveTitleFromPrompt(content: string): string | null {
	const cleaned = content
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (!cleaned) return null;

	const punctuationIndex = cleaned.search(/[.!?]/);
	const baseTitle = (punctuationIndex === -1 ? cleaned : cleaned.slice(0, punctuationIndex)).trim();
	if (!baseTitle) return null;

	return baseTitle.length > MAX_TITLE_LENGTH ? baseTitle.slice(0, MAX_TITLE_LENGTH) : baseTitle;
}

interface UseAutoTitleOptions {
	sessionId: string;
	messages: ExtendedMessage[];
	initialPrompt?: string;
	initialTitle?: string | null;
	onTitleUpdate?: (title: string) => void;
}

/**
 * Manages session title state and auto-derives title from first user message.
 */
export function useAutoTitle({
	sessionId,
	messages,
	initialPrompt,
	initialTitle,
	onTitleUpdate,
}: UseAutoTitleOptions) {
	const [sessionTitle, setSessionTitle] = useState<string | null>(initialTitle ?? null);
	const autoTitleAttemptedRef = useRef(false);
	const queryClient = useQueryClient();

	const renameMutation = useMutation(orpc.sessions.rename.mutationOptions());

	// Sync with initialTitle changes (only update if we don't have a title yet)
	// biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally exclude sessionTitle to avoid loops
	useEffect(() => {
		if (initialTitle && !sessionTitle) {
			setSessionTitle(initialTitle);
		}
	}, [initialTitle]);

	// Auto-derive title from first user message
	useEffect(() => {
		if (autoTitleAttemptedRef.current || sessionTitle) return;

		const firstUserMessage = messages.find(
			(message) => message.role === "user" && message.content?.trim(),
		);
		if (!firstUserMessage?.content) return;

		// Skip if it's the initial prompt (will be titled by server)
		if (initialPrompt && firstUserMessage.content.trim() === initialPrompt.trim()) {
			return;
		}

		const derivedTitle = deriveTitleFromPrompt(firstUserMessage.content);
		if (!derivedTitle) return;

		autoTitleAttemptedRef.current = true;

		renameMutation.mutate(
			{ id: sessionId, title: derivedTitle },
			{
				onSuccess: () => {
					setSessionTitle(derivedTitle);
					onTitleUpdate?.(derivedTitle);
					queryClient.invalidateQueries({ queryKey: ["sessions"] });
					queryClient.invalidateQueries({ queryKey: ["sessions", sessionId] });
				},
				onError: (err) => {
					console.warn("[auto-title] Failed to rename session:", err);
				},
			},
		);
	}, [
		messages,
		sessionTitle,
		initialPrompt,
		sessionId,
		queryClient,
		onTitleUpdate,
		renameMutation,
	]);

	const updateTitle = (title: string) => {
		setSessionTitle(title);
		queryClient.invalidateQueries({ queryKey: ["sessions"] });
		queryClient.invalidateQueries({ queryKey: ["sessions", sessionId] });
	};

	return { sessionTitle, updateTitle };
}
