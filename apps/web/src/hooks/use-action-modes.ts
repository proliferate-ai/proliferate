"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Org-level action modes (3-mode permission cascade).
 */
export function useActionModes() {
	return useQuery(orpc.orgs.getActionModes.queryOptions({ input: {} }));
}

/**
 * Set a single org-level action mode entry.
 */
export function useSetActionMode() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.orgs.setActionMode.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.orgs.getActionModes.queryOptions({ input: {} }).queryKey,
			});
		},
	});
}

/**
 * Automation-level action modes.
 */
export function useAutomationActionModes(automationId: string) {
	return useQuery(orpc.automations.getActionModes.queryOptions({ input: { id: automationId } }));
}

/**
 * Set a single automation-level action mode entry.
 */
export function useSetAutomationActionMode(automationId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.automations.setActionMode.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.getActionModes.queryOptions({ input: { id: automationId } })
					.queryKey,
			});
		},
	});
}
