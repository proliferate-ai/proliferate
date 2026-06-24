import { useEffect, useMemo, useState } from "react";
import {
  useCloudMcpCatalog,
  useCloudMcpConnections,
  useCloudOrganizationIntegrationPolicy,
  useConfiguredPlugins,
  useConfiguredSkills,
  useCurrentTeam,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudPluginInventory,
  createDefaultPluginDraft,
  type PluginConnectionDraft,
  type PluginInventoryItem,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import type {
  PluginCompletionNotice,
  PluginModalMode,
  PluginsSurfaceProps,
} from "@proliferate/product-ui/plugins/PluginsSurface";
import {
  applyLocalOAuthStatuses,
  firstErrorMessage,
  oauthFailureMessage,
} from "./cloud-plugin-surface-helpers";
import type { CloudPluginsSurfaceProps } from "./cloud-plugin-surface-types";
import { useCloudPluginLocalOAuthStatuses } from "./useCloudPluginLocalOAuthStatuses";
import { useCloudPluginsSurfaceActions } from "./useCloudPluginsSurfaceActions";

export function useCloudPluginsSurfaceController({
  surface,
  enabled = true,
  completion = null,
  localOAuthAdapter,
  renderIcon,
  onCompletionHandled,
  onOpenUrl,
  onOpenDesktop,
  prepareOAuthHandoff,
}: CloudPluginsSurfaceProps): PluginsSurfaceProps {
  const catalog = useCloudMcpCatalog(enabled);
  const connections = useCloudMcpConnections(enabled);
  const configuredPlugins = useConfiguredPlugins(enabled);
  const configuredSkills = useConfiguredSkills(enabled);
  const currentTeam = useCurrentTeam(enabled);
  const team = currentTeam.data ?? null;
  const integrationPolicy = useCloudOrganizationIntegrationPolicy(
    team?.id ?? null,
    enabled && team !== null,
  );
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<{ id: string; mode: PluginModalMode } | null>(null);
  const [draft, setDraft] = useState<PluginConnectionDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PluginInventoryItem | null>(null);
  const [completionNotice, setCompletionNotice] = useState<PluginCompletionNotice | null>(null);

  const baseItems = useMemo(() => {
    if (
      !catalog.data
      || !connections.data
      || !configuredPlugins.data
      || !configuredSkills.data
      || currentTeam.isLoading
      || (team !== null && !integrationPolicy.data)
    ) {
      return [];
    }
    return buildCloudPluginInventory({
      catalog: catalog.data,
      integrationPolicy: integrationPolicy.data ?? null,
      connections: connections.data.connections,
      configuredPlugins: configuredPlugins.data.plugins,
      configuredSkills: configuredSkills.data.skills,
      surface,
      query,
    });
  }, [
    catalog.data,
    configuredPlugins.data,
    configuredSkills.data,
    connections.data,
    currentTeam.isLoading,
    integrationPolicy.data,
    query,
    surface,
    team,
  ]);
  const localOAuthStatuses = useCloudPluginLocalOAuthStatuses(baseItems, localOAuthAdapter);
  const items = useMemo(
    () => applyLocalOAuthStatuses(baseItems, localOAuthStatuses),
    [baseItems, localOAuthStatuses],
  );

  const selectedItem = selection
    ? items.find((item) => item.id === selection.id || item.entry.id === selection.id) ?? null
    : null;
  const teamRole = team?.membership?.role ?? null;
  const canShare = Boolean(
    team?.membership?.status === "active" && (teamRole === "owner" || teamRole === "admin"),
  );
  const loading = catalog.isLoading
    || connections.isLoading
    || configuredPlugins.isLoading
    || configuredSkills.isLoading
    || currentTeam.isLoading
    || (team !== null && integrationPolicy.isLoading);
  const error = firstErrorMessage(
    catalog.error,
    connections.error,
    configuredPlugins.error,
    configuredSkills.error,
    currentTeam.error,
    integrationPolicy.error,
  );
  const actions = useCloudPluginsSurfaceActions({
    catalog,
    connections,
    configuredPlugins,
    configuredSkills,
    deleteTarget,
    draft,
    localOAuthAdapter,
    onOpenDesktop,
    onOpenUrl,
    prepareOAuthHandoff,
    selectedItem,
    setDeleteTarget,
    setDraft,
    setSelection,
    surface,
    team,
  });

  useEffect(() => {
    if (!completion || completion.source !== "mcp_oauth_callback") {
      return;
    }
    const succeeded = completion.status === "completed";
    setCompletionNotice(succeeded
      ? {
          title: "Integration connected",
          description: "Browser authorization finished. Integration access is refreshing.",
          tone: "info",
        }
      : {
          title: "Integration connection failed",
          description: oauthFailureMessage(completion.failureCode),
          tone: "destructive",
        });
    void actions.refreshInventory();
    [1200, 3500, 8000].forEach((delayMs) =>
      window.setTimeout(() => {
        void actions.refreshInventory();
      }, delayMs)
    );
    onCompletionHandled?.();
  }, [completion, onCompletionHandled]);

  function openItem(item: PluginInventoryItem, mode: PluginModalMode) {
    setSelection({ id: item.id, mode });
    setDraft(createDefaultPluginDraft(item));
    actions.setModalError(null);
  }

  return {
    items,
    query,
    loading,
    error,
    surface,
    selectedItem,
    modalMode: selection?.mode ?? "connect",
    draft,
    submitting: actions.submitting,
    pendingItemIds: actions.pendingItemIds,
    modalError: actions.modalError,
    completionNotice,
    canShare,
    canCancelSubmission: actions.canCancelSubmission,
    cancelingSubmission: actions.cancelingAction,
    shareOrganizationName: team?.name ?? null,
    deleteTarget,
    deletePending: actions.deletingItemId !== null,
    renderIcon,
    onQueryChange: setQuery,
    onRetry: () => {
      void actions.refreshInventory();
    },
    onOpenItem: openItem,
    onCloseItem: () => {
      setSelection(null);
      setDraft(null);
      actions.setModalError(null);
    },
    onCancelSubmission: () => {
      void actions.cancelPendingAction();
    },
    onDraftSettingsChange: (settings) => {
      setDraft((current) => current ? { ...current, settings } : current);
    },
    onDraftSecretChange: (fieldId, value) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              secretFields: {
                ...current.secretFields,
                [fieldId]: value,
              },
            }
          : current
      );
    },
    onSubmitSelected: () => {
      void actions.submitSelected();
    },
    onToggleEnabled: (item, enabledValue) => {
      void actions.toggleEnabled(item, enabledValue);
    },
    onShareChange: (item, publicToOrg) => {
      void actions.shareItem(item, publicToOrg);
    },
    onOpenDocs: onOpenUrl,
    onOpenDesktop: () => {
      void onOpenDesktop?.();
    },
    onRequestDelete: setDeleteTarget,
    onCloseDelete: () => setDeleteTarget(null),
    onConfirmDelete: () => {
      void actions.confirmDelete();
    },
  };
}
