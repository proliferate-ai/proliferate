"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ExtendedMessage } from "../message-converter";

interface UseAutoTitleOptions {
	sessionId: string;
	messages: ExtendedMessage[];
	initialPrompt?: string;
	initialTitle?: string | null;
	onTitleUpdate?: (title: string) => void;
}

/**
 * Manages session title state.
 *
 * Title generation is now handled server-side via an async BullMQ job
 * at session creation time. This hook only manages local state for
 * the title and provides an update function for manual renames.
 */
export function useAutoTitle({ sessionId, initialTitle }: UseAutoTitleOptions) {
	const [sessionTitle, setSessionTitle] = useState<string | null>(initialTitle ?? null);
	const queryClient = useQueryClient();

	// Sync with initialTitle changes (e.g., from server-generated title refetch)
	// biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally exclude sessionTitle to avoid loops
	useEffect(() => {
		if (initialTitle && !sessionTitle) {
			setSessionTitle(initialTitle);
		}
	}, [initialTitle]);

	const updateTitle = (title: string) => {
		setSessionTitle(title);
		queryClient.invalidateQueries({ queryKey: ["sessions"] });
		queryClient.invalidateQueries({ queryKey: ["sessions", sessionId] });
	};

	return { sessionTitle, updateTitle };
}
