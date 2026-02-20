import type { VerificationFile } from "@proliferate/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PreviewMode =
	| { type: "none" }
	| { type: "url"; url: string | null }
	| { type: "file"; file: VerificationFile }
	| { type: "gallery"; files: VerificationFile[] }
	| { type: "settings"; tab?: "info" | "snapshots" | "auto-start" }
	| { type: "git" }
	| { type: "terminal" }
	| { type: "vscode" }
	| { type: "artifacts" }
	| { type: "services" }
	| { type: "environment" }
	| { type: "investigation" };

// Mobile view state - on mobile we either show chat or preview (full screen)
export type MobileView = "chat" | "preview";

interface PreviewPanelState {
	mode: PreviewMode;
	mobileView: MobileView;
	pinnedTabs: string[];
	panelSizes: number[];
	panelSide: "left" | "right";
	missingEnvKeyCount: number;

	// Actions
	openUrl: (url: string) => void;
	openFile: (file: VerificationFile) => void;
	openGallery: (files: VerificationFile[]) => void;
	close: () => void;
	closePanel: () => void;

	// Toggle helpers (for header buttons — toggles open/close)
	toggleUrlPreview: (url: string | null) => void;
	togglePanel: (
		type:
			| "settings"
			| "git"
			| "terminal"
			| "vscode"
			| "artifacts"
			| "services"
			| "environment"
			| "investigation",
	) => void;

	// Pin/unpin tabs in header
	pinTab: (type: string) => void;
	unpinTab: (type: string) => void;

	// Panel sizes (persisted)
	setPanelSizes: (sizes: number[]) => void;
	setPanelSide: (side: "left" | "right") => void;

	// Missing env key count
	setMissingEnvKeyCount: (count: number) => void;

	// Mobile view toggle
	setMobileView: (view: MobileView) => void;
	toggleMobileView: () => void;
}

const DEFAULT_MODE: PreviewMode = { type: "none" };
const NONE_MODE: PreviewMode = { type: "none" };

export const usePreviewPanelStore = create<PreviewPanelState>()(
	persist(
		(set, get) => ({
			mode: DEFAULT_MODE,
			mobileView: "chat",
			pinnedTabs: ["url", "services", "vscode", "settings"],
			panelSizes: [35, 65],
			panelSide: "right",
			missingEnvKeyCount: 0,

			openUrl: (url: string) => set({ mode: { type: "url", url } }),

			openFile: (file: VerificationFile) => set({ mode: { type: "file", file } }),

			openGallery: (files: VerificationFile[]) => set({ mode: { type: "gallery", files } }),

			close: () => set({ mode: DEFAULT_MODE, mobileView: "chat" }),

			// Close panel to empty state (used by PanelShell close button)
			closePanel: () => set({ mode: NONE_MODE }),

			// Toggle URL preview — switches between url and none
			toggleUrlPreview: (url: string | null) => {
				const { mode } = get();
				if (mode.type === "url") {
					set({ mode: NONE_MODE });
				} else {
					set({ mode: { type: "url", url } });
				}
			},

			// Switch panel view — clicking active tab closes to none
			togglePanel: (
				type:
					| "settings"
					| "git"
					| "terminal"
					| "vscode"
					| "artifacts"
					| "services"
					| "environment"
					| "investigation",
			) => {
				const { mode } = get();
				if (mode.type === type) {
					set({ mode: NONE_MODE });
				} else {
					set({ mode: { type } });
				}
			},

			pinTab: (type) =>
				set((state) => ({
					pinnedTabs: state.pinnedTabs.includes(type)
						? state.pinnedTabs
						: [...state.pinnedTabs, type],
				})),

			unpinTab: (type) =>
				set((state) => ({
					pinnedTabs: state.pinnedTabs.filter((t) => t !== type),
				})),

			setPanelSizes: (sizes: number[]) => set({ panelSizes: sizes }),
			setPanelSide: (side) => set({ panelSide: side }),

			setMissingEnvKeyCount: (count: number) => set({ missingEnvKeyCount: count }),

			setMobileView: (view: MobileView) => set({ mobileView: view }),

			toggleMobileView: () => {
				const { mobileView } = get();
				set({ mobileView: mobileView === "chat" ? "preview" : "chat" });
			},
		}),
		{
			name: "preview-panel-storage",
			partialize: (state) => ({
				pinnedTabs: state.pinnedTabs,
				panelSizes: state.panelSizes,
				panelSide: state.panelSide,
			}),
		},
	),
);

// Helper to check if panel is open
export const isPanelOpen = (mode: PreviewMode) => mode.type !== "none";
