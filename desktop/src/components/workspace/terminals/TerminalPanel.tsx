import type { TerminalRecord } from "@anyharness/sdk";
import {
  Component,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { Terminal as TerminalIcon } from "@/components/ui/icons";
import { useTerminalStore } from "@/stores/terminal/terminal-store";
import { getTerminalWsHandle, onTerminalData } from "@/lib/integrations/anyharness/terminal-handles";
import { useTerminalActions } from "@/hooks/terminals/use-terminal-actions";
import { getTerminalTheme, onThemeChange } from "@/config/theme";

interface TerminalPanelProps {
  workspaceId: string | null;
  terminals: readonly TerminalRecord[];
  activeTerminalId: string | null;
  isVisible?: boolean;
  isRuntimeReady?: boolean;
  canConnect?: boolean;
  isLoading?: boolean;
  errorMessage?: string | null;
  focusRequestToken?: number;
  onNewTerminal: () => void;
}

export function TerminalPanel({
  workspaceId,
  terminals,
  activeTerminalId,
  isVisible = true,
  isRuntimeReady = true,
  canConnect = true,
  isLoading = false,
  errorMessage = null,
  focusRequestToken = 0,
  onNewTerminal,
}: TerminalPanelProps) {
  return (
    <div className="flex h-full flex-col" data-telemetry-block data-focus-zone="terminal">
      <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-background">
        {isLoading ? (
          <TerminalEmptyState label="Loading terminals" />
        ) : errorMessage ? (
          <TerminalEmptyState label={errorMessage} />
        ) : terminals.length === 0 || !activeTerminalId ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-xs text-muted-foreground">No terminal selected</p>
            <Button onClick={onNewTerminal} size="sm" disabled={!isRuntimeReady}>
              <TerminalIcon className="size-3.5" />
              New terminal
            </Button>
          </div>
        ) : (
          terminals.map((terminal) => (
            <TerminalErrorBoundary key={terminal.id}>
              <TerminalViewport
                terminal={terminal}
                workspaceId={workspaceId}
                visible={isVisible && terminal.id === activeTerminalId}
                canConnect={isRuntimeReady && canConnect}
                focusRequestToken={focusRequestToken}
              />
            </TerminalErrorBoundary>
          ))
        )}
      </div>
    </div>
  );
}

function TerminalEmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

interface TerminalViewportProps {
  terminal: TerminalRecord;
  workspaceId: string | null;
  visible: boolean;
  canConnect: boolean;
  focusRequestToken: number;
}

function TerminalViewport({
  terminal,
  workspaceId,
  visible,
  canConnect,
  focusRequestToken,
}: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(visible);
  const connectionVersion = useTerminalStore(
    (state) => state.connectionVersionByTerminal[terminal.id] ?? 0,
  );
  const { ensureTabConnection, resizeTab } = useTerminalActions();

  useEffect(() => {
    if (visible) {
      setHasBeenVisible(true);
    }
  }, [visible]);

  useEffect(() => {
    if (!hasBeenVisible) return;
    const container = containerRef.current;
    if (!container) return;
    if (xtermRef.current) return;

    setIsTerminalReady(false);
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let unsubscribeTheme = () => {};
    let unsubscribeData = () => {};

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
          fontSize: 9,
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

      unsubscribeData = onTerminalData(terminal.id, (data) => {
        term.write(data);
      });

      term.onData((data) => {
        const wsHandle = getTerminalWsHandle(terminal.id);
        wsHandle?.send(data);
      });

      term.onResize(({ cols, rows }) => {
        if (workspaceId) {
          void resizeTab(terminal.id, workspaceId, cols, rows);
        }
        const handle = getTerminalWsHandle(terminal.id);
        handle?.sendResize(cols, rows);
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
      unsubscribeData();
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
    void ensureTabConnection(terminal.id, workspaceId, terminal.status);
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

  return (
    <div
      ref={containerRef}
      data-telemetry-block
      className={`absolute inset-0 overflow-hidden ${visible ? "block" : "hidden"}`}
      data-terminal-id={terminal.id}
    />
  );
}

class TerminalErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[TerminalErrorBoundary] xterm render error caught:", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Terminal crashed - switch tabs to recover
        </div>
      );
    }
    return this.props.children;
  }
}
