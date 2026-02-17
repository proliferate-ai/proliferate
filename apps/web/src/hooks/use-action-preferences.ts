"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useActionPreferences() {
	return useQuery({
		...orpc.userActionPreferences.list.queryOptions({}),
		select: (data) => data.preferences,
	});
}

/**
 * Returns a Set of source IDs that the user has explicitly disabled.
 */
export function useDisabledSourceIds(): Set<string> {
	const { data: preferences } = useActionPreferences();
	if (!preferences) return new Set();

	const disabled = new Set<string>();
	for (const pref of preferences) {
		if (!pref.actionId && !pref.enabled) {
			disabled.add(pref.sourceId);
		}
	}
	return disabled;
}

export function useToggleActionPreference() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.userActionPreferences.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.userActionPreferences.list.key(),
				});
			},
		}),
	);
}
