import type { TerminalRecord } from "@anyharness/sdk";
import { useCallback, useEffect, useRef } from "react";
import { useTerminalActions } from "#product/hooks/terminals/workflows/use-terminal-actions";
import { useTerminalStreamController } from "#product/hooks/terminals/lifecycle/use-terminal-stream-controller";
import { useXtermSurface } from "#product/hooks/terminals/lifecycle/use-xterm-surface";
import {
  sendInput,
  sendResize,
  subscribeWithReplay,
  type TerminalStreamIdentity,
} from "#product/lib/infra/terminals/terminal-stream-registry";
import {
  createTerminalReplayWriter,
  type TerminalReplayWriter,
} from "#product/lib/infra/terminals/terminal-replay-writer";
import { terminalStreamKey } from "#product/lib/infra/terminals/terminal-stream-key";
import { useTerminalStore } from "#product/stores/terminal/terminal-store";

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
  const replayWriterRef = useRef<TerminalReplayWriter | null>(null);
  const renderedOrderRef = useRef(0);
  const renderedIdentityKeyRef = useRef<string | null>(null);
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
    replayWriterRef.current?.dispose();
    replayWriterRef.current = null;
  }, []);

  useEffect(() => {
    if (!visible || !isTerminalReady || !canConnect || !workspaceId) {
      unsubscribeReplayRef.current?.();
      unsubscribeReplayRef.current = null;
      replayWriterRef.current?.dispose();
      replayWriterRef.current = null;
      return;
    }
    let cancelled = false;
    void ensureTabConnection(terminal.id, workspaceId, terminal.status).then((identity) => {
      if (cancelled || !identity || !terminalRef.current) {
        return;
      }
      const identityKey = terminalStreamKey(identity);
      if (renderedIdentityKeyRef.current !== identityKey) {
        renderedIdentityKeyRef.current = identityKey;
        renderedOrderRef.current = 0;
      }
      unsubscribeReplayRef.current?.();
      replayWriterRef.current?.dispose();
      streamIdentityRef.current = identity;
      const term = terminalRef.current;
      const writer = createTerminalReplayWriter(term, undefined, (entries) => {
        for (const entry of entries) {
          if (entry.type !== "local-overflow") {
            renderedOrderRef.current = Math.max(renderedOrderRef.current, entry.order);
          }
        }
      });
      replayWriterRef.current = writer;
      unsubscribeReplayRef.current = subscribeWithReplay(identity, (entry) => {
        writer.enqueue(entry);
      }, {
        afterOrder: renderedOrderRef.current,
      });
    });
    return () => {
      cancelled = true;
      unsubscribeReplayRef.current?.();
      unsubscribeReplayRef.current = null;
      replayWriterRef.current?.dispose();
      replayWriterRef.current = null;
    };
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
