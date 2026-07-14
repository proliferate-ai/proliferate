import type { TerminalRecord } from "@anyharness/sdk";
import { useCallback, useEffect, useRef } from "react";
import { useTerminalActions } from "@/hooks/terminals/workflows/use-terminal-actions";
import { useTerminalStreamController } from "@/hooks/terminals/lifecycle/use-terminal-stream-controller";
import { useXtermSurface } from "@/hooks/terminals/lifecycle/use-xterm-surface";
import {
  sendInput,
  sendResize,
  subscribeWithReplay,
  type TerminalStreamIdentity,
} from "@/lib/infra/terminals/terminal-stream-registry";
import {
  TERMINAL_OUTPUT_GAP_MESSAGE,
  type TerminalReplayEntry,
} from "@/lib/infra/terminals/terminal-replay-buffer";
import { useTerminalStore } from "@/stores/terminal/terminal-store";

interface UseTerminalViewportInput {
  terminal: TerminalRecord;
  workspaceId: string | null;
  visible: boolean;
  canConnect: boolean;
  focusRequestToken: number;
}

// Owns workspace terminal stream replay and input wiring for the shared xterm surface.
export function useTerminalViewport({
  terminal,
  workspaceId,
  visible,
  canConnect,
  focusRequestToken,
}: UseTerminalViewportInput) {
  const streamIdentityRef = useRef<TerminalStreamIdentity | null>(null);
  const unsubscribeReplayRef = useRef<(() => void) | null>(null);
  const connectionVersion = useTerminalStore(
    (state) => state.connectionVersionByTerminal[terminal.id] ?? 0,
  );
  const { resizeTab } = useTerminalActions();
  const { ensureTabConnection } = useTerminalStreamController();

  const handleTerminalData = useCallback((data: string) => {
    const identity = streamIdentityRef.current;
    if (identity) {
      sendInput(identity, data);
    }
  }, []);

  const handleTerminalResize = useCallback(({ cols, rows }: { cols: number; rows: number }) => {
    if (workspaceId) {
      void resizeTab(terminal.id, workspaceId, cols, rows);
    }
    const identity = streamIdentityRef.current;
    if (identity) {
      sendResize(identity, cols, rows);
    }
  }, [resizeTab, terminal.id, workspaceId]);

  const { containerRef, isReady: isTerminalReady, terminalRef } = useXtermSurface({
    visible,
    focusRequestToken,
    onData: handleTerminalData,
    onResize: handleTerminalResize,
  });

  useEffect(() => () => {
    unsubscribeReplayRef.current?.();
    unsubscribeReplayRef.current = null;
  }, []);

  useEffect(() => {
    if (!visible || !isTerminalReady || !canConnect || !workspaceId) {
      return;
    }
    void ensureTabConnection(terminal.id, workspaceId, terminal.status).then((identity) => {
      if (!identity || !terminalRef.current) {
        return;
      }
      const existingIdentity = streamIdentityRef.current;
      if (
        existingIdentity?.workspaceId === identity.workspaceId
        && existingIdentity.terminalId === identity.terminalId
        && existingIdentity.runtimeIdentity === identity.runtimeIdentity
        && existingIdentity.cloudAuthorityScopeKey === identity.cloudAuthorityScopeKey
        && unsubscribeReplayRef.current
      ) {
        return;
      }
      unsubscribeReplayRef.current?.();
      streamIdentityRef.current = identity;
      const term = terminalRef.current;
      unsubscribeReplayRef.current = subscribeWithReplay(identity, (entry) => {
        writeTerminalReplayEntry(term, entry);
      });
    });
  }, [
    canConnect,
    connectionVersion,
    ensureTabConnection,
    isTerminalReady,
    terminal.id,
    terminal.status,
    terminalRef,
    visible,
    workspaceId,
  ]);

  return {
    containerRef,
  };
}

function writeTerminalReplayEntry(
  terminal: import("@xterm/xterm").Terminal,
  entry: TerminalReplayEntry,
): void {
  if (entry.type === "data") {
    terminal.write(entry.data);
    return;
  }
  if (entry.type === "runtime-gap" || entry.type === "local-overflow") {
    terminal.write(`\r\n${TERMINAL_OUTPUT_GAP_MESSAGE}\r\n`);
    return;
  }
  if (entry.type === "exit") {
    terminal.write("\r\n");
  }
}
