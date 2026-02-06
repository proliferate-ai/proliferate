"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FlowType = "personal" | "organization" | null;
export type OnboardingStep =
	| "path"
	| "create-org"
	| "slack"
	| "github"
	| "repos"
	| "payment"
	| "complete";

interface OnboardingStore {
	flowType: FlowType;
	step: OnboardingStep;
	selectedRepoIds: string[];
	setFlowType: (type: FlowType) => void;
	setStep: (step: OnboardingStep) => void;
	setSelectedRepoIds: (ids: string[]) => void;
	toggleRepoSelection: (id: string) => void;
	reset: () => void;
}

export const useOnboardingStore = create<OnboardingStore>()(
	persist(
		(set) => ({
			flowType: null,
			step: "path",
			selectedRepoIds: [],
			setFlowType: (flowType) => set({ flowType }),
			setStep: (step) => set({ step }),
			setSelectedRepoIds: (selectedRepoIds) => set({ selectedRepoIds }),
			toggleRepoSelection: (id) =>
				set((state) => ({
					selectedRepoIds: state.selectedRepoIds.includes(id)
						? state.selectedRepoIds.filter((repoId) => repoId !== id)
						: [...state.selectedRepoIds, id],
				})),
			reset: () => set({ flowType: null, step: "path", selectedRepoIds: [] }),
		}),
		{
			name: "onboarding-storage",
		},
	),
);
