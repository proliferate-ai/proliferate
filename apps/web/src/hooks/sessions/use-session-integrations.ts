"use client";

import type { IntegrationSummary } from "@/components/dashboard/capabilities-badges";
import { useSessionAvailableActions } from "@/hooks/actions/use-actions";
import { getProviderForIntegration } from "@/lib/integrations/capability-utils";
import { useMemo } from "react";

export function useSessionIntegrationSummaries(
	sessionId?: string,
	token?: string | null,
): IntegrationSummary[] {
	const { data: integrations } = useSessionAvailableActions(sessionId ?? "", token ?? null);
	return useMemo(() => {
		if (!integrations) return [];
		return integrations
			.filter((entry) => entry.actions.length > 0)
			.map((entry) => ({
				id: entry.integrationId,
				displayName: entry.displayName,
				detail: `${entry.actions.length} action${entry.actions.length !== 1 ? "s" : ""} enabled`,
				provider: getProviderForIntegration(entry.integration),
			}));
	}, [integrations]);
}
