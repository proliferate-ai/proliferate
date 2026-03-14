"use client";

import { create } from "zustand";

interface DashboardStore {
	// Sidebar state
	sidebarCollapsed: boolean;
	mobileSidebarOpen: boolean;
	sidebarRecentsOpen: boolean;
	toggleSidebar: () => void;
	setMobileSidebarOpen: (open: boolean) => void;
	toggleSidebarRecents: () => void;

	// Command search
	commandSearchOpen: boolean;
	setCommandSearchOpen: (open: boolean) => void;

	// Active session
	activeSession: string | null;
	setActiveSession: (id: string | null) => void;

	// Reset
	reset: () => void;
}

export const useDashboardStore = create<DashboardStore>()((set) => ({
	sidebarCollapsed: false,
	mobileSidebarOpen: false,
	sidebarRecentsOpen: true,
	toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
	setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
	toggleSidebarRecents: () => set((s) => ({ sidebarRecentsOpen: !s.sidebarRecentsOpen })),

	commandSearchOpen: false,
	setCommandSearchOpen: (open) => set({ commandSearchOpen: open }),

	activeSession: null,
	setActiveSession: (id) => set({ activeSession: id }),

	reset: () =>
		set({
			sidebarCollapsed: false,
			mobileSidebarOpen: false,
			sidebarRecentsOpen: true,
			commandSearchOpen: false,
			activeSession: null,
		}),
}));
