import {
  AnyHarnessError,
  connectTerminal,
  type TerminalPurpose,
  type TerminalRecord,
} from "@anyharness/sdk";
import {
  anyHarnessTerminalsKey,
  getAnyHarnessClient,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
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
type CloseTerminalResult = "closed" | "missing" | "blocked" | "failed";

export function useTerminalActions() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const { selectedCloudRuntime, getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const markUnread = useTerminalStore((state) => state.markUnread);
  const clearTerminalState = useTerminalStore((state) => state.clearTerminalState);
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

  const invalidateWorkspaceTerminals = useCallback(async (workspaceId: string) => {
    await queryClient.invalidateQueries({
      queryKey: anyHarnessTerminalsKey(runtimeUrl, workspaceId),
    });
  }, [queryClient, runtimeUrl]);

  const setWorkspaceTerminalRecords = useCallback((
    workspaceId: string,
    records: TerminalRecord[],
  ) => {
    queryClient.setQueryData(anyHarnessTerminalsKey(runtimeUrl, workspaceId), records);
  }, [queryClient, runtimeUrl]);

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
        const activeTerminalId = activeWsId
          ? state.activeTerminalByWorkspace[activeWsId]
          : null;
        if (activeTerminalId !== terminalId) {
          markUnread(terminalId);
        }
      },
      onExit: () => {
        sawExitEvent = true;
        clearTerminalWsHandle(terminalId);
        bumpConnectionVersion(terminalId);
        void invalidateWorkspaceTerminals(workspaceId);
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
    invalidateWorkspaceTerminals,
    markUnread,
    resolveTerminalWorkspaceConnection,
    triggerSelectedCloudReconnect,
  ]);

  const loadWorkspaceTabs = useCallback(async (workspaceId: string): Promise<TerminalRecord[]> => {
    if (getWorkspaceRuntimeBlockReason(workspaceId)) {
      return [];
    }
    const connection = await resolveTerminalWorkspaceConnection(workspaceId);
    const client = getAnyHarnessClient(connection);
    const records = await client.terminals.list(connection.anyharnessWorkspaceId);
    setWorkspaceTerminalRecords(workspaceId, records);
    return records;
  }, [
    getWorkspaceRuntimeBlockReason,
    resolveTerminalWorkspaceConnection,
    setWorkspaceTerminalRecords,
  ]);

  const createTabForWorkspace = useCallback(async (
    workspaceId: string,
    cols: number,
    rows: number,
    options?: { title?: string; purpose?: TerminalPurpose },
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
      purpose: options?.purpose,
    });
    await invalidateWorkspaceTerminals(workspaceId);
    return record.id;
  }, [
    getWorkspaceRuntimeBlockReason,
    invalidateWorkspaceTerminals,
    resolveTerminalWorkspaceConnection,
  ]);

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
    let records: TerminalRecord[] = [];
    try {
      records = await client.terminals.list(connection.anyharnessWorkspaceId);
      setWorkspaceTerminalRecords(workspaceId, records);
    } catch {
      // Listing is used for Run reuse. If it fails, preserve the existing behavior
      // of creating a Run terminal so the workflow still has a path forward.
    }

    const existingRunTabId = findReusableRunTerminalId(
      records.map((record) => ({ ...record, workspaceId })),
      workspaceId,
    );
    if (existingRunTabId) {
      return existingRunTabId;
    }

    const record = await client.terminals.create(connection.anyharnessWorkspaceId, {
      cols,
      rows,
      title: RUN_TERMINAL_TITLE,
      purpose: "run",
    });
    setTerminalPendingStartupCommand(record.id, command);
    await invalidateWorkspaceTerminals(workspaceId);
    return record.id;
  }, [
    getWorkspaceRuntimeBlockReason,
    invalidateWorkspaceTerminals,
    resolveTerminalWorkspaceConnection,
    setWorkspaceTerminalRecords,
  ]);

  const ensureTabConnection = useCallback(async (
    terminalId: string,
    workspaceId: string,
    status: TerminalRecord["status"],
  ) => {
    if (getTerminalWsHandle(terminalId) || intentionallyClosingTerminals.has(terminalId)) {
      return;
    }
    if (status === "exited" || status === "failed") {
      return;
    }
    if (getWorkspaceRuntimeBlockReason(workspaceId)) {
      return;
    }
    await attachTerminalStream(terminalId, workspaceId);
  }, [attachTerminalStream, getWorkspaceRuntimeBlockReason]);

  const clearClosedTerminalState = useCallback((terminalId: string) => {
    clearTerminalPendingStartupCommand(terminalId);
    clearTerminalWsHandle(terminalId);
    clearTerminalState(terminalId);
    bumpConnectionVersion(terminalId);
  }, [bumpConnectionVersion, clearTerminalState]);

  const closeTab = useCallback(async (
    terminalId: string,
    workspaceId: string,
  ): Promise<CloseTerminalResult> => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return "blocked";
    }

    intentionallyClosingTerminals.add(terminalId);

    try {
      const connection = await resolveTerminalWorkspaceConnection(workspaceId);
      const client = getAnyHarnessClient(connection);
      await client.terminals.close(terminalId);
      clearClosedTerminalState(terminalId);
      return "closed";
    } catch (error) {
      if (isMissingTerminalError(error)) {
        clearClosedTerminalState(terminalId);
        return "missing";
      }
      return "failed";
    } finally {
      intentionallyClosingTerminals.delete(terminalId);
      await invalidateWorkspaceTerminals(workspaceId);
    }
  }, [
    clearClosedTerminalState,
    getWorkspaceRuntimeBlockReason,
    invalidateWorkspaceTerminals,
    resolveTerminalWorkspaceConnection,
    showToast,
  ]);

  const resizeTabForWorkspace = useCallback(async (
    terminalId: string,
    workspaceId: string,
    cols: number,
    rows: number,
  ) => {
    if (getWorkspaceRuntimeBlockReason(workspaceId)) {
      return;
    }
    try {
      const connection = await resolveTerminalWorkspaceConnection(workspaceId);
      const client = getAnyHarnessClient(connection);
      await client.terminals.resize(terminalId, { cols, rows });
    } catch {
      // Non-fatal
    }
  }, [getWorkspaceRuntimeBlockReason, resolveTerminalWorkspaceConnection]);

  const renameTab = useCallback(async (
    terminalId: string,
    workspaceId: string,
    title: string,
  ) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    try {
      const connection = await resolveTerminalWorkspaceConnection(workspaceId);
      const client = getAnyHarnessClient(connection);
      const record = await client.terminals.updateTitle(terminalId, { title });
      await invalidateWorkspaceTerminals(workspaceId);
      return record;
    } catch (error) {
      if (isMissingTerminalError(error)) {
        clearClosedTerminalState(terminalId);
        await invalidateWorkspaceTerminals(workspaceId);
      }
      throw error;
    }
  }, [
    clearClosedTerminalState,
    getWorkspaceRuntimeBlockReason,
    invalidateWorkspaceTerminals,
    resolveTerminalWorkspaceConnection,
  ]);

  return {
    loadWorkspaceTabs,
    createTab: createTabForWorkspace,
    createRunTab: createRunTabForWorkspace,
    ensureTabConnection,
    closeTab,
    resizeTab: resizeTabForWorkspace,
    renameTab,
  };
}

function isMissingTerminalError(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && (error.problem.status === 404 || error.problem.code === "TERMINAL_NOT_FOUND");
}
