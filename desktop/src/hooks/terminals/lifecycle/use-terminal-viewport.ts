import type { TerminalRecord } from "@anyharness/sdk";
import { useEffect, useRef, useState } from "react";
import { useTerminalActions } from "@/hooks/terminals/workflows/use-terminal-actions";
import { useTerminalStreamController } from "@/hooks/terminals/lifecycle/use-terminal-stream-controller";
import { getTerminalTheme, onThemeChange } from "@/config/theme";
import { resolveReadableCodeFontScale } from "@/lib/domain/preferences/appearance";
import {
  sendInput,
  sendResize,
  subscribeWithReplay,
  TERMINAL_OUTPUT_GAP_MESSAGE,
  type TerminalReplayEntry,
  type TerminalStreamIdentity,
} from "@/lib/infra/terminals/terminal-stream-registry";
import { useTerminalStore } from "@/stores/terminal/terminal-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

interface UseTerminalViewportInput {
  terminal: TerminalRecord;
  workspaceId: string | null;
  visible: boolean;
  canConnect: boolean;
  focusRequestToken: number;
}

// Owns xterm setup, terminal stream replay, and viewport resize/focus lifecycle.
export function useTerminalViewport({
  terminal,
  workspaceId,
  visible,
  canConnect,
  focusRequestToken,
}: UseTerminalViewportInput) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(visible);
  const streamIdentityRef = useRef<TerminalStreamIdentity | null>(null);
  const unsubscribeReplayRef = useRef<(() => void) | null>(null);
  const readableCodeFontSizeId = useUserPreferencesStore((state) => state.readableCodeFontSizeId);
  const terminalFontSize = resolveReadableCodeFontScale(readableCodeFontSizeId).monacoFontSize;
  const terminalFontSizeRef = useRef(terminalFontSize);
  const connectionVersion = useTerminalStore(
    (state) => state.connectionVersionByTerminal[terminal.id] ?? 0,
  );
  const { resizeTab } = useTerminalActions();
  const { ensureTabConnection } = useTerminalStreamController();

  useEffect(() => {
    if (visible) {
      setHasBeenVisible(true);
    }
  }, [visible]);

  useEffect(() => {
    terminalFontSizeRef.current = terminalFontSize;
    const term = xtermRef.current;
    if (!term) {
      return;
    }
    term.options.fontSize = terminalFontSize;
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
    });
  }, [terminalFontSize]);

  useEffect(() => {
    if (!hasBeenVisible) return;
    const container = containerRef.current;
    if (!container) return;
    if (xtermRef.current) return;

    setIsTerminalReady(false);
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let unsubscribeTheme = () => {};

    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (cancelled || !containerRef.current || xtermRef.current) return;

      let term: import("@xterm/xterm").Terminal;
      let fitAddon: import("@xterm/addon-fit").FitAddon;

      try {
        term = new Terminal({
          cursorBlink: true,
          fontSize: terminalFontSizeRef.current,
          fontFamily: "'Geist Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
          theme: getTerminalTheme(),
          allowTransparency: true,
          scrollback: 5000,
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        if (cancelled || !containerRef.current) {
          term.dispose();
          return;
        }

        term.open(containerRef.current);
        fitAddon.fit();
      } catch (err) {
        console.warn("[TerminalViewport] xterm init error (likely disposal race):", err);
        return;
      }

      if (cancelled) {
        term.dispose();
        return;
      }

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      unsubscribeTheme = onThemeChange(() => {
        term.options.theme = getTerminalTheme();
      });

      term.onData((data) => {
        const identity = streamIdentityRef.current;
        if (identity) {
          sendInput(identity, data);
        }
      });

      term.onResize(({ cols, rows }) => {
        if (workspaceId) {
          void resizeTab(terminal.id, workspaceId, cols, rows);
        }
        const identity = streamIdentityRef.current;
        if (identity) {
          sendResize(identity, cols, rows);
        }
      });

      resizeObserver = new ResizeObserver(() => {
        if (!cancelled) fitAddon.fit();
      });
      resizeObserver.observe(containerRef.current);
      setIsTerminalReady(true);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      unsubscribeReplayRef.current?.();
      unsubscribeReplayRef.current = null;
      unsubscribeTheme();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [hasBeenVisible, resizeTab, terminal.id, workspaceId]);

  useEffect(() => {
    if (!visible || !isTerminalReady || !canConnect || !workspaceId) {
      return;
    }
    void ensureTabConnection(terminal.id, workspaceId, terminal.status).then((identity) => {
      if (!identity || !xtermRef.current) {
        return;
      }
      const existingIdentity = streamIdentityRef.current;
      if (
        existingIdentity?.workspaceId === identity.workspaceId
        && existingIdentity.terminalId === identity.terminalId
        && existingIdentity.runtimeIdentity === identity.runtimeIdentity
        && unsubscribeReplayRef.current
      ) {
        return;
      }
      unsubscribeReplayRef.current?.();
      streamIdentityRef.current = identity;
      const term = xtermRef.current;
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
    visible,
    workspaceId,
  ]);

  useEffect(() => {
    if (visible && isTerminalReady && fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        xtermRef.current?.focus();
      });
    }
  }, [focusRequestToken, isTerminalReady, visible]);

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
