"use client";

import { orpc } from "@/lib/infra/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

interface ActionPreferenceRow {
	sourceId: string;
	actionId: string | null;
	enabled: boolean;
}

export interface ActionPreferenceIndex {
	disabledSourceIds: Set<string>;
	disabledActionsBySource: Map<string, Set<string>>;
	isActionEnabled: (sourceId: string, actionId: string) => boolean;
}

function buildActionPreferenceIndex(
	preferences: ActionPreferenceRow[] | undefined,
): ActionPreferenceIndex {
	const disabledSourceIds = new Set<string>();
	const disabledActionsBySource = new Map<string, Set<string>>();

	for (const preference of preferences ?? []) {
		if (preference.enabled) {
			continue;
		}

		if (!preference.actionId) {
			disabledSourceIds.add(preference.sourceId);
			continue;
		}

		const existing = disabledActionsBySource.get(preference.sourceId);
		if (existing) {
			existing.add(preference.actionId);
			continue;
		}

		disabledActionsBySource.set(preference.sourceId, new Set([preference.actionId]));
	}

	return {
		disabledSourceIds,
		disabledActionsBySource,
		isActionEnabled: (sourceId: string, actionId: string) => {
			if (disabledSourceIds.has(sourceId)) {
				return false;
			}
			return !disabledActionsBySource.get(sourceId)?.has(actionId);
		},
	};
}

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
	return useMemo(() => buildActionPreferenceIndex(preferences).disabledSourceIds, [preferences]);
}

export function useActionPreferenceIndex(): ActionPreferenceIndex {
	const { data: preferences } = useActionPreferences();
	return useMemo(() => buildActionPreferenceIndex(preferences), [preferences]);
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

export function useSetActionPreference() {
	return useToggleActionPreference();
}
