import type { TerminalRecord } from "@anyharness/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminalActions } from "#product/hooks/terminals/workflows/use-terminal-actions";
import { useTerminalStreamController } from "#product/hooks/terminals/lifecycle/use-terminal-stream-controller";
import { useXtermSurface } from "#product/hooks/terminals/lifecycle/use-xterm-surface";
import { terminalStreamKey } from "#product/lib/infra/terminals/terminal-stream-key";
import {
  sendInput,
  sendResize,
  subscribeWithReplay,
  TERMINAL_OUTPUT_GAP_MESSAGE,
  type TerminalReplayEntry,
  type TerminalStreamIdentity,
} from "#product/lib/infra/terminals/terminal-stream-registry";
import { useTerminalStore } from "#product/stores/terminal/terminal-store";

function sameStreamIdentity(
  a: TerminalStreamIdentity | null,
  b: TerminalStreamIdentity | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return terminalStreamKey(a) === terminalStreamKey(b);
}

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
  // Q13: the connection resolved at pane-activation intent, held in state so the
  // buffer-drain effect re-runs once the xterm surface is mounted. The registry
  // buffers replay bytes from the socket the moment this resolves; the surface
  // drains that buffer in order on mount, so connect and mount run in parallel
  // instead of the old serial mount -> connect -> replay chain.
  const [connectedIdentity, setConnectedIdentity] = useState<TerminalStreamIdentity | null>(null);
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

  // Q13 phase 1 — resolve the connection at pane-activation intent (visible),
  // NOT at xterm mount. This starts the socket and its registry replay buffer
  // immediately so bytes accumulate while the (dynamically imported) xterm
  // surface is still mounting. `cancelled` guards the async resolution: if the
  // pane is switched away or re-resolves mid-connect, the stale resolution is
  // dropped before it can cross-wire a buffer onto this surface.
  useEffect(() => {
    if (!visible || !canConnect || !workspaceId) {
      return;
    }
    let cancelled = false;
    void ensureTabConnection(terminal.id, workspaceId, terminal.status).then((identity) => {
      if (cancelled || !identity) {
        return;
      }
      setConnectedIdentity((previous) =>
        sameStreamIdentity(previous, identity) ? previous : identity,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    canConnect,
    connectionVersion,
    ensureTabConnection,
    terminal.id,
    terminal.status,
    visible,
    workspaceId,
  ]);

  // Q13 phase 2 — drain the buffered replay into the xterm surface once it is
  // mounted. `subscribeWithReplay` first replays every buffered entry in order,
  // then streams live entries, so no byte is dropped or reordered regardless of
  // whether it arrived before or after mount. Re-subscribing is skipped when the
  // surface already carries this exact identity.
  useEffect(() => {
    if (!isTerminalReady || !connectedIdentity) {
      return;
    }
    const term = terminalRef.current;
    if (!term) {
      return;
    }
    if (
      sameStreamIdentity(streamIdentityRef.current, connectedIdentity)
      && unsubscribeReplayRef.current
    ) {
      return;
    }
    unsubscribeReplayRef.current?.();
    streamIdentityRef.current = connectedIdentity;
    unsubscribeReplayRef.current = subscribeWithReplay(connectedIdentity, (entry) => {
      writeTerminalReplayEntry(term, entry);
    });
  }, [connectedIdentity, isTerminalReady, terminalRef]);

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
