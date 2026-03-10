"use client";

import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import type { Provider } from "@/components/integrations/provider-icon";
import { INTEGRATION_CATALOG } from "@/config/integrations";
import type { ConnectorConfig } from "@proliferate/shared";
import { getConnectorPresetByKey } from "@proliferate/shared";
import type { IntegrationWithCreator } from "@proliferate/shared/contracts/integrations";
import { useCallback, useMemo } from "react";

interface UseIntegrationStatusOptions {
	integrationsByProvider: Record<Provider, IntegrationWithCreator[]>;
	allIntegrations?: IntegrationWithCreator[];
	connectors?: ConnectorConfig[];
	slackStatus:
		| {
				connected: boolean;
				teamName?: string | null;
				supportChannel?: { channelName: string | null } | null;
		  }
		| undefined;
	loadingProvider: Provider | null;
	slackDisconnectIsPending: boolean;
	composioDisconnectIsPending?: boolean;
	searchQuery: string;
}

export function useIntegrationStatus({
	integrationsByProvider,
	allIntegrations,
	connectors,
	slackStatus,
	loadingProvider,
	slackDisconnectIsPending,
	composioDisconnectIsPending,
	searchQuery,
}: UseIntegrationStatusOptions) {
	const getConnectionStatus = useCallback(
		(entry: CatalogEntry): boolean => {
			switch (entry.type) {
				case "oauth":
					return entry.provider ? (integrationsByProvider[entry.provider]?.length ?? 0) > 0 : false;
				case "slack":
					return slackStatus?.connected ?? false;
				case "direct":
					return (allIntegrations ?? []).some(
						(i) => i.integration_id === entry.key && i.status === "active",
					);
				case "composio-oauth": {
					const preset = entry.presetKey ? getConnectorPresetByKey(entry.presetKey) : undefined;
					const connector = preset?.composioToolkit
						? (connectors ?? []).find(
								(c) => c.composioToolkit === preset.composioToolkit && c.enabled,
							)
						: undefined;
					return !!connector;
				}
				case "mcp-preset":
					return false;
				default:
					return false;
			}
		},
		[integrationsByProvider, slackStatus, allIntegrations, connectors],
	);

	const getLoadingStatus = useCallback(
		(entry: CatalogEntry): boolean => {
			switch (entry.type) {
				case "oauth":
					return loadingProvider === entry.provider;
				case "slack":
					return slackDisconnectIsPending;
				case "composio-oauth":
					return composioDisconnectIsPending ?? false;
				case "mcp-preset":
					return false;
				default:
					return false;
			}
		},
		[loadingProvider, slackDisconnectIsPending, composioDisconnectIsPending],
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
			if (entry.type === "direct") {
				const match = (allIntegrations ?? []).find(
					(i) => i.integration_id === entry.key && i.status === "active",
				);
				return match?.creator?.name || match?.display_name || null;
			}
			if (entry.type === "composio-oauth") {
				const preset = entry.presetKey ? getConnectorPresetByKey(entry.presetKey) : undefined;
				const connector = preset?.composioToolkit
					? (connectors ?? []).find(
							(c) => c.composioToolkit === preset.composioToolkit && c.enabled,
						)
					: undefined;
				return connector?.name || null;
			}
			return null;
		},
		[integrationsByProvider, slackStatus, allIntegrations, connectors],
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
