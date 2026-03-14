"use client";

import { orpc } from "@/lib/infra/orpc";
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
		select: (data) => data,
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

export function useRepoSnapshots(repoId: string, enabled = true) {
	return useQuery({
		...orpc.repos.listSnapshots.queryOptions({ input: { repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.snapshots,
	});
}
