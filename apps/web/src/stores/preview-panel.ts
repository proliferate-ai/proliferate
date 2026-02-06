import type { VerificationFile } from "@proliferate/shared";
import { create } from "zustand";

export type PreviewMode =
	| { type: "none" }
	| { type: "url"; url: string }
	| { type: "file"; file: VerificationFile }
	| { type: "gallery"; files: VerificationFile[] };

// Mobile view state - on mobile we either show chat or preview (full screen)
export type MobileView = "chat" | "preview";

interface PreviewPanelState {
	mode: PreviewMode;
	mobileView: MobileView;

	// Actions
	openUrl: (url: string) => void;
	openFile: (file: VerificationFile) => void;
	openGallery: (files: VerificationFile[]) => void;
	close: () => void;

	// URL preview toggle (for the preview button in header)
	toggleUrlPreview: (url: string | null) => void;

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

	close: () => set({ mode: { type: "none" }, mobileView: "chat" }),

	// Toggle URL preview specifically - used by the preview button
	toggleUrlPreview: (url: string | null) => {
		const { mode } = get();
		if (mode.type === "url") {
			// If showing URL preview, close it
			set({ mode: { type: "none" }, mobileView: "chat" });
		} else if (url) {
			// Otherwise, open URL preview
			set({ mode: { type: "url", url } });
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
