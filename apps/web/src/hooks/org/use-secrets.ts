"use client";

import { orpc } from "@/lib/infra/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useSecrets() {
	return useQuery({
		...orpc.secrets.list.queryOptions({ input: {} }),
		select: (data) => data.secrets,
	});
}

export function useCreateSecret() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.secrets.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.secrets.list.key() });
		},
	});

	const mutateAsync = async (data: { key: string; value: string }) => {
		const result = await mutation.mutateAsync(data);
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: { key: string; value: string }) => {
			mutation.mutate(data);
		},
	};
}

export function useDeleteSecret() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.secrets.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.secrets.list.key() });
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

export function useUpdateSecretValue() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.secrets.updateValue.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.secrets.list.key() });
		},
	});
}

export function useAddRepoBinding() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.secrets.addRepoBinding.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.secrets.list.key() });
		},
	});
}

export function useRemoveRepoBinding() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.secrets.removeRepoBinding.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.secrets.list.key() });
		},
	});
}
