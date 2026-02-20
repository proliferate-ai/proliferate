"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface CreateConfigurationInput {
	repoIds?: string[];
	repos?: Array<{ repoId: string; workspacePath?: string }>;
	name?: string;
}

interface UpdateConfigurationInput {
	name?: string;
	notes?: string;
	routingDescription?: string | null;
}

export function useConfigurations(status?: string) {
	return useQuery({
		...orpc.configurations.list.queryOptions({ input: status ? { status } : {} }),
		select: (data) => data.configurations,
	});
}

export function useCreateConfiguration() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.configurations.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.configurations.list.key() });
		},
	});

	const mutateAsync = async (data: CreateConfigurationInput) => {
		const result = await mutation.mutateAsync(data);
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: CreateConfigurationInput) => {
			mutation.mutate(data);
		},
	};
}

export function useUpdateConfiguration() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.configurations.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.configurations.list.key() });
		},
	});

	const mutateAsync = async (id: string, data: UpdateConfigurationInput) => {
		const result = await mutation.mutateAsync({ id, ...data });
		return result.configuration;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string, data: UpdateConfigurationInput) => {
			mutation.mutate({ id, ...data });
		},
	};
}

export function useDeleteConfiguration() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.configurations.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.configurations.list.key() });
		},
	});

	const mutateAsync = async (id: string) => {
		const result = await mutation.mutateAsync({ id });
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string) => {
			mutation.mutate({ id });
		},
	};
}

export function useConfigurationEnvFiles(configurationId: string, enabled = true) {
	return useQuery({
		...orpc.configurations.getEnvFiles.queryOptions({ input: { configurationId } }),
		enabled: enabled && !!configurationId,
		select: (data) => data.envFiles,
	});
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

export function useAttachRepo() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.configurations.attachRepo.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.configurations.list.key() });
			},
		}),
	);
}

export function useDetachRepo() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.configurations.detachRepo.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.configurations.list.key() });
			},
		}),
	);
}
