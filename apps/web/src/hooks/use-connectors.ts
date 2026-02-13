"use client";

import { orpc } from "@/lib/orpc";
import type { ConnectorConfig } from "@proliferate/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useConnectors(prebuildId: string, enabled = true) {
	return useQuery({
		...orpc.prebuilds.getConnectors.queryOptions({ input: { prebuildId } }),
		enabled: enabled && !!prebuildId,
		select: (data) => data.connectors,
	});
}

export function useUpdateConnectors() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.prebuilds.updateConnectors.mutationOptions({
			onSuccess: (_data, input) => {
				queryClient.invalidateQueries({
					queryKey: orpc.prebuilds.getConnectors.key({
						input: { prebuildId: input.prebuildId },
					}),
				});
			},
		}),
	);
}

export function useValidateConnector() {
	return useMutation(orpc.prebuilds.validateConnector.mutationOptions());
}

/** Helper to build the mutation input shape. */
export function buildUpdateInput(prebuildId: string, connectors: ConnectorConfig[]) {
	return { prebuildId, connectors };
}
