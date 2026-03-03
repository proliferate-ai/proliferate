"use client";

import { orpc } from "@/lib/infra/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useActiveBaseline(repoId: string, enabled = true) {
	return useQuery({
		...orpc.baselines.getActive.queryOptions({ input: { repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.baseline,
	});
}

export function useBaselines(repoId: string, enabled = true) {
	return useQuery({
		...orpc.baselines.list.queryOptions({ input: { repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.baselines,
	});
}

export function useActiveBaselinesByRepos(repoIds: string[], enabled = true) {
	return useQuery({
		...orpc.baselines.listActiveByRepos.queryOptions({ input: { repoIds } }),
		enabled: enabled && repoIds.length > 0,
		select: (data) => data.baselines,
	});
}

export function useBaselineTargets(baselineId: string, enabled = true) {
	return useQuery({
		...orpc.baselines.listTargets.queryOptions({ input: { baselineId } }),
		enabled: enabled && !!baselineId,
		select: (data) => data.targets,
	});
}

export function useBaselineTargetCount(baselineId: string, enabled = true) {
	return useQuery({
		...orpc.baselines.getTargetCount.queryOptions({ input: { baselineId } }),
		enabled: enabled && !!baselineId,
		select: (data) => data.count,
	});
}

export function useCreateBaseline() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.baselines.create.mutationOptions({
			onSuccess: (_data, input) => {
				queryClient.invalidateQueries({
					queryKey: orpc.baselines.list.key({ input: { repoId: input.repoId } }),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.baselines.getActive.key({ input: { repoId: input.repoId } }),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.baselines.listActiveByRepos.key(),
				});
			},
		}),
	);
}

export function useMarkBaselineReady() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.baselines.markReady.mutationOptions({
			onSuccess: (_data, input) => {
				queryClient.invalidateQueries({
					queryKey: orpc.baselines.list.key({ input: { repoId: input.repoId } }),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.baselines.getActive.key({ input: { repoId: input.repoId } }),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.baselines.listActiveByRepos.key(),
				});
			},
		}),
	);
}

export function useMarkBaselineStale() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.baselines.markStale.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.baselines.key() });
			},
		}),
	);
}

export function useRestartValidation() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.baselines.restartValidation.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.baselines.key() });
			},
		}),
	);
}

export function useCheckSetupInvariant(repoId: string, enabled = true) {
	return useQuery({
		...orpc.baselines.checkSetupInvariant.queryOptions({ input: { repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.existingSessionId,
	});
}

export function useLatestSetupSession(repoId: string, enabled = true) {
	return useQuery({
		...orpc.baselines.getLatestSetupSession.queryOptions({ input: { repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.session,
	});
}
