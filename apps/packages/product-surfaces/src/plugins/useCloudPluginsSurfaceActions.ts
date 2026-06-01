import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  useCloudMcpConnectionActions,
  useCloudMcpOAuthActions,
  useConfiguredPluginActions,
  useConfiguredSkillActions,
  type CloudMcpOAuthFlowStatusResponse,
} from "@proliferate/cloud-sdk-react";
import {
  pluginRequiresBrowserAuth,
  pluginSecretFieldsToCloud,
  pluginSettingsToCloud,
  validatePluginSecrets,
  validatePluginSettings,
  type PluginConnectionDraft,
  type PluginInventoryItem,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import type { PluginModalMode } from "@proliferate/product-ui/plugins/PluginsSurface";
import {
  delay,
  errorMessage,
  hasAnySecretValue,
  OAUTH_RETURN_PATH,
  OAUTH_TERMINAL_STATUSES,
  oauthFailureMessage,
} from "./cloud-plugin-surface-helpers";
import type {
  CloudPluginsLocalOAuthAdapter,
  PluginOAuthHandoff,
} from "./cloud-plugin-surface-types";

interface Refetchable {
  refetch: () => Promise<unknown>;
}

interface CloudPluginSurfaceTeam {
  id: string;
}

interface UseCloudPluginsSurfaceActionsOptions {
  catalog: Refetchable;
  connections: Refetchable;
  configuredPlugins: Refetchable;
  configuredSkills: Refetchable;
  deleteTarget: PluginInventoryItem | null;
  draft: PluginConnectionDraft | null;
  localOAuthAdapter: CloudPluginsLocalOAuthAdapter | undefined;
  onOpenDesktop: (() => void | Promise<void>) | undefined;
  onOpenUrl: (url: string) => void | Promise<void>;
  prepareOAuthHandoff: (() => PluginOAuthHandoff | null) | undefined;
  selectedItem: PluginInventoryItem | null;
  setDeleteTarget: (target: PluginInventoryItem | null) => void;
  setDraft: Dispatch<SetStateAction<PluginConnectionDraft | null>>;
  setSelection: (selection: { id: string; mode: PluginModalMode } | null) => void;
  surface: "desktop" | "web";
  team: CloudPluginSurfaceTeam | null;
}

export function useCloudPluginsSurfaceActions({
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
}: UseCloudPluginsSurfaceActionsOptions) {
  const connectionActions = useCloudMcpConnectionActions();
  const oauthActions = useCloudMcpOAuthActions();
  const pluginActions = useConfiguredPluginActions();
  const skillActions = useConfiguredSkillActions();
  const [submitting, setSubmitting] = useState(false);
  const [cancelingAction, setCancelingAction] = useState(false);
  const [pendingOAuthFlowId, setPendingOAuthFlowId] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [pendingItemIds, setPendingItemIds] = useState<string[]>([]);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const activeOAuthHandoffRef = useRef<PluginOAuthHandoff | null>(null);
  const canCancelSubmission = submitting
    && selectedItem !== null
    && (pendingOAuthFlowId !== null || selectedItem.setupVariant === "local_oauth");

  async function submitSelected() {
    if (!selectedItem || !draft) {
      return;
    }
    setModalError(null);
    const settingsError = validatePluginSettings(selectedItem.entry, draft.settings);
    if (settingsError) {
      setModalError(settingsError);
      return;
    }
    const writesSecrets = selectedItem.state === "available" || hasAnySecretValue(draft);
    if (writesSecrets) {
      const secretError = validatePluginSecrets(selectedItem.entry, draft.secretFields);
      if (secretError) {
        setModalError(secretError);
        return;
      }
    }
    const handoff = pluginRequiresBrowserAuth(selectedItem.entry)
      ? prepareOAuthHandoff?.() ?? null
      : null;
    await runItemAction(selectedItem, async () => {
      if (selectedItem.state === "available") {
        await installItem(selectedItem, draft, handoff);
      } else {
        await updateItem(selectedItem, draft, writesSecrets, handoff);
      }
      setSelection(null);
      setDraft(null);
    }, handoff);
  }

  async function installItem(
    item: PluginInventoryItem,
    nextDraft: PluginConnectionDraft,
    handoff: PluginOAuthHandoff | null,
  ) {
    if (item.entry.setupKind === "local_oauth") {
      if (!localOAuthAdapter) {
        await openDesktop();
        return;
      }
      await localOAuthAdapter.connect({
        catalogEntryId: item.entry.id,
        settings: nextDraft.settings,
      });
      await refreshInventory();
      return;
    }

    const connection = await connectionActions.createConnection({
      catalogEntryId: item.entry.id,
      settings: pluginSettingsToCloud(item.entry, nextDraft.settings),
      enabled: true,
    });

    if (pluginRequiresBrowserAuth(item.entry)) {
      await completeBrowserAuth(connection.connectionId, handoff);
    } else if (item.entry.authKind === "secret" || item.entry.requiredFields.length > 0) {
      await connectionActions.putSecretAuth({
        connectionId: connection.connectionId,
        body: {
          secretFields: pluginSecretFieldsToCloud(item.entry, nextDraft.secretFields),
        },
      });
    }

    await installPluginPackageIfPresent(item);
    await refreshInventory();
  }

  async function updateItem(
    item: PluginInventoryItem,
    nextDraft: PluginConnectionDraft,
    writesSecrets: boolean,
    handoff: PluginOAuthHandoff | null,
  ) {
    if (!item.connection) {
      return;
    }
    if (item.entry.setupKind === "local_oauth") {
      if (!localOAuthAdapter) {
        await openDesktop();
        return;
      }
      await localOAuthAdapter.reconnect({
        connectionId: item.connection.connectionId,
        catalogEntryId: item.entry.id,
        settings: nextDraft.settings,
      });
      await refreshInventory();
      return;
    }

    const settings = pluginSettingsToCloud(item.entry, nextDraft.settings);
    if (settings) {
      await connectionActions.patchConnection({
        connectionId: item.connection.connectionId,
        body: { settings },
      });
    }
    if (pluginRequiresBrowserAuth(item.entry)) {
      await completeBrowserAuth(item.connection.connectionId, handoff);
      if (item.entry.pluginPackage && !item.configuredPlugin) {
        await pluginActions.installPlugin(item.entry.pluginPackage.id);
      }
    } else if (writesSecrets) {
      await connectionActions.putSecretAuth({
        connectionId: item.connection.connectionId,
        body: {
          secretFields: pluginSecretFieldsToCloud(item.entry, nextDraft.secretFields),
        },
      });
    }
    await refreshInventory();
  }

  async function completeBrowserAuth(
    connectionId: string,
    handoff: PluginOAuthHandoff | null,
  ) {
    const started = await oauthActions.startFlow({
      connectionId,
      options: {
        callbackSurface: surface === "web" ? "web" : "desktop",
        finalSurface: surface,
        returnPath: surface === "web" ? OAUTH_RETURN_PATH : undefined,
      },
    });
    setPendingOAuthFlowId(started.flowId);
    activeOAuthHandoffRef.current = handoff;
    try {
      await openOAuthUrl(started.authorizationUrl, handoff);
      const status = await waitForOAuthCompletion(started.flowId);
      if (status.status !== "completed") {
        throw new Error(oauthFailureMessage(status.failureCode));
      }
    } finally {
      handoff?.close?.();
      if (activeOAuthHandoffRef.current === handoff) {
        activeOAuthHandoffRef.current = null;
      }
      setPendingOAuthFlowId(null);
    }
  }

  async function waitForOAuthCompletion(flowId: string): Promise<CloudMcpOAuthFlowStatusResponse> {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await delay(1500);
      const status = await oauthActions.getFlowStatus(flowId);
      if (OAUTH_TERMINAL_STATUSES.has(status.status)) {
        return status;
      }
    }
    await oauthActions.cancelFlow(flowId).catch(() => undefined);
    throw new Error("OAuth authorization timed out.");
  }

  async function installPluginPackageIfPresent(item: PluginInventoryItem) {
    if (item.entry.pluginPackage) {
      await pluginActions.installPlugin(item.entry.pluginPackage.id);
    }
  }

  async function toggleEnabled(item: PluginInventoryItem, enabledValue: boolean) {
    if (!item.connection) {
      return;
    }
    await runItemAction(item, async () => {
      await connectionActions.patchConnection({
        connectionId: item.connection!.connectionId,
        body: { enabled: enabledValue },
      });
      await refreshInventory();
    });
  }

  async function shareItem(item: PluginInventoryItem, publicToOrg: boolean) {
    if (!item.connection || !team?.id || item.connection.ownerScope === "organization") {
      return;
    }
    const connection = item.connection;
    await runItemAction(item, async () => {
      const body = publicToOrg
        ? { publicToOrg: true, publicOrganizationId: team.id }
        : { publicToOrg: false, publicOrganizationId: null };
      await Promise.all([
        publicToOrg
          ? connectionActions.publicizeConnection({
              connectionId: connection.connectionId,
              body: { organizationId: team.id },
            })
          : connectionActions.unpublicizeConnection(connection.connectionId),
        item.configuredPlugin
          ? pluginActions.patchPlugin({ itemId: item.configuredPlugin.id, body })
          : Promise.resolve(),
        ...item.configuredSkills.map((skill) =>
          skillActions.patchSkill({ itemId: skill.id, body })
        ),
      ]);
      await refreshInventory();
    });
  }

  async function confirmDelete() {
    const item = deleteTarget;
    if (!item?.connection) {
      setDeleteTarget(null);
      return;
    }
    setDeletingItemId(item.id);
    try {
      await runItemAction(item, async () => {
        if (item.entry.setupKind === "local_oauth" && localOAuthAdapter) {
          await localOAuthAdapter.delete({
            connectionId: item.connection!.connectionId,
            catalogEntryId: item.entry.id,
          });
        } else {
          await connectionActions.deleteConnection(item.connection!.connectionId);
        }
        setDeleteTarget(null);
        setSelection(null);
        setDraft(null);
        await refreshInventory();
      });
    } finally {
      setDeletingItemId(null);
    }
  }

  async function runItemAction(
    item: PluginInventoryItem,
    action: () => Promise<void>,
    handoff?: PluginOAuthHandoff | null,
  ) {
    setSubmitting(true);
    setPendingItemIds((current) => [...new Set([...current, item.id])]);
    try {
      await action();
    } catch (actionError) {
      handoff?.close?.();
      setModalError(errorMessage(actionError));
    } finally {
      setSubmitting(false);
      setPendingItemIds((current) => current.filter((id) => id !== item.id));
    }
  }

  async function openOAuthUrl(url: string, handoff: PluginOAuthHandoff | null) {
    if (handoff) {
      await handoff.open(url);
      return;
    }
    await onOpenUrl(url);
  }

  async function openDesktop() {
    await onOpenDesktop?.();
  }

  async function cancelPendingAction() {
    setCancelingAction(true);
    activeOAuthHandoffRef.current?.close?.();
    try {
      if (pendingOAuthFlowId) {
        await oauthActions.cancelFlow(pendingOAuthFlowId).catch(() => undefined);
      } else {
        await localOAuthAdapter?.cancelPending?.().catch(() => undefined);
      }
    } finally {
      setCancelingAction(false);
      setSelection(null);
      setDraft(null);
      setModalError(null);
    }
  }

  async function refreshInventory() {
    await Promise.all([
      catalog.refetch(),
      connections.refetch(),
      configuredPlugins.refetch(),
      configuredSkills.refetch(),
    ]);
    await connectionActions.invalidatePluginInventory({ invalidateTargets: true });
  }

  return {
    canCancelSubmission,
    cancelingAction,
    confirmDelete,
    deletingItemId,
    modalError,
    pendingItemIds,
    refreshInventory,
    setModalError,
    shareItem,
    submitSelected,
    submitting,
    toggleEnabled,
    cancelPendingAction,
  };
}
