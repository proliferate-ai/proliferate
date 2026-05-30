import { useEffect, useMemo, useRef, useState } from "react";
import {
  useCloudMcpCatalog,
  useCloudMcpConnectionActions,
  useCloudMcpConnections,
  useCloudMcpOAuthActions,
  useConfiguredPluginActions,
  useConfiguredPlugins,
  useConfiguredSkillActions,
  useConfiguredSkills,
  useCurrentTeam,
  type CloudMcpOAuthFlowStatusResponse,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudPluginInventory,
  createDefaultPluginDraft,
  normalizedPluginSecretFields,
  pluginRequiresBrowserAuth,
  pluginSettingsToCloud,
  validatePluginSecrets,
  validatePluginSettings,
  type PluginConnectionDraft,
  type PluginInventoryItem,
  type PluginSettings,
  type PluginSurfaceKind,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import {
  PluginsSurface,
  type PluginCompletionNotice,
  type PluginIconRenderer,
  type PluginModalMode,
} from "@proliferate/product-ui/plugins/PluginsSurface";

const OAUTH_RETURN_PATH = "/plugins/connect/complete";
const OAUTH_TERMINAL_STATUSES = new Set(["completed", "expired", "cancelled", "failed"]);

export interface PluginOAuthCompletionState {
  source: "mcp_oauth_callback";
  status: string | null;
  flowId: string | null;
  failureCode: string | null;
}

export interface PluginOAuthHandoff {
  open: (url: string) => void | Promise<void>;
  close?: () => void;
}

export interface CloudPluginsLocalOAuthAdapter {
  connect: (input: {
    catalogEntryId: string;
    settings?: PluginSettings;
  }) => Promise<void>;
  reconnect: (input: {
    connectionId: string;
    catalogEntryId: string;
    settings?: PluginSettings;
  }) => Promise<void>;
  delete: (input: {
    connectionId: string;
    catalogEntryId: string;
  }) => Promise<void>;
  cancelPending?: () => Promise<void>;
  getCredentialStatus?: (input: {
    connectionId: string;
    catalogEntryId: string;
    settings?: PluginSettings;
  }) => Promise<"ready" | "not_ready">;
}

export interface CloudPluginsSurfaceProps {
  surface: PluginSurfaceKind;
  enabled?: boolean;
  completion?: PluginOAuthCompletionState | null;
  localOAuthAdapter?: CloudPluginsLocalOAuthAdapter;
  renderIcon?: PluginIconRenderer;
  onCompletionHandled?: () => void;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenDesktop?: () => void | Promise<void>;
  prepareOAuthHandoff?: () => PluginOAuthHandoff | null;
}

export function CloudPluginsSurface({
  surface,
  enabled = true,
  completion = null,
  localOAuthAdapter,
  renderIcon,
  onCompletionHandled,
  onOpenUrl,
  onOpenDesktop,
  prepareOAuthHandoff,
}: CloudPluginsSurfaceProps) {
  const catalog = useCloudMcpCatalog(enabled);
  const connections = useCloudMcpConnections(enabled);
  const configuredPlugins = useConfiguredPlugins(enabled);
  const configuredSkills = useConfiguredSkills(enabled);
  const currentTeam = useCurrentTeam(enabled);
  const connectionActions = useCloudMcpConnectionActions();
  const oauthActions = useCloudMcpOAuthActions();
  const pluginActions = useConfiguredPluginActions();
  const skillActions = useConfiguredSkillActions();
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<{ id: string; mode: PluginModalMode } | null>(null);
  const [draft, setDraft] = useState<PluginConnectionDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelingAction, setCancelingAction] = useState(false);
  const [pendingOAuthFlowId, setPendingOAuthFlowId] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [pendingItemIds, setPendingItemIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<PluginInventoryItem | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [completionNotice, setCompletionNotice] = useState<PluginCompletionNotice | null>(null);
  const [localOAuthStatuses, setLocalOAuthStatuses] = useState<Record<string, "ready" | "not_ready">>({});
  const activeOAuthHandoffRef = useRef<PluginOAuthHandoff | null>(null);

  const baseItems = useMemo(() => {
    if (!catalog.data || !connections.data || !configuredPlugins.data || !configuredSkills.data) {
      return [];
    }
    return buildCloudPluginInventory({
      catalog: catalog.data,
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
    query,
    surface,
  ]);
  const items = useMemo(
    () => applyLocalOAuthStatuses(baseItems, localOAuthStatuses),
    [baseItems, localOAuthStatuses],
  );

  const selectedItem = selection
    ? items.find((item) => item.id === selection.id || item.entry.id === selection.id) ?? null
    : null;
  const team = currentTeam.data ?? null;
  const teamRole = team?.membership?.role ?? null;
  const canShare = Boolean(
    team?.membership?.status === "active" && (teamRole === "owner" || teamRole === "admin"),
  );
  const loading = catalog.isLoading
    || connections.isLoading
    || configuredPlugins.isLoading
    || configuredSkills.isLoading;
  const error = firstErrorMessage(
    catalog.error,
    connections.error,
    configuredPlugins.error,
    configuredSkills.error,
  );
  const canCancelSubmission = submitting
    && selectedItem !== null
    && (pendingOAuthFlowId !== null || selectedItem.setupVariant === "local_oauth");

  useEffect(() => {
    if (!localOAuthAdapter?.getCredentialStatus) {
      setLocalOAuthStatuses({});
      return;
    }
    const localItems = baseItems.filter((item) =>
      item.state === "installed"
      && item.setupVariant === "local_oauth"
      && item.connection
    );
    if (localItems.length === 0) {
      setLocalOAuthStatuses({});
      return;
    }
    let cancelled = false;
    void Promise.all(localItems.map(async (item) => {
      const status = await localOAuthAdapter.getCredentialStatus!({
        connectionId: item.connection!.connectionId,
        catalogEntryId: item.entry.id,
        settings: item.connection!.settings as PluginSettings | undefined,
      }).catch(() => "not_ready" as const);
      return [item.id, status] as const;
    })).then((entries) => {
      if (!cancelled) {
        setLocalOAuthStatuses(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [baseItems, localOAuthAdapter]);

  useEffect(() => {
    if (!completion || completion.source !== "mcp_oauth_callback") {
      return;
    }
    const succeeded = completion.status === "completed";
    setCompletionNotice(succeeded
      ? {
          title: "Plugin connected",
          description: "Browser authorization finished. Plugin access is refreshing.",
          tone: "info",
        }
      : {
          title: "Plugin connection failed",
          description: oauthFailureMessage(completion.failureCode),
          tone: "destructive",
        });
    void refreshInventory();
    [1200, 3500, 8000].forEach((delayMs) =>
      window.setTimeout(() => {
        void refreshInventory();
      }, delayMs)
    );
    onCompletionHandled?.();
  }, [completion, onCompletionHandled]);

  function openItem(item: PluginInventoryItem, mode: PluginModalMode) {
    setSelection({ id: item.id, mode });
    setDraft(createDefaultPluginDraft(item));
    setModalError(null);
  }

  async function retry() {
    await refreshInventory();
  }

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
          secretFields: normalizedPluginSecretFields(item.entry, nextDraft.secretFields),
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
          secretFields: normalizedPluginSecretFields(item.entry, nextDraft.secretFields),
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

  return (
    <ProductPageShell
      title="Plugins"
      description="Packages of apps, MCP tools, and skills agents can use in sessions."
      maxWidthClassName="max-w-6xl"
      telemetryBlocked
    >
      <PluginsSurface
        items={items}
        query={query}
        loading={loading}
        error={error}
        surface={surface}
        selectedItem={selectedItem}
        modalMode={selection?.mode ?? "connect"}
        draft={draft}
        submitting={submitting}
        pendingItemIds={pendingItemIds}
        modalError={modalError}
        completionNotice={completionNotice}
        canShare={canShare}
        canCancelSubmission={canCancelSubmission}
        cancelingSubmission={cancelingAction}
        shareOrganizationName={team?.name ?? null}
        deleteTarget={deleteTarget}
        deletePending={deletingItemId !== null}
        renderIcon={renderIcon}
        onQueryChange={setQuery}
        onRetry={() => {
          void retry();
        }}
        onOpenItem={openItem}
        onCloseItem={() => {
          setSelection(null);
          setDraft(null);
          setModalError(null);
        }}
        onCancelSubmission={() => {
          void cancelPendingAction();
        }}
        onDraftSettingsChange={(settings) => {
          setDraft((current) => current ? { ...current, settings } : current);
        }}
        onDraftSecretChange={(fieldId, value) => {
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
        }}
        onSubmitSelected={() => {
          void submitSelected();
        }}
        onToggleEnabled={(item, enabledValue) => {
          void toggleEnabled(item, enabledValue);
        }}
        onShareChange={(item, publicToOrg) => {
          void shareItem(item, publicToOrg);
        }}
        onOpenDocs={onOpenUrl}
        onOpenDesktop={() => {
          void openDesktop();
        }}
        onRequestDelete={setDeleteTarget}
        onCloseDelete={() => setDeleteTarget(null)}
        onConfirmDelete={() => {
          void confirmDelete();
        }}
      />
    </ProductPageShell>
  );
}

function firstErrorMessage(...errors: unknown[]): string | null {
  for (const error of errors) {
    if (error) {
      return errorMessage(error);
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Plugin action could not be completed.";
}

function applyLocalOAuthStatuses(
  items: readonly PluginInventoryItem[],
  localOAuthStatuses: Record<string, "ready" | "not_ready">,
): PluginInventoryItem[] {
  return items.map((item) => {
    if (item.setupVariant !== "local_oauth" || localOAuthStatuses[item.id] !== "not_ready") {
      return item;
    }
    return {
      ...item,
      broken: true,
      statusLabel: "Needs reconnect",
      statusTone: "error",
      statusActionLabel: "Reconnect",
    };
  });
}

function oauthFailureMessage(failureCode?: string | null): string {
  switch (failureCode) {
    case "access_denied":
      return "Authorization was cancelled.";
    case "expired":
      return "Authorization expired.";
    case "connection_deleted":
      return "The plugin connection was deleted before authorization finished.";
    case "superseded":
      return "A newer authorization attempt replaced this one.";
    default:
      return "OAuth authorization could not be completed.";
  }
}

function hasAnySecretValue(draft: PluginConnectionDraft): boolean {
  return Object.values(draft.secretFields).some((value) => value.trim().length > 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
