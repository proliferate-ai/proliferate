"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OnboardingStep = "create-org" | "invite" | "complete";

interface OnboardingStore {
	step: OnboardingStep;
	orgName: string;
	setStep: (step: OnboardingStep) => void;
	setOrgName: (name: string) => void;
	reset: () => void;
}

export const useOnboardingStore = create<OnboardingStore>()(
	persist(
		(set) => ({
			step: "create-org",
			orgName: "",
			setStep: (step) => set({ step }),
			setOrgName: (orgName) => set({ orgName }),
			reset: () =>
				set({
					step: "create-org",
					orgName: "",
				}),
		}),
		{
			name: "onboarding-storage",
		},
	),
);
