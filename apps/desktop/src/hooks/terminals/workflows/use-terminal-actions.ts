import type { TerminalPurpose, TerminalRecord } from "@anyharness/sdk";
import { useCallback } from "react";
import { useTerminalCache } from "@/hooks/access/anyharness/terminals/use-terminal-cache";
import { useTerminalWorkspaceConnection } from "@/hooks/terminals/workflows/use-terminal-workspace-connection";
import {
  clearTerminalIntentionalClose,
  markTerminalIntentionalClose,
} from "@/lib/infra/terminals/terminal-close-intent";
import {
  clearTerminal,
} from "@/lib/infra/terminals/terminal-stream-registry";
import { measureWorkspaceTerminalGrid } from "@/lib/infra/terminals/terminal-grid-probe";
import {
  DEFAULT_TERMINAL_GRID,
  type TerminalGrid,
} from "@/lib/domain/terminals/terminal-grid";
import { resolveReadableCodeFontScale } from "@/lib/domain/preferences/appearance";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
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

  // The shell prints its first prompt at creation size; a grid that differs
  // from the renderer leaves zsh's PROMPT_SP "%" mark visible. Measure the
  // real pane and only fall back to the default grid when nothing is laid out.
  const resolveCreateGrid = useCallback(async (
    workspaceId: string,
  ): Promise<TerminalGrid> => {
    const { readableCodeFontSizeId } = useUserPreferencesStore.getState();
    const fontSize = resolveReadableCodeFontScale(readableCodeFontSizeId).monacoFontSize;
    const measured = await measureWorkspaceTerminalGrid(workspaceId, { fontSize });
    return measured ?? DEFAULT_TERMINAL_GRID;
  }, []);

  const createTabForWorkspace = useCallback(async (
    workspaceId: string,
    options?: { title?: string; purpose?: TerminalPurpose },
  ) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }
    const { cols, rows } = await resolveCreateGrid(workspaceId);
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
    resolveCreateGrid,
    resolveTerminalWorkspaceConnection,
  ]);

  const createRunTabForWorkspace = useCallback(async (
    workspaceId: string,
    command: string,
    cols?: number,
    rows?: number,
  ) => {
    const grid = cols !== undefined && rows !== undefined
      ? { cols, rows }
      : await resolveCreateGrid(workspaceId);
    return createRunTerminalTabWorkflow({
      workspaceId,
      command,
      cols: grid.cols,
      rows: grid.rows,
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
    resolveCreateGrid,
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
