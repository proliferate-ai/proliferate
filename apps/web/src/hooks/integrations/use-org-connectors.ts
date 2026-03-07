"use client";

import { orpc } from "@/lib/infra/orpc";
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

export function useCreateOrgConnectorWithSecret() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.integrations.createConnectorWithSecret.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.integrations.listConnectors.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.secrets.list.key(),
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

export function useConnectorActions(connectorId?: string) {
	return useQuery({
		...orpc.integrations.getConnectorActions.queryOptions({
			input: { id: connectorId ?? "" },
		}),
		enabled: Boolean(connectorId),
	});
}
