"use client";

import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import type { Provider } from "@/components/integrations/provider-icon";
import { INTEGRATION_CATALOG } from "@/config/integrations";
import type { IntegrationWithCreator } from "@proliferate/shared/contracts/integrations";
import { useCallback, useMemo } from "react";

interface UseIntegrationStatusOptions {
	integrationsByProvider: Record<Provider, IntegrationWithCreator[]>;
	slackStatus:
		| {
				connected: boolean;
				teamName?: string | null;
				supportChannel?: { channelName: string | null } | null;
		  }
		| undefined;
	loadingProvider: Provider | null;
	slackDisconnectIsPending: boolean;
	searchQuery: string;
}

export function useIntegrationStatus({
	integrationsByProvider,
	slackStatus,
	loadingProvider,
	slackDisconnectIsPending,
	searchQuery,
}: UseIntegrationStatusOptions) {
	const getConnectionStatus = useCallback(
		(entry: CatalogEntry): boolean => {
			switch (entry.type) {
				case "oauth":
					return entry.provider ? (integrationsByProvider[entry.provider]?.length ?? 0) > 0 : false;
				case "slack":
					return slackStatus?.connected ?? false;
				case "mcp-preset":
					return false;
				default:
					return false;
			}
		},
		[integrationsByProvider, slackStatus],
	);

	const getLoadingStatus = useCallback(
		(entry: CatalogEntry): boolean => {
			switch (entry.type) {
				case "oauth":
					return loadingProvider === entry.provider;
				case "slack":
					return slackDisconnectIsPending;
				case "mcp-preset":
					return false;
				default:
					return false;
			}
		},
		[loadingProvider, slackDisconnectIsPending],
	);

	const getConnectedMeta = useCallback(
		(entry: CatalogEntry): string | null => {
			if (entry.type === "oauth" && entry.provider) {
				const providerIntegrations = integrationsByProvider[entry.provider];
				if (providerIntegrations?.length > 0) {
					const first = providerIntegrations[0];
					return first.creator?.name || first.creator?.email || null;
				}
			}
			if (entry.type === "slack" && slackStatus?.connected) {
				return slackStatus.teamName || null;
			}
			return null;
		},
		[integrationsByProvider, slackStatus],
	);

	const connectedEntries = useMemo(() => {
		let entries = INTEGRATION_CATALOG.filter((entry) => getConnectionStatus(entry));

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			entries = entries.filter(
				(e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
			);
		}

		return entries;
	}, [getConnectionStatus, searchQuery]);

	return {
		getConnectionStatus,
		getLoadingStatus,
		getConnectedMeta,
		connectedEntries,
	};
}
