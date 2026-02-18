"use client";

import { create } from "zustand";

interface SetupProgressState {
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

	onToolStart: (toolName: string) => void;
	onToolEnd: () => void;
	/** Scan init messages for milestones already reached (page refresh mid-setup) */
	hydrateFromHistory: (
		messages: Array<{
			parts?: Array<{ type: string; toolName?: string }>;
			toolCalls?: Array<{ tool: string }>;
		}>,
	) => void;
	reset: () => void;
}

const initialState = {
	hasActivity: false,
	envRequested: false,
	verified: false,
	snapshotSaved: false,
	activeTool: null,
};

export const useSetupProgressStore = create<SetupProgressState>((set) => ({
	...initialState,

	onToolStart: (toolName) =>
		set({
			hasActivity: true,
			activeTool: toolName,
			...(toolName === "request_env_variables" && { envRequested: true }),
			...(toolName === "verify" && { verified: true }),
			...(toolName === "save_snapshot" && { snapshotSaved: true }),
		}),

	onToolEnd: () => set({ activeTool: null }),

	hydrateFromHistory: (messages) => {
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
			set({ hasActivity: true, envRequested, verified, snapshotSaved });
		}
	},

	reset: () => set(initialState),
}));
