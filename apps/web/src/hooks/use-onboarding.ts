"use client";

import { orpc } from "@/lib/orpc";
import type { OnboardingRepo, OnboardingStatus } from "@proliferate/shared";
import { useQuery } from "@tanstack/react-query";

export interface OnboardingState extends OnboardingStatus {
	hasRepos: boolean;
}

// Re-export the Repo type from the contract for backwards compatibility
export type Repo = OnboardingRepo;

export function useOnboarding() {
	return useQuery({
		...orpc.onboarding.getStatus.queryOptions({ input: undefined }),
		select: (data): OnboardingState => {
			return {
				...data,
				hasRepos: data.repos.length > 0,
			};
		},
	});
}
