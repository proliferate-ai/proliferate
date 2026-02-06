"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface CreatePrebuildInput {
	repoIds?: string[];
	repos?: Array<{ repoId: string; workspacePath?: string }>;
	name?: string;
}

interface UpdatePrebuildInput {
	name?: string;
	notes?: string;
}

export function usePrebuilds(status?: string) {
	return useQuery({
		...orpc.prebuilds.list.queryOptions({ input: status ? { status } : {} }),
		select: (data) => data.prebuilds,
	});
}

export function useCreatePrebuild() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.prebuilds.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.prebuilds.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listPrebuilds.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listSnapshots.key() });
		},
	});

	const mutateAsync = async (data: CreatePrebuildInput) => {
		const result = await mutation.mutateAsync(data);
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: CreatePrebuildInput) => {
			mutation.mutate(data);
		},
	};
}

export function useUpdatePrebuild() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.prebuilds.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.prebuilds.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listPrebuilds.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listSnapshots.key() });
		},
	});

	const mutateAsync = async (id: string, data: UpdatePrebuildInput) => {
		const result = await mutation.mutateAsync({ id, ...data });
		return result.prebuild;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string, data: UpdatePrebuildInput) => {
			mutation.mutate({ id, ...data });
		},
	};
}

export function useDeletePrebuild() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.prebuilds.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.prebuilds.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listPrebuilds.key() });
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
