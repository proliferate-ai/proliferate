import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import type { Provider } from "@/components/integrations/provider-icon";
import type { ConnectorConfig } from "@proliferate/shared";
import { useCallback, useMemo, useState } from "react";

interface UseIntegrationDialogsOptions {
	connectors: ConnectorConfig[] | undefined;
	searchQuery: string;
	disconnectOAuth: (provider: Provider, integrationId: string) => Promise<void>;
	handleSlackDisconnect: () => Promise<void>;
	handleRemoveConnector: (id: string) => Promise<void>;
}

export type IntegrationDetailTab = "connect" | "about" | "settings";

export function useIntegrationDialogs({
	connectors,
	searchQuery,
	disconnectOAuth,
	handleSlackDisconnect,
	handleRemoveConnector,
}: UseIntegrationDialogsOptions) {
	// ---- Picker / detail dialog state ----
	const [pickerOpen, setPickerOpen] = useState(false);
	const [selectedEntry, setSelectedEntry] = useState<CatalogEntry | null>(null);
	const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
	const [selectedDetailTab, setSelectedDetailTab] = useState<IntegrationDetailTab | null>(null);
	const [openedFromPicker, setOpenedFromPicker] = useState(false);

	// ---- Disconnect confirmation ----
	const [disconnectTarget, setDisconnectTarget] = useState<{
		entry: CatalogEntry;
		integrationId?: string;
	} | null>(null);

	// ---- Connector delete confirmation ----
	const [deleteConnectorTarget, setDeleteConnectorTarget] = useState<string | null>(null);

	// ---- Dialog navigation ----
	const handleSelectFromPicker = useCallback((entry: CatalogEntry) => {
		setPickerOpen(false);
		setSelectedEntry(entry);
		setSelectedConnectorId(null);
		setSelectedDetailTab(null);
		setOpenedFromPicker(true);
	}, []);

	const handleSelectFromRow = useCallback((entry: CatalogEntry, tab?: IntegrationDetailTab) => {
		setSelectedEntry(entry);
		setSelectedConnectorId(null);
		setSelectedDetailTab(tab ?? null);
		setOpenedFromPicker(false);
	}, []);

	const handleSelectConnectorRow = useCallback(
		(connector: ConnectorConfig, tab?: IntegrationDetailTab) => {
			setSelectedEntry({
				key: `connector:${connector.id}`,
				name: connector.name,
				description: connector.url,
				category: "developer-tools",
				type: "custom-mcp",
			});
			setSelectedConnectorId(connector.id);
			setSelectedDetailTab(tab ?? null);
			setOpenedFromPicker(false);
		},
		[],
	);

	const handleDetailBack = useCallback(() => {
		setSelectedEntry(null);
		setSelectedConnectorId(null);
		setSelectedDetailTab(null);
		setPickerOpen(true);
	}, []);

	const handleDetailOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				setSelectedEntry(null);
				setSelectedConnectorId(null);
				setSelectedDetailTab(null);
				if (openedFromPicker) {
					setPickerOpen(false);
				}
			}
		},
		[openedFromPicker],
	);

	// ---- Disconnect confirm ----
	const handleConfirmDisconnect = useCallback(async () => {
		if (!disconnectTarget) return;
		const { entry, integrationId } = disconnectTarget;

		if (entry.type === "oauth" && entry.provider && integrationId) {
			await disconnectOAuth(entry.provider, integrationId);
		} else if (entry.type === "slack") {
			await handleSlackDisconnect();
		}
		setDisconnectTarget(null);
	}, [disconnectTarget, disconnectOAuth, handleSlackDisconnect]);

	// ---- Connector delete confirm ----
	const handleConfirmDeleteConnector = useCallback(async () => {
		if (!deleteConnectorTarget) return;
		await handleRemoveConnector(deleteConnectorTarget);
		setDeleteConnectorTarget(null);
	}, [deleteConnectorTarget, handleRemoveConnector]);

	// ---- Filtered connectors ----
	const filteredConnectors = useMemo(() => {
		let list = connectors ?? [];
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			list = list.filter(
				(c: ConnectorConfig) => c.name.toLowerCase().includes(q) || c.url.toLowerCase().includes(q),
			);
		}
		return list;
	}, [connectors, searchQuery]);

	return {
		pickerOpen,
		setPickerOpen,
		selectedEntry,
		selectedConnectorId,
		selectedDetailTab,
		setSelectedEntry,
		openedFromPicker,
		disconnectTarget,
		setDisconnectTarget,
		deleteConnectorTarget,
		setDeleteConnectorTarget,
		filteredConnectors,
		handleSelectFromPicker,
		handleSelectFromRow,
		handleSelectConnectorRow,
		handleDetailBack,
		handleDetailOpenChange,
		handleConfirmDisconnect,
		handleConfirmDeleteConnector,
	};
}
