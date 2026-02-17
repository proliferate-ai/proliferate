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

export function useCheckSecrets(
	keys: string[],
	repoId?: string,
	configurationId?: string,
	enabled = true,
) {
	return useQuery({
		...orpc.secrets.check.queryOptions({
			input: { keys, repo_id: repoId, configuration_id: configurationId },
		}),
		enabled: enabled && keys.length > 0,
		select: (data) => data.keys,
	});
}

export function useCreateSecret() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.secrets.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.secrets.check.key() });
			},
		}),
	);
}
