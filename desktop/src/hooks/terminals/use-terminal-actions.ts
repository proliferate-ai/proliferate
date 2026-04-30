import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { connectTerminal } from "@anyharness/sdk";
import { useCallback } from "react";
import { cloudWorkspaceConnectionKey } from "@/hooks/cloud/query-keys";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  findReusableRunTerminalId,
  RUN_TERMINAL_TITLE,
} from "@/lib/domain/terminals/run-terminal";
import { resolveWorkspaceConnection } from "@/lib/integrations/anyharness/resolve-workspace-connection";
import {
  clearTerminalPendingStartupCommand,
  clearTerminalWsHandle,
  emitTerminalData,
  getTerminalWsHandle,
  popTerminalPendingStartupCommand,
  setTerminalWsHandle,
  setTerminalPendingStartupCommand,
} from "@/lib/integrations/anyharness/terminal-handles";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useTerminalStore } from "@/stores/terminal/terminal-store";

const intentionallyClosingTerminals = new Set<string>();

export function useTerminalActions() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const { selectedCloudRuntime, getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const setWorkspaceTabs = useTerminalStore((state) => state.setWorkspaceTabs);
  const addTab = useTerminalStore((state) => state.addTab);
  const selectTab = useTerminalStore((state) => state.selectTab);
  const removeTab = useTerminalStore((state) => state.removeTab);
  const markUnread = useTerminalStore((state) => state.markUnread);
  const updateTabStatus = useTerminalStore((state) => state.updateTabStatus);
  const bumpConnectionVersion = useTerminalStore((state) => state.bumpConnectionVersion);

  const resolveTerminalWorkspaceConnection = useCallback(async (workspaceId: string) => {
    if (
      selectedCloudRuntime.workspaceId === workspaceId
      && selectedCloudRuntime.state?.phase === "ready"
      && selectedCloudRuntime.connectionInfo
    ) {
      return {
        runtimeUrl: selectedCloudRuntime.connectionInfo.runtimeUrl,
        authToken: selectedCloudRuntime.connectionInfo.accessToken,
        anyharnessWorkspaceId: selectedCloudRuntime.connectionInfo.anyharnessWorkspaceId ?? "",
      };
    }

    return resolveWorkspaceConnection(runtimeUrl, workspaceId);
  }, [
    runtimeUrl,
    selectedCloudRuntime.connectionInfo,
    selectedCloudRuntime.state?.phase,
    selectedCloudRuntime.workspaceId,
  ]);

  const triggerSelectedCloudReconnect = useCallback((workspaceId: string) => {
    if (
      selectedCloudRuntime.workspaceId !== workspaceId
      || selectedCloudRuntime.state?.phase !== "ready"
    ) {
      return;
    }

    const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
    if (!cloudWorkspaceId) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: cloudWorkspaceConnectionKey(cloudWorkspaceId),
      exact: true,
    });
  }, [
    queryClient,
    selectedCloudRuntime.state?.phase,
    selectedCloudRuntime.workspaceId,
  ]);

  const attachTerminalStream = useCallback(async (
    terminalId: string,
    workspaceId: string,
  ) => {
    if (intentionallyClosingTerminals.has(terminalId)) {
      return;
    }

    if (getWorkspaceRuntimeBlockReason(workspaceId)) {
      return;
    }

    const workspaceConnection = await resolveTerminalWorkspaceConnection(workspaceId);
    let sawExitEvent = false;
    const handle = connectTerminal({
      baseUrl: workspaceConnection.runtimeUrl,
      authToken: workspaceConnection.authToken,
      terminalId,
      onOpen: () => {
        // The shell prompt was already printed before the WebSocket connected.
        // Ctrl+L clears the screen and redraws the prompt cleanly.
        handle.send("\x0c");
        const startupCommand = popTerminalPendingStartupCommand(terminalId);
        if (startupCommand !== undefined) {
          handle.send(`${startupCommand.replace(/[\r\n]+$/, "")}\n`);
        }
      },
      onData: (data: Uint8Array) => {
        emitTerminalData(terminalId, data);
        const state = useTerminalStore.getState();
        const activeWsId = useHarnessStore.getState().selectedWorkspaceId;
        const activeTab = activeWsId ? state.activeTabByWorkspace[activeWsId] : null;
        if (activeTab !== terminalId) {
          markUnread(terminalId);
        }
      },
      onExit: (code: number | null) => {
        sawExitEvent = true;
        clearTerminalWsHandle(terminalId);
        bumpConnectionVersion(terminalId);
        updateTabStatus(terminalId, "exited", code);
      },
      onError: () => {
        clearTerminalWsHandle(terminalId);
        bumpConnectionVersion(terminalId);
        if (!intentionallyClosingTerminals.has(terminalId)) {
          triggerSelectedCloudReconnect(workspaceId);
        }
      },
      onClose: () => {
        clearTerminalWsHandle(terminalId);
        bumpConnectionVersion(terminalId);
        if (!intentionallyClosingTerminals.has(terminalId) && !sawExitEvent) {
          triggerSelectedCloudReconnect(workspaceId);
        }
      },
    });
    setTerminalWsHandle(terminalId, handle);
    bumpConnectionVersion(terminalId);
  }, [
    bumpConnectionVersion,
    getWorkspaceRuntimeBlockReason,
    markUnread,
    resolveTerminalWorkspaceConnection,
    triggerSelectedCloudReconnect,
    updateTabStatus,
  ]);

  const loadWorkspaceTabs = useCallback(async (workspaceId: string) => {
    if (getWorkspaceRuntimeBlockReason(workspaceId)) {
      return;
    }
    const connection = await resolveTerminalWorkspaceConnection(workspaceId);
    const client = getAnyHarnessClient(connection);
    try {
      const records = await client.terminals.list(connection.anyharnessWorkspaceId);
      setWorkspaceTabs(workspaceId, records);
    } catch {
      // Terminal endpoints may not be deployed yet; treat as empty.
    }
  }, [getWorkspaceRuntimeBlockReason, resolveTerminalWorkspaceConnection, setWorkspaceTabs]);

  const createTabForWorkspace = useCallback(async (
    workspaceId: string,
    cols: number,
    rows: number,
    options?: { title?: string },
  ) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }
    const connection = await resolveTerminalWorkspaceConnection(workspaceId);
    const client = getAnyHarnessClient(connection);
    const record = await client.terminals.create(connection.anyharnessWorkspaceId, {
      cols,
      rows,
      title: options?.title,
    });
    addTab(workspaceId, record);
    return record.id;
  }, [addTab, getWorkspaceRuntimeBlockReason, resolveTerminalWorkspaceConnection]);

  const createRunTabForWorkspace = useCallback(async (
    workspaceId: string,
    command: string,
    cols = 120,
    rows = 40,
  ) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const connection = await resolveTerminalWorkspaceConnection(workspaceId);
    const client = getAnyHarnessClient(connection);

    try {
      const records = await client.terminals.list(connection.anyharnessWorkspaceId);
      setWorkspaceTabs(workspaceId, records);
    } catch {
      // Terminal list is best-effort; creating a tab below still gives the user a path forward.
    }

    const existingRunTabId = findReusableRunTerminalId(
      Object.values(useTerminalStore.getState().tabsById),
      workspaceId,
    );
    if (existingRunTabId) {
      // Run commands are long-running terminal workflows. If the Run shell is still
      // active, focus it instead of sending another command into the foreground process.
      selectTab(existingRunTabId);
      return existingRunTabId;
    }

    const record = await client.terminals.create(connection.anyharnessWorkspaceId, {
      cols,
      rows,
      title: RUN_TERMINAL_TITLE,
    });
    setTerminalPendingStartupCommand(record.id, command);
    addTab(workspaceId, record);
    return record.id;
  }, [
    addTab,
    getWorkspaceRuntimeBlockReason,
    resolveTerminalWorkspaceConnection,
    selectTab,
    setWorkspaceTabs,
  ]);

  const ensureTabConnection = useCallback(async (terminalId: string) => {
    if (getTerminalWsHandle(terminalId) || intentionallyClosingTerminals.has(terminalId)) {
      return;
    }
    const tab = useTerminalStore.getState().tabsById[terminalId];
    if (!tab || tab.status === "exited" || tab.status === "failed") {
      return;
    }
    if (getWorkspaceRuntimeBlockReason(tab.workspaceId)) {
      return;
    }
    await attachTerminalStream(terminalId, tab.workspaceId);
  }, [attachTerminalStream, getWorkspaceRuntimeBlockReason]);

  const closeTab = useCallback(async (terminalId: string) => {
    const tab = useTerminalStore.getState().tabsById[terminalId];
    if (!tab) {
      return;
    }

    const blockedReason = getWorkspaceRuntimeBlockReason(tab.workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    intentionallyClosingTerminals.add(terminalId);
    clearTerminalPendingStartupCommand(terminalId);
    clearTerminalWsHandle(terminalId);
    bumpConnectionVersion(terminalId);

    try {
      const connection = await resolveTerminalWorkspaceConnection(tab.workspaceId);
      const client = getAnyHarnessClient(connection);
      await client.terminals.close(terminalId);
    } catch {
      // Best effort
    }

    removeTab(terminalId);
    intentionallyClosingTerminals.delete(terminalId);
  }, [
    bumpConnectionVersion,
    getWorkspaceRuntimeBlockReason,
    removeTab,
    resolveTerminalWorkspaceConnection,
    showToast,
  ]);

  const resizeTabForWorkspace = useCallback(async (
    terminalId: string,
    cols: number,
    rows: number,
  ) => {
    const tab = useTerminalStore.getState().tabsById[terminalId];
    if (!tab) {
      return;
    }
    if (getWorkspaceRuntimeBlockReason(tab.workspaceId)) {
      return;
    }
    try {
      const connection = await resolveTerminalWorkspaceConnection(tab.workspaceId);
      const client = getAnyHarnessClient(connection);
      await client.terminals.resize(terminalId, { cols, rows });
    } catch {
      // Non-fatal
    }
  }, [getWorkspaceRuntimeBlockReason, resolveTerminalWorkspaceConnection]);

  return {
    loadWorkspaceTabs,
    createTab: createTabForWorkspace,
    createRunTab: createRunTabForWorkspace,
    ensureTabConnection,
    closeTab,
    resizeTab: resizeTabForWorkspace,
  };
}
