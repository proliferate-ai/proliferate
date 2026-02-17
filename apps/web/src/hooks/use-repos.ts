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

export function useRepoConfigurations(repoId: string, enabled = true) {
	return useQuery({
		...orpc.repos.listConfigurations.queryOptions({ input: { id: repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.configurations,
	});
}

export function useRepoSnapshots(repoId: string, enabled = true) {
	return useQuery({
		...orpc.repos.listSnapshots.queryOptions({ input: { id: repoId } }),
		enabled: enabled && !!repoId,
		select: (data) => data.configurations,
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

export function useConfigurationEnvFiles(configurationId: string, enabled = true) {
	return useQuery({
		...orpc.configurations.getEnvFiles.queryOptions({ input: { configurationId } }),
		enabled: enabled && !!configurationId,
		select: (data) => data.envFiles,
	});
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

export function useConfigurationServiceCommands(configurationId: string, enabled = true) {
	return useQuery({
		...orpc.configurations.getServiceCommands.queryOptions({ input: { configurationId } }),
		enabled: enabled && !!configurationId,
		select: (data) => data.commands,
	});
}

export function useEffectiveServiceCommands(configurationId: string, enabled = true) {
	return useQuery({
		...orpc.configurations.getEffectiveServiceCommands.queryOptions({ input: { configurationId } }),
		enabled: enabled && !!configurationId,
	});
}

export function useUpdateConfigurationServiceCommands() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.configurations.updateServiceCommands.mutationOptions({
			onSuccess: (_data, input) => {
				queryClient.invalidateQueries({
					queryKey: orpc.configurations.getServiceCommands.key({
						input: { configurationId: input.configurationId },
					}),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.configurations.getEffectiveServiceCommands.key({
						input: { configurationId: input.configurationId },
					}),
				});
			},
		}),
	);
}
