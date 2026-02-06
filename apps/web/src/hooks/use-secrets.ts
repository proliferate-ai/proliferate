"use client";

import { orpc } from "@/lib/orpc";
import type { CheckSecretsInput, CreateSecretInput } from "@proliferate/shared";
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

	const mutateAsync = async (data: CreateSecretInput) => {
		const result = await mutation.mutateAsync(data);
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: CreateSecretInput) => {
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

export function useCheckSecrets() {
	const mutation = useMutation(orpc.secrets.check.mutationOptions());

	const mutateAsync = async (data: CheckSecretsInput) => {
		const result = await mutation.mutateAsync(data);
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: CheckSecretsInput) => {
			mutation.mutate(data);
		},
	};
}
