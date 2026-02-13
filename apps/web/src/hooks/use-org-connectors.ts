"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useOrgConnectors() {
	return useQuery({
		...orpc.integrations.listConnectors.queryOptions({}),
		select: (data) => data.connectors,
	});
}

export function useCreateOrgConnector() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.integrations.createConnector.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.integrations.listConnectors.key(),
				});
			},
		}),
	);
}

export function useUpdateOrgConnector() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.integrations.updateConnector.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.integrations.listConnectors.key(),
				});
			},
		}),
	);
}

export function useDeleteOrgConnector() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.integrations.deleteConnector.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.integrations.listConnectors.key(),
				});
			},
		}),
	);
}

export function useValidateOrgConnector() {
	return useMutation(orpc.integrations.validateConnector.mutationOptions());
}
