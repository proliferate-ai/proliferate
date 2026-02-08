"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useRepos() {
	return useQuery({
		...orpc.repos.list.queryOptions({ input: {} }),
		select: (data) => data.repos,
	});
}

export function useRepo(id: string) {
	return useQuery({
		...orpc.repos.get.queryOptions({ input: { id } }),
		enabled: !!id,
		select: (data) => data.repo,
	});
}

export function useCreateRepo() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.repos.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.repos.list.key() });
			},
		}),
	);
}

export function useDeleteRepo() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.repos.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.repos.list.key() });
			},
		}),
	);
}

export function useRepoPrebuilds(repoId: string, enabled = true) {
	return useQuery({
		...orpc.repos.listPrebuilds.queryOptions({ input: { id: repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.prebuilds,
	});
}

export function useRepoSnapshots(repoId: string, enabled = true) {
	return useQuery({
		...orpc.repos.listSnapshots.queryOptions({ input: { id: repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.prebuilds,
	});
}

export function useAvailableRepos(integrationId?: string) {
	return useQuery({
		...orpc.repos.available.queryOptions({ input: { integrationId } }),
		select: (data) => data,
	});
}

export function useSearchRepos(query: string, enabled = true) {
	return useQuery({
		...orpc.repos.search.queryOptions({ input: { q: query } }),
		enabled: enabled && query.length >= 2,
		select: (data) => data.repositories,
	});
}

export function useServiceCommands(repoId: string, enabled = true) {
	return useQuery({
		...orpc.repos.getServiceCommands.queryOptions({ input: { id: repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.commands,
	});
}

export function useUpdateServiceCommands() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.repos.updateServiceCommands.mutationOptions({
			onSuccess: (_data, input) => {
				queryClient.invalidateQueries({
					queryKey: orpc.repos.getServiceCommands.key({ input: { id: input.id } }),
				});
				queryClient.invalidateQueries({ queryKey: orpc.repos.list.key() });
			},
		}),
	);
}

export function usePrebuildServiceCommands(prebuildId: string, enabled = true) {
	return useQuery({
		...orpc.prebuilds.getServiceCommands.queryOptions({ input: { prebuildId } }),
		enabled: enabled && !!prebuildId,
		select: (data) => data.commands,
	});
}

export function useEffectiveServiceCommands(prebuildId: string, enabled = true) {
	return useQuery({
		...orpc.prebuilds.getEffectiveServiceCommands.queryOptions({ input: { prebuildId } }),
		enabled: enabled && !!prebuildId,
	});
}

export function useUpdatePrebuildServiceCommands() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.prebuilds.updateServiceCommands.mutationOptions({
			onSuccess: (_data, input) => {
				queryClient.invalidateQueries({
					queryKey: orpc.prebuilds.getServiceCommands.key({
						input: { prebuildId: input.prebuildId },
					}),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.prebuilds.getEffectiveServiceCommands.key({
						input: { prebuildId: input.prebuildId },
					}),
				});
			},
		}),
	);
}
