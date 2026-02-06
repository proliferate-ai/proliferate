"use client";

import type { HelpTopic } from "@/content/help";
import { create } from "zustand";

interface HelpStore {
	isOpen: boolean;
	topic: HelpTopic | null;
	openHelp: (topic: HelpTopic) => void;
	closeHelp: () => void;
}

export const useHelpStore = create<HelpStore>((set) => ({
	isOpen: false,
	topic: null,
	openHelp: (topic) => set({ isOpen: true, topic }),
	closeHelp: () => set({ isOpen: false, topic: null }),
}));

// Convenience function for opening help from anywhere
export function openHelp(topic: HelpTopic) {
	useHelpStore.getState().openHelp(topic);
}
