"use client";

import { orpc } from "@/lib/orpc";
import type {
	FinalizeOnboardingInput,
	OnboardingRepo,
	OnboardingStatus,
} from "@proliferate/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface OnboardingState extends OnboardingStatus {
	hasRepos: boolean;
	hasReadyPrebuild: boolean;
}

// Re-export the Repo type from the contract for backwards compatibility
export type Repo = OnboardingRepo;

export function useOnboarding() {
	return useQuery({
		...orpc.onboarding.getStatus.queryOptions({ input: undefined }),
		select: (data): OnboardingState => {
			const hasReadyPrebuild = data.repos.some(
				(repo) => repo.prebuild_status === "ready" || repo.repo_snapshot_status === "ready",
			);
			return {
				...data,
				hasRepos: data.repos.length > 0,
				hasReadyPrebuild,
			};
		},
	});
}

export function useFinalizeOnboarding() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.onboarding.finalize.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.onboarding.getStatus.key() });
		},
	});

	const mutateAsync = async (data: FinalizeOnboardingInput) => {
		const result = await mutation.mutateAsync(data);
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: FinalizeOnboardingInput) => {
			mutation.mutate(data);
		},
	};
}
