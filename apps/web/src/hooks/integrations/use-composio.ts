"use client";

import { orpc } from "@/lib/infra/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Check if Composio OAuth is available (COMPOSIO_API_KEY is set on the server).
 */
export function useComposioAvailable() {
	return useQuery({
		...orpc.integrations.composioAvailable.queryOptions({ input: undefined }),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

/**
 * Disconnect a Composio-managed connector.
 */
export function useDisconnectComposioConnector() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (id: string) => {
			return orpc.integrations.disconnectComposioConnector.call({ id });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.listConnectors.key() });
			queryClient.invalidateQueries({ queryKey: orpc.integrations.composioConnectionStatus.key() });
		},
	});
}
