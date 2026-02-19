"use client";

import { create } from "zustand";

interface SessionProgress {
	/** Whether any tool has been called (agent is actively working) */
	hasActivity: boolean;
	/** Agent has called request_env_variables */
	envRequested: boolean;
	/** Agent has called verify */
	verified: boolean;
	/** Agent has called save_snapshot */
	snapshotSaved: boolean;
	/** Currently executing tool name (null between tools) */
	activeTool: string | null;
}

const emptyProgress: SessionProgress = {
	hasActivity: false,
	envRequested: false,
	verified: false,
	snapshotSaved: false,
	activeTool: null,
};

interface SetupProgressState {
	/** Active session ID whose progress is being tracked */
	activeSessionId: string | null;

	/** Progress for the active session */
	progress: SessionProgress;

	/** Set the active session (clears progress if changed) */
	setActiveSession: (sessionId: string) => void;

	onToolStart: (sessionId: string, toolName: string) => void;
	onToolEnd: (sessionId: string) => void;
	/** Scan init messages for milestones already reached (page refresh mid-setup) */
	hydrateFromHistory: (
		sessionId: string,
		messages: Array<{
			parts?: Array<{ type: string; toolName?: string }>;
			toolCalls?: Array<{ tool: string }>;
		}>,
	) => void;
	reset: (sessionId?: string) => void;
}

export const useSetupProgressStore = create<SetupProgressState>((set, get) => ({
	activeSessionId: null,
	progress: { ...emptyProgress },

	setActiveSession: (sessionId) => {
		const state = get();
		if (state.activeSessionId === sessionId) return;
		set({
			activeSessionId: sessionId,
			progress: { ...emptyProgress },
		});
	},

	onToolStart: (sessionId, toolName) => {
		const state = get();
		if (state.activeSessionId !== null && state.activeSessionId !== sessionId) return;
		set({
			activeSessionId: sessionId,
			progress: {
				...state.progress,
				hasActivity: true,
				activeTool: toolName,
				...(toolName === "request_env_variables" && { envRequested: true }),
				...(toolName === "verify" && { verified: true }),
				...(toolName === "save_snapshot" && { snapshotSaved: true }),
			},
		});
	},

	onToolEnd: (sessionId) => {
		const state = get();
		if (state.activeSessionId !== null && state.activeSessionId !== sessionId) return;
		set({
			activeSessionId: sessionId,
			progress: { ...state.progress, activeTool: null },
		});
	},

	hydrateFromHistory: (sessionId, messages) => {
		const state = get();
		// Accept hydration if activeSessionId matches OR hasn't been set yet
		// (init event can arrive before SetupSessionChrome's useEffect runs)
		if (state.activeSessionId !== null && state.activeSessionId !== sessionId) return;

		let envRequested = false;
		let verified = false;
		let snapshotSaved = false;

		for (const msg of messages) {
			for (const part of msg.parts || []) {
				const name = part.toolName;
				if (name === "request_env_variables") envRequested = true;
				if (name === "verify") verified = true;
				if (name === "save_snapshot") snapshotSaved = true;
			}
			for (const tc of msg.toolCalls || []) {
				if (tc.tool === "request_env_variables") envRequested = true;
				if (tc.tool === "verify") verified = true;
				if (tc.tool === "save_snapshot") snapshotSaved = true;
			}
		}

		if (envRequested || verified || snapshotSaved) {
			set({
				activeSessionId: sessionId,
				progress: {
					...state.progress,
					hasActivity: true,
					envRequested,
					verified,
					snapshotSaved,
				},
			});
		}
	},

	reset: (sessionId) => {
		const state = get();
		// If sessionId provided, only reset if it matches active session
		if (sessionId && state.activeSessionId !== sessionId) return;
		set({
			activeSessionId: null,
			progress: { ...emptyProgress },
		});
	},
}));
