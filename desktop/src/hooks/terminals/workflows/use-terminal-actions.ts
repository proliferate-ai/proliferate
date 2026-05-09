import type { TerminalPurpose, TerminalRecord } from "@anyharness/sdk";
import { useCallback } from "react";
import { useTerminalCache } from "@/hooks/access/anyharness/terminals/use-terminal-cache";
import { useTerminalWorkspaceConnection } from "@/hooks/terminals/workflows/use-terminal-workspace-connection";
import {
  clearTerminal,
  clearTerminalIntentionalClose,
  markTerminalIntentionalClose,
} from "@/lib/infra/terminals/terminal-stream-registry";
import {
  closeTerminal,
  createWorkspaceTerminal,
  isMissingTerminalError,
  listWorkspaceTerminals,
  resizeTerminal,
  runTerminalCommand,
  updateTerminalTitle,
} from "@/lib/access/anyharness/terminals";
import {
  closeTerminalTabWorkflow,
  createRunTerminalTabWorkflow,
  type CloseTerminalResult,
} from "@/lib/workflows/terminals/terminal-record-workflows";
import { useToastStore } from "@/stores/toast/toast-store";
import { useTerminalStore } from "@/stores/terminal/terminal-store";

// Owns terminal record user actions. Does not own terminal rendering or stream lifecycle.
export function useTerminalActions() {
  const {
    invalidateWorkspaceTerminals,
    setWorkspaceTerminalRecords,
  } = useTerminalCache();
  const {
    getWorkspaceRuntimeBlockReason,
    resolveTerminalWorkspaceConnection,
  } = useTerminalWorkspaceConnection();
  const showToast = useToastStore((state) => state.show);
  const clearTerminalState = useTerminalStore((state) => state.clearTerminalState);
  const bumpConnectionVersion = useTerminalStore((state) => state.bumpConnectionVersion);

  const loadWorkspaceTabs = useCallback(async (workspaceId: string): Promise<TerminalRecord[]> => {
    if (getWorkspaceRuntimeBlockReason(workspaceId)) {
      return [];
    }
    const connection = await resolveTerminalWorkspaceConnection(workspaceId);
    const records = await listWorkspaceTerminals(connection);
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
    const record = await createWorkspaceTerminal(connection, {
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
    return createRunTerminalTabWorkflow({
      workspaceId,
      command,
      cols,
      rows,
    }, {
      getWorkspaceRuntimeBlockReason,
      resolveWorkspaceConnection: resolveTerminalWorkspaceConnection,
      listWorkspaceTerminals,
      setWorkspaceTerminalRecords,
      createWorkspaceTerminal,
      invalidateWorkspaceTerminals,
    });
  }, [
    getWorkspaceRuntimeBlockReason,
    invalidateWorkspaceTerminals,
    resolveTerminalWorkspaceConnection,
    setWorkspaceTerminalRecords,
  ]);

  const clearClosedTerminalState = useCallback((terminalId: string, workspaceId: string) => {
    clearTerminal({ workspaceId, terminalId });
    clearTerminalState(terminalId);
    bumpConnectionVersion(terminalId);
  }, [bumpConnectionVersion, clearTerminalState]);

  const closeTab = useCallback(async (
    terminalId: string,
    workspaceId: string,
  ): Promise<CloseTerminalResult> => {
    return closeTerminalTabWorkflow({
      terminalId,
      workspaceId,
    }, {
      getWorkspaceRuntimeBlockReason,
      showToast,
      markTerminalIntentionalClose,
      clearTerminalIntentionalClose,
      resolveWorkspaceConnection: resolveTerminalWorkspaceConnection,
      closeTerminal,
      clearClosedTerminalState,
      isMissingTerminalError,
      invalidateWorkspaceTerminals,
    });
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
      await resizeTerminal(connection, terminalId, { cols, rows });
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
      const record = await updateTerminalTitle(connection, terminalId, { title });
      await invalidateWorkspaceTerminals(workspaceId);
      return record;
    } catch (error) {
      if (isMissingTerminalError(error)) {
        clearClosedTerminalState(terminalId, workspaceId);
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

  const rerunCommand = useCallback(async (
    terminalId: string,
    workspaceId: string,
    command: string,
  ) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }
    const connection = await resolveTerminalWorkspaceConnection(workspaceId);
    const response = await runTerminalCommand(connection, terminalId, {
      command,
      interrupt: true,
    });
    await invalidateWorkspaceTerminals(workspaceId);
    return response;
  }, [
    getWorkspaceRuntimeBlockReason,
    invalidateWorkspaceTerminals,
    resolveTerminalWorkspaceConnection,
  ]);

  return {
    loadWorkspaceTabs,
    createTab: createTabForWorkspace,
    createRunTab: createRunTabForWorkspace,
    closeTab,
    resizeTab: resizeTabForWorkspace,
    renameTab,
    rerunCommand,
  };
}
