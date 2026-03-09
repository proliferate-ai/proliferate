"use client";

import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import { INTEGRATION_CATALOG } from "@/config/integrations";
import { useIntegrationActions } from "@/hooks/integrations/use-integration-actions";
import { useIntegrationDialogs } from "@/hooks/integrations/use-integration-dialogs";
import { useIntegrationStatus } from "@/hooks/integrations/use-integration-status";
import { useSlackConfig, useUpdateSlackConfig } from "@/hooks/integrations/use-integrations";
import { useOAuthConnections } from "@/hooks/integrations/use-oauth-connections";
import { useSourceManagement } from "@/hooks/integrations/use-source-management";
import { useOrgMembers } from "@/hooks/org/use-orgs";
import { useConfigurations } from "@/hooks/sessions/use-configurations";
import { useActiveOrganization, useSession } from "@/lib/auth/client";
import { type OrgRole, hasRoleOrHigher } from "@/lib/auth/roles";
import { useCallback, useMemo, useState } from "react";

// TODO: break this hook into smaller, focused hooks (e.g. useSlackConfig, useConnectorManagement, useIntegrationPicker)
export function useIntegrationsPage() {
	// ---- Role detection ----
	const { data: activeOrg } = useActiveOrganization();
	const { data: authSession } = useSession();
	const currentUserId = authSession?.user?.id;
	const { data: members } = useOrgMembers(activeOrg?.id ?? "");
	const currentUserRole = members?.find((m: { userId: string }) => m.userId === currentUserId)
		?.role as OrgRole | undefined;
	const isAdmin = currentUserRole ? hasRoleOrHigher(currentUserRole, "admin") : false;

	// ---- Search state ----
	const [searchQuery, setSearchQuery] = useState("");

	// ---- OAuth connections ----
	const {
		connectOAuth,
		disconnectOAuth,
		loadingProvider,
		integrationsLoading,
		integrationsByProvider,
		allIntegrations,
		slackStatus,
		slackDisconnect,
		slackConnect,
		handleSlackDisconnect,
		handleConnect,
	} = useOAuthConnections();

	// ---- MCP connector actions ----
	const {
		connectors,
		connectorsLoading,
		editingId,
		setEditingId,
		updateMutationIsPending,
		handleRemove,
		handleToggle,
		handleSave,
	} = useIntegrationActions();

	// ---- Source preferences ----
	const {
		isSourceEnabled,
		handleToggleSource,
		handleToggleConnectorSource,
		isConnectorEnabled,
		togglePreferenceIsPending,
	} = useSourceManagement(connectors);

	// ---- Integration status helpers ----
	const { getConnectionStatus, getLoadingStatus, getConnectedMeta, connectedEntries } =
		useIntegrationStatus({
			integrationsByProvider,
			allIntegrations,
			slackStatus,
			loadingProvider,
			slackDisconnectIsPending: slackDisconnect.isPending,
			searchQuery,
		});

	// ---- Dialog state ----
	const {
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
	} = useIntegrationDialogs({
		connectors,
		searchQuery,
		disconnectOAuth,
		handleSlackDisconnect,
		handleRemoveConnector: handleRemove,
	});

	// ---- Slack config ----
	const { data: slackConfig } = useSlackConfig();
	const updateSlackConfig = useUpdateSlackConfig();
	const { data: rawConfigurations } = useConfigurations();
	const readyConfigurations = useMemo(
		() => (rawConfigurations ?? []).filter((c) => c.status === "ready" || c.status === "default"),
		[rawConfigurations],
	);

	// ---- Slack connect form state ----
	const [showSlackConnectForm, setShowSlackConnectForm] = useState(false);
	const [slackConnectChannelName, setSlackConnectChannelName] = useState("");

	const handleCreateSlackConnect = useCallback(async () => {
		if (!slackConnectChannelName.trim()) return;
		try {
			await slackConnect.mutateAsync({
				channelName: `proliferate-${slackConnectChannelName.trim()}`,
			});
			setShowSlackConnectForm(false);
			setSlackConnectChannelName("");
		} catch (_err) {
			// Slack Connect channel creation error is surfaced via mutation state
		}
	}, [slackConnectChannelName, slackConnect]);

	const handleCancelSlackConnectForm = useCallback(() => {
		setShowSlackConnectForm(false);
		setSlackConnectChannelName("");
	}, []);

	// ---- Derived values ----
	const hasConnectedIntegrations = connectedEntries.length > 0 || (connectors ?? []).length > 0;
	const pickerCatalog = INTEGRATION_CATALOG;

	const getDisconnectDescription = useCallback((entry: CatalogEntry) => {
		if (entry.provider === "github") {
			return "Repos using this connection will be marked as orphaned until reconnected.";
		}
		const name = entry.name;
		return `Triggers and automations using this ${name} connection will stop working.`;
	}, []);

	const handleSetDisconnectTargetForEntry = useCallback(
		(entry: CatalogEntry) => {
			setDisconnectTarget({
				entry,
				integrationId:
					entry.type === "oauth" && entry.provider
						? integrationsByProvider[entry.provider]?.[0]?.id
						: undefined,
			});
		},
		[setDisconnectTarget, integrationsByProvider],
	);

	const handleOpenEntry = useCallback(
		(entry: CatalogEntry) => {
			setSelectedEntry(entry);
			setPickerOpen(false);
		},
		[setSelectedEntry, setPickerOpen],
	);

	const handleUpdateSlackConfig = useCallback(
		(input: Parameters<typeof updateSlackConfig.mutate>[0]) => {
			updateSlackConfig.mutate(input);
		},
		[updateSlackConfig],
	);

	return {
		// Role
		isAdmin,

		// Search
		searchQuery,
		setSearchQuery,

		// Loading
		integrationsLoading,
		connectorsLoading,

		// OAuth / Slack connections
		loadingProvider,
		integrationsByProvider,
		slackStatus,
		slackConnectIsPending: slackConnect.isPending,
		handleConnect,
		connectOAuth,

		// Integration status
		getConnectionStatus,
		getLoadingStatus,
		getConnectedMeta,
		connectedEntries,

		// Connectors
		connectors,
		filteredConnectors,
		editingId,
		setEditingId,
		updateMutationIsPending,
		handleToggle,
		handleSave,

		// Source preferences
		isSourceEnabled,
		handleToggleSource,
		handleToggleConnectorSource,
		isConnectorEnabled,
		togglePreferenceIsPending,

		// Picker / detail dialogs
		pickerOpen,
		setPickerOpen,
		selectedEntry,
		selectedConnectorId,
		selectedDetailTab,
		openedFromPicker,
		handleSelectFromPicker,
		handleSelectFromRow,
		handleSelectConnectorRow,
		handleDetailBack,
		handleDetailOpenChange,
		pickerCatalog,

		// Disconnect dialog
		disconnectTarget,
		setDisconnectTarget,
		handleConfirmDisconnect,
		getDisconnectDescription,
		handleSetDisconnectTargetForEntry,

		// Connector delete dialog
		deleteConnectorTarget,
		setDeleteConnectorTarget,
		handleConfirmDeleteConnector,

		// Slack config
		slackConfig,
		readyConfigurations,
		handleUpdateSlackConfig,

		// Slack connect form
		showSlackConnectForm,
		setShowSlackConnectForm,
		slackConnectChannelName,
		setSlackConnectChannelName,
		handleCreateSlackConnect,
		handleCancelSlackConnectForm,

		// Derived
		hasConnectedIntegrations,

		// Entry actions
		handleOpenEntry,
	};
}
