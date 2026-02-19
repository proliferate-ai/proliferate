"use client";

import { create } from "zustand";

interface CodingSessionModalState {
	isOpen: boolean;
	sessionId?: string;
	configurationId?: string;
	sessionType?: "coding" | "setup";
	title?: string;
	description?: string;
	initialPrompt?: string;
	/** Images to send with initial prompt (data URIs) */
	initialImages?: string[];
	/** When editing an existing snapshot, this is the snapshot ID to overwrite */
	editingSnapshotId?: string;
	onSessionCreated?: (sessionId: string) => void;
	onClose?: () => void;
}

interface CodingSessionStore extends CodingSessionModalState {
	openSession: (params: Omit<CodingSessionModalState, "isOpen">) => void;
	closeSession: () => void;
	setSessionId: (sessionId: string) => void;
}

export const useCodingSessionStore = create<CodingSessionStore>((set, get) => ({
	isOpen: false,
	sessionId: undefined,
	configurationId: undefined,
	sessionType: undefined,
	title: undefined,
	description: undefined,
	initialPrompt: undefined,
	initialImages: undefined,
	editingSnapshotId: undefined,
	onSessionCreated: undefined,
	onClose: undefined,

	openSession: (params) => {
		set({
			isOpen: true,
			...params,
		});
	},

	closeSession: () => {
		const { onClose } = get();
		onClose?.();
		set({
			isOpen: false,
			sessionId: undefined,
			configurationId: undefined,
			sessionType: undefined,
			title: undefined,
			description: undefined,
			initialPrompt: undefined,
			initialImages: undefined,
			editingSnapshotId: undefined,
			onSessionCreated: undefined,
			onClose: undefined,
		});
	},

	setSessionId: (sessionId) => {
		const { onSessionCreated } = get();
		onSessionCreated?.(sessionId);
		set({ sessionId });
	},
}));

// Convenience function for opening coding sessions
export function openCodingSession(params: {
	sessionId?: string;
	configurationId?: string;
	title?: string;
	description?: string;
	onClose?: () => void;
}) {
	useCodingSessionStore.getState().openSession({
		...params,
		sessionType: "coding",
	});
}

// Convenience function for viewing historical setup sessions (read-only)
export function openHistoricalSession(sessionId: string, snapshotName?: string) {
	useCodingSessionStore.getState().openSession({
		sessionId,
		sessionType: "setup",
		title: snapshotName ? `Setup: ${snapshotName}` : "Setup History",
		description: "View the conversation that created this snapshot.",
	});
}
