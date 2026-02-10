"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FlowType = "personal" | "organization" | null;
export type OnboardingStep = "path" | "create-org" | "slack" | "github" | "payment" | "complete";

interface OnboardingStore {
	flowType: FlowType;
	step: OnboardingStep;
	setFlowType: (type: FlowType) => void;
	setStep: (step: OnboardingStep) => void;
	reset: () => void;
}

export const useOnboardingStore = create<OnboardingStore>()(
	persist(
		(set) => ({
			flowType: null,
			step: "path",
			setFlowType: (flowType) => set({ flowType }),
			setStep: (step) => set({ step }),
			reset: () => set({ flowType: null, step: "path" }),
		}),
		{
			name: "onboarding-storage",
		},
	),
);
