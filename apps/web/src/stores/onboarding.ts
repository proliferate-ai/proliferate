"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FlowType = "developer" | "organization" | null;
export type OnboardingStep =
	| "path"
	| "create-org"
	| "questionnaire"
	| "tools"
	| "invite"
	| "billing"
	| "complete";

interface QuestionnaireData {
	referralSource: string;
	companyWebsite: string;
	teamSize: string;
}

interface OnboardingStore {
	flowType: FlowType;
	step: OnboardingStep;
	orgName: string;
	selectedTools: string[];
	questionnaire: QuestionnaireData;
	setFlowType: (type: FlowType) => void;
	setStep: (step: OnboardingStep) => void;
	setOrgName: (name: string) => void;
	setSelectedTools: (tools: string[]) => void;
	setQuestionnaire: (data: Partial<QuestionnaireData>) => void;
	reset: () => void;
}

const initialQuestionnaire: QuestionnaireData = {
	referralSource: "",
	companyWebsite: "",
	teamSize: "",
};

export const useOnboardingStore = create<OnboardingStore>()(
	persist(
		(set) => ({
			flowType: null,
			step: "path",
			orgName: "",
			selectedTools: [],
			questionnaire: initialQuestionnaire,
			setFlowType: (flowType) => set({ flowType }),
			setStep: (step) => set({ step }),
			setOrgName: (orgName) => set({ orgName }),
			setSelectedTools: (selectedTools) => set({ selectedTools }),
			setQuestionnaire: (data) =>
				set((state) => ({
					questionnaire: { ...state.questionnaire, ...data },
				})),
			reset: () =>
				set({
					flowType: null,
					step: "path",
					orgName: "",
					selectedTools: [],
					questionnaire: initialQuestionnaire,
				}),
		}),
		{
			name: "onboarding-storage",
		},
	),
);
