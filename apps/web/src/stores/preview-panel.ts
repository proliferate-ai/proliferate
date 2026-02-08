import type { VerificationFile } from "@proliferate/shared";
import { create } from "zustand";

export type PreviewMode =
	| { type: "none" }
	| { type: "url"; url: string | null }
	| { type: "file"; file: VerificationFile }
	| { type: "gallery"; files: VerificationFile[] }
	| { type: "session-info" }
	| { type: "snapshots" }
	| { type: "service-commands" };

// Mobile view state - on mobile we either show chat or preview (full screen)
export type MobileView = "chat" | "preview";

interface PreviewPanelState {
	mode: PreviewMode;
	mobileView: MobileView;

	// Actions
	openUrl: (url: string) => void;
	openFile: (file: VerificationFile) => void;
	openGallery: (files: VerificationFile[]) => void;
	openSessionInfo: () => void;
	openSnapshots: () => void;
	openServiceCommands: () => void;
	close: () => void;

	// Toggle helpers (for header buttons — toggles open/close)
	toggleUrlPreview: (url: string | null) => void;
	togglePanel: (type: "session-info" | "snapshots" | "service-commands") => void;

	// Mobile view toggle
	setMobileView: (view: MobileView) => void;
	toggleMobileView: () => void;
}

export const usePreviewPanelStore = create<PreviewPanelState>((set, get) => ({
	mode: { type: "none" },
	mobileView: "chat",

	openUrl: (url: string) => set({ mode: { type: "url", url } }),

	openFile: (file: VerificationFile) => set({ mode: { type: "file", file } }),

	openGallery: (files: VerificationFile[]) => set({ mode: { type: "gallery", files } }),

	openSessionInfo: () => set({ mode: { type: "session-info" } }),

	openSnapshots: () => set({ mode: { type: "snapshots" } }),

	openServiceCommands: () => set({ mode: { type: "service-commands" } }),

	close: () => set({ mode: { type: "none" }, mobileView: "chat" }),

	// Toggle URL preview specifically - used by the preview button
	toggleUrlPreview: (url: string | null) => {
		const { mode } = get();
		if (mode.type === "url") {
			set({ mode: { type: "none" }, mobileView: "chat" });
		} else {
			set({ mode: { type: "url", url } });
		}
	},

	// Generic toggle for session-info / snapshots / service-commands panels
	togglePanel: (type: "session-info" | "snapshots" | "service-commands") => {
		const { mode } = get();
		if (mode.type === type) {
			set({ mode: { type: "none" }, mobileView: "chat" });
		} else {
			set({ mode: { type } });
		}
	},

	setMobileView: (view: MobileView) => set({ mobileView: view }),

	toggleMobileView: () => {
		const { mobileView, mode } = get();
		// Only toggle if there's something to show in preview
		if (mode.type !== "none") {
			set({ mobileView: mobileView === "chat" ? "preview" : "chat" });
		}
	},
}));

// Helper to check if panel is open
export const isPanelOpen = (mode: PreviewMode) => mode.type !== "none";
