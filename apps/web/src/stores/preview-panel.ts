import type { VerificationFile } from "@proliferate/shared";
import { create } from "zustand";

export type PreviewMode =
	| { type: "none" }
	| { type: "url"; url: string | null }
	| { type: "file"; file: VerificationFile }
	| { type: "gallery"; files: VerificationFile[] }
	| { type: "settings"; tab?: "info" | "snapshots" | "auto-start" }
	| { type: "git"; tab?: "git" | "changes" }
	| { type: "terminal" }
	| { type: "vscode" }
	| { type: "artifacts" };

// Mobile view state - on mobile we either show chat or preview (full screen)
export type MobileView = "chat" | "preview";

interface PreviewPanelState {
	mode: PreviewMode;
	mobileView: MobileView;
	pinnedTabs: string[];

	// Actions
	openUrl: (url: string) => void;
	openFile: (file: VerificationFile) => void;
	openGallery: (files: VerificationFile[]) => void;
	close: () => void;

	// Toggle helpers (for header buttons — toggles open/close)
	toggleUrlPreview: (url: string | null) => void;
	togglePanel: (type: "settings" | "git" | "terminal" | "vscode" | "artifacts") => void;

	// Pin/unpin tabs in header
	pinTab: (type: string) => void;
	unpinTab: (type: string) => void;

	// Mobile view toggle
	setMobileView: (view: MobileView) => void;
	toggleMobileView: () => void;
}

const DEFAULT_MODE: PreviewMode = { type: "vscode" };

export const usePreviewPanelStore = create<PreviewPanelState>((set, get) => ({
	mode: DEFAULT_MODE,
	mobileView: "chat",
	pinnedTabs: ["url", "vscode"],

	openUrl: (url: string) => set({ mode: { type: "url", url } }),

	openFile: (file: VerificationFile) => set({ mode: { type: "file", file } }),

	openGallery: (files: VerificationFile[]) => set({ mode: { type: "gallery", files } }),

	close: () => set({ mode: DEFAULT_MODE, mobileView: "chat" }),

	// Toggle URL preview — switches between url and default view
	toggleUrlPreview: (url: string | null) => {
		const { mode } = get();
		if (mode.type === "url") {
			set({ mode: DEFAULT_MODE });
		} else {
			set({ mode: { type: "url", url } });
		}
	},

	// Switch panel view — always stays open, just switches type
	togglePanel: (type: "settings" | "git" | "terminal" | "vscode" | "artifacts") => {
		const { mode } = get();
		if (mode.type === type) {
			set({ mode: DEFAULT_MODE });
		} else {
			set({ mode: { type } });
		}
	},

	pinTab: (type) =>
		set((state) => ({
			pinnedTabs: state.pinnedTabs.includes(type) ? state.pinnedTabs : [...state.pinnedTabs, type],
		})),

	unpinTab: (type) =>
		set((state) => ({
			pinnedTabs: state.pinnedTabs.filter((t) => t !== type),
		})),

	setMobileView: (view: MobileView) => set({ mobileView: view }),

	toggleMobileView: () => {
		const { mobileView } = get();
		set({ mobileView: mobileView === "chat" ? "preview" : "chat" });
	},
}));

// Helper to check if panel is open (always true now, but kept for mobile compat)
export const isPanelOpen = (mode: PreviewMode) => mode.type !== "none";
