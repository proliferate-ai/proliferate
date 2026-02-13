import type { ModelId } from "@proliferate/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DashboardState {
	// Selection state
	selectedRepoId: string | null;
	selectedSnapshotId: string | null;
	activeSessionId: string | null;

	// Prompt state (for session creation flow)
	pendingPrompt: string | null;
	selectedModel: ModelId;

	// UI state
	sidebarCollapsed: boolean;
	mobileSidebarOpen: boolean;
	activeModal: "settings" | null;
	settingsTab: "repositories" | "connections" | "secrets" | "organization" | null;
	commandSearchOpen: boolean;
	dismissedOnboardingCards: string[];
	hasSeenWelcome: boolean;

	// Sidebar organize preferences
	sidebarOrganize: "by-project" | "chronological";
	sidebarSort: "created" | "updated";
	sidebarStatusFilter: "all" | "running" | "paused";

	// Actions
	setSelectedRepo: (repoId: string | null) => void;
	setSelectedSnapshot: (snapshotId: string | null) => void;
	setActiveSession: (sessionId: string | null) => void;
	setPendingPrompt: (prompt: string | null) => void;
	setSelectedModel: (model: ModelId) => void;
	clearPendingPrompt: () => void;
	toggleSidebar: () => void;
	setMobileSidebarOpen: (open: boolean) => void;
	openSettings: (tab?: "repositories" | "connections" | "secrets" | "organization") => void;
	closeModal: () => void;
	setCommandSearchOpen: (open: boolean) => void;
	dismissOnboardingCard: (cardId: string) => void;
	markWelcomeSeen: () => void;
	setSidebarOrganize: (organize: "by-project" | "chronological") => void;
	setSidebarSort: (sort: "created" | "updated") => void;
	setSidebarStatusFilter: (filter: "all" | "running" | "paused") => void;
	reset: () => void;
}

export const useDashboardStore = create<DashboardState>()(
	persist(
		(set) => ({
			// Initial state
			selectedRepoId: null,
			selectedSnapshotId: null,
			activeSessionId: null,
			pendingPrompt: null,
			selectedModel: "claude-opus-4.6",
			sidebarCollapsed: false,
			mobileSidebarOpen: false,
			activeModal: null,
			settingsTab: null,
			commandSearchOpen: false,
			dismissedOnboardingCards: [],
			hasSeenWelcome: false,
			sidebarOrganize: "chronological",
			sidebarSort: "updated",
			sidebarStatusFilter: "all",

			// Actions
			setSelectedRepo: (repoId) =>
				set({
					selectedRepoId: repoId,
					// Reset snapshot when repo changes
					selectedSnapshotId: null,
				}),

			setSelectedSnapshot: (snapshotId) => set({ selectedSnapshotId: snapshotId }),

			setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

			setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),

			setSelectedModel: (model) => set({ selectedModel: model }),

			clearPendingPrompt: () => set({ pendingPrompt: null }),

			toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

			setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),

			openSettings: (tab) => set({ activeModal: "settings", settingsTab: tab ?? null }),

			closeModal: () => set({ activeModal: null, settingsTab: null }),

			setCommandSearchOpen: (open) => set({ commandSearchOpen: open }),

			dismissOnboardingCard: (cardId) =>
				set((state) => ({
					dismissedOnboardingCards: state.dismissedOnboardingCards.includes(cardId)
						? state.dismissedOnboardingCards
						: [...state.dismissedOnboardingCards, cardId],
				})),

			markWelcomeSeen: () => set({ hasSeenWelcome: true }),

			setSidebarOrganize: (organize) => set({ sidebarOrganize: organize }),
			setSidebarSort: (sort) => set({ sidebarSort: sort }),
			setSidebarStatusFilter: (filter) => set({ sidebarStatusFilter: filter }),

			reset: () =>
				set({
					selectedRepoId: null,
					selectedSnapshotId: null,
					activeSessionId: null,
					pendingPrompt: null,
					selectedModel: "claude-opus-4.6",
					sidebarCollapsed: false,
					mobileSidebarOpen: false,
					activeModal: null,
					settingsTab: null,
					commandSearchOpen: false,
					dismissedOnboardingCards: [],
					hasSeenWelcome: false,
					sidebarOrganize: "chronological",
					sidebarSort: "updated",
					sidebarStatusFilter: "all",
				}),
		}),
		{
			name: "dashboard-storage",
			// Only persist selection-related state, not UI state
			partialize: (state) => ({
				selectedRepoId: state.selectedRepoId,
				selectedSnapshotId: state.selectedSnapshotId,
				selectedModel: state.selectedModel,
				sidebarCollapsed: state.sidebarCollapsed,
				dismissedOnboardingCards: state.dismissedOnboardingCards,
				hasSeenWelcome: state.hasSeenWelcome,
				sidebarOrganize: state.sidebarOrganize,
				sidebarSort: state.sidebarSort,
				sidebarStatusFilter: state.sidebarStatusFilter,
			}),
		},
	),
);
