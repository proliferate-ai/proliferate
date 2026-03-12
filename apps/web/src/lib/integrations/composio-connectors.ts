import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import type { ConnectorConfig } from "@proliferate/shared";
import { getConnectorPresetByKey } from "@proliferate/shared";

export function resolveActiveComposioConnector(
	entry: CatalogEntry,
	connectors: ConnectorConfig[] | undefined,
): ConnectorConfig | undefined {
	if (entry.type !== "composio-oauth" || !entry.presetKey) {
		return undefined;
	}

	const preset = getConnectorPresetByKey(entry.presetKey);
	if (!preset?.composioToolkit) {
		return undefined;
	}

	return (connectors ?? []).find(
		(connector) =>
			connector.composioToolkit === preset.composioToolkit &&
			connector.enabled &&
			typeof connector.composioAccountId === "string" &&
			connector.composioAccountId.length > 0,
	);
}
