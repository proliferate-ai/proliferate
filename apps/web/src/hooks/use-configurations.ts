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
			queryClient.invalidateQueries({ queryKey: orpc.repos.listConfigurations.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listSnapshots.key() });
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
			queryClient.invalidateQueries({ queryKey: orpc.repos.listConfigurations.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listSnapshots.key() });
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
			queryClient.invalidateQueries({ queryKey: orpc.repos.listConfigurations.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listSnapshots.key() });
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
