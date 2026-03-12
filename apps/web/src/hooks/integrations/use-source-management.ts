"use client";

import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import {
	useDisabledSourceIds,
	useToggleActionPreference,
} from "@/hooks/actions/use-action-preferences";
import { resolveActiveComposioConnector } from "@/lib/integrations/composio-connectors";
import type { ConnectorConfig } from "@proliferate/shared";
import { useCallback } from "react";

export function useSourceManagement(connectors: ConnectorConfig[] | undefined) {
	const disabledSourceIds = useDisabledSourceIds();
	const togglePreference = useToggleActionPreference();

	const getSourceId = useCallback(
		(entry: CatalogEntry): string | null => {
			if (entry.type === "oauth" && entry.provider) return entry.provider;
			if (entry.type === "slack") return "slack";
			if (entry.type === "composio-oauth" && entry.presetKey) {
				const connector = resolveActiveComposioConnector(entry, connectors);
				return connector ? `connector:${connector.id}` : null;
			}
			if (entry.type === "mcp-preset" && entry.presetKey) {
				const connector = (connectors ?? []).find(
					(c: ConnectorConfig) => c.name.toLowerCase() === entry.name.toLowerCase(),
				);
				return connector ? `connector:${connector.id}` : null;
			}
			return null;
		},
		[connectors],
	);

	const isSourceEnabled = useCallback(
		(entry: CatalogEntry): boolean => {
			const sourceId = getSourceId(entry);
			if (!sourceId) return true;
			return !disabledSourceIds.has(sourceId);
		},
		[getSourceId, disabledSourceIds],
	);

	const handleToggleSource = useCallback(
		(entry: CatalogEntry) => {
			const sourceId = getSourceId(entry);
			if (!sourceId) return;
			const currentlyEnabled = !disabledSourceIds.has(sourceId);
			togglePreference.mutate({ sourceId, enabled: !currentlyEnabled });
		},
		[getSourceId, disabledSourceIds, togglePreference],
	);

	const handleToggleConnectorSource = useCallback(
		(connectorId: string) => {
			const sourceId = `connector:${connectorId}`;
			const currentlyEnabled = !disabledSourceIds.has(sourceId);
			togglePreference.mutate({ sourceId, enabled: !currentlyEnabled });
		},
		[disabledSourceIds, togglePreference],
	);

	const isConnectorEnabled = useCallback(
		(connectorId: string): boolean => {
			return !disabledSourceIds.has(`connector:${connectorId}`);
		},
		[disabledSourceIds],
	);

	return {
		isSourceEnabled,
		handleToggleSource,
		handleToggleConnectorSource,
		isConnectorEnabled,
		togglePreferenceIsPending: togglePreference.isPending,
	};
}
