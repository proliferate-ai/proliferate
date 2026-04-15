import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { ChevronDown, X, Plus } from "@/components/ui/icons";
import { useTerminalStore } from "@/stores/terminal/terminal-store";
import { getTerminalWsHandle, onTerminalData } from "@/lib/integrations/anyharness/terminal-handles";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useTerminalActions } from "@/hooks/terminals/use-terminal-actions";
import { useTransparentChromeEnabled } from "@/hooks/theme/use-transparent-chrome";
import { getTerminalTheme, onThemeChange } from "@/config/theme";
import { useToastStore } from "@/stores/toast/toast-store";

interface TerminalPanelProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  isRuntimeReady?: boolean;
  focusRequestToken?: number;
}

const STATUS_DOT: Record<string, string> = {
  starting: "bg-git-yellow animate-pulse",
  running: "bg-git-green",
  exited: "bg-muted-foreground",
  failed: "bg-git-red",
};
const GLASS_TABLIST_RAIL_CLASS =
  "relative flex shrink-0 items-center gap-1 overflow-hidden border-b border-foreground/10 bg-card/25 pr-1 backdrop-blur-md supports-[backdrop-filter]:bg-card/20";
const SOLID_TABLIST_RAIL_CLASS =
  "relative flex shrink-0 items-center gap-1 overflow-hidden pr-1";

export function TerminalPanel({
  collapsed,
  onToggleCollapse,
  isRuntimeReady = true,
  focusRequestToken = 0,
}: TerminalPanelProps) {
  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);

  const tabsById = useTerminalStore((s) => s.tabsById);
  const workspaceTabs = useTerminalStore((s) => s.workspaceTabs);
  const activeTabByWorkspace = useTerminalStore((s) => s.activeTabByWorkspace);
  const loadedWorkspaceTabs = useTerminalStore((s) => s.loadedWorkspaceTabs);
  const selectTab = useTerminalStore((s) => s.selectTab);
  const { createTab, closeTab, loadWorkspaceTabs } = useTerminalActions();
  const transparentChromeEnabled = useTransparentChromeEnabled();
  const creatingInitialTabRef = useRef(false);
  const [canConnectTabs, setCanConnectTabs] = useState(false);

  const tabIds = selectedWorkspaceId ? workspaceTabs[selectedWorkspaceId] ?? [] : [];
  const activeTabId = selectedWorkspaceId ? activeTabByWorkspace[selectedWorkspaceId] ?? "" : "";
  const workspaceTabsLoaded = selectedWorkspaceId
    ? loadedWorkspaceTabs[selectedWorkspaceId] === true
    : false;

  useEffect(() => {
    if (!selectedWorkspaceId || !isRuntimeReady) {
      setCanConnectTabs(false);
      return;
    }

    let cancelled = false;
    setCanConnectTabs(false);
    void loadWorkspaceTabs(selectedWorkspaceId).finally(() => {
      if (!cancelled) {
        setCanConnectTabs(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isRuntimeReady, loadWorkspaceTabs, selectedWorkspaceId]);

  const showToast = useToastStore((s) => s.show);

  const handleNewTab = useCallback(() => {
    if (!selectedWorkspaceId || !isRuntimeReady) return;
    createTab(selectedWorkspaceId, 120, 40).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Failed to create terminal tab: ${msg}`);
    });
  }, [selectedWorkspaceId, isRuntimeReady, createTab, showToast]);

  useEffect(() => {
    if (
      collapsed
      || !selectedWorkspaceId
      || !isRuntimeReady
      || !canConnectTabs
      || !workspaceTabsLoaded
      || tabIds.length > 0
    ) {
      return;
    }
    if (creatingInitialTabRef.current) return;

    creatingInitialTabRef.current = true;
    createTab(selectedWorkspaceId, 120, 40)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Failed to create terminal tab: ${msg}`);
      })
      .finally(() => {
        creatingInitialTabRef.current = false;
      });
  }, [
    canConnectTabs,
    collapsed,
    createTab,
    isRuntimeReady,
    selectedWorkspaceId,
    showToast,
    tabIds.length,
    workspaceTabsLoaded,
  ]);

  if (collapsed) {
    return (
      <div className="flex items-center h-8 px-1 border-t border-border shrink-0">
        <IconButton onClick={onToggleCollapse} title="Expand terminal">
          <ChevronDown className="size-4 text-muted-foreground rotate-180" />
        </IconButton>
        <span className="text-xs text-muted-foreground ml-1">Terminal</span>
        {tabIds.length > 0 && (
          <span className="text-[10px] text-muted-foreground ml-1">
            ({tabIds.length})
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-telemetry-block data-focus-zone="terminal">
      <div className={transparentChromeEnabled ? GLASS_TABLIST_RAIL_CLASS : SOLID_TABLIST_RAIL_CLASS}>
        <IconButton className="ml-1" onClick={onToggleCollapse} title="Collapse terminal">
          <ChevronDown className="size-4 text-muted-foreground" />
        </IconButton>

        <div
          role="tablist"
          aria-label="Terminal tabs"
          className="flex h-9 flex-1 items-end gap-1 overflow-x-auto bg-transparent px-1 pt-1"
        >
          {tabIds.map((tabId, idx) => {
            const tab = tabsById[tabId];
            if (!tab) return null;
            const isActive = tabId === activeTabId;
            const fallbackTitle = `Terminal ${idx + 1}`;
            const displayTitle = tab.title === "Terminal" ? fallbackTitle : tab.title;
            const shapeClassName = "-mb-px rounded-t-md";
            const activeClassName = transparentChromeEnabled
              ? "border-border border-b-background bg-background/85 text-foreground backdrop-blur-xl"
              : "border-border border-b-background bg-background text-foreground";

            return (
              <div
                key={tabId}
                role="presentation"
                className={`group/tab flex h-8 min-w-0 max-w-44 shrink-0 items-center border px-0.5 transition-colors ${shapeClassName} ${
                  isActive
                    ? activeClassName
                    : "border-transparent bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                }`}
              >
                <Button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  variant="ghost"
                  size="sm"
                  onClick={() => selectTab(tabId)}
                  title={displayTitle}
                  className={`h-full min-w-0 flex-1 justify-start gap-1.5 bg-transparent px-2 py-0 text-xs font-normal hover:bg-transparent ${shapeClassName} ${
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${
                      STATUS_DOT[tab.status] ?? "bg-muted-foreground"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
                  {tab.unread && !isActive && (
                    <span className="size-1.5 shrink-0 rounded-full bg-info" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!isRuntimeReady}
                  onClick={() => {
                    void closeTab(tabId);
                  }}
                  title={`Close ${displayTitle}`}
                  aria-label={`Close ${displayTitle}`}
                  className={`mr-1 size-5 shrink-0 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground ${
                    isActive
                      ? "opacity-70 hover:opacity-100"
                      : "opacity-0 transition-opacity group-hover/tab:opacity-70 hover:!opacity-100 focus-visible:opacity-100"
                  }`}
                >
                  <X className="size-3" />
                </Button>
              </div>
            );
          })}

          <IconButton
            title="New terminal"
            onClick={handleNewTab}
            disabled={!isRuntimeReady}
            className="mb-0.5"
          >
            <Plus className="size-3 text-muted-foreground" />
          </IconButton>
        </div>
      </div>

      <div className="relative h-full w-full overflow-hidden bg-background flex-1">
        {tabIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <p className="text-xs text-muted-foreground">No terminals open</p>
            <Button onClick={handleNewTab} size="sm">
              New terminal
            </Button>
          </div>
        ) : (
          tabIds.map((tabId) => (
            <TerminalErrorBoundary key={tabId}>
              <TerminalViewport
                terminalId={tabId}
                visible={tabId === activeTabId}
                canConnect={isRuntimeReady && canConnectTabs && workspaceTabsLoaded}
                focusRequestToken={focusRequestToken}
              />
            </TerminalErrorBoundary>
          ))
        )}
      </div>
    </div>
  );
}

interface TerminalViewportProps {
  terminalId: string;
  visible: boolean;
  canConnect: boolean;
  focusRequestToken: number;
}

function TerminalViewport({
  terminalId,
  visible,
  canConnect,
  focusRequestToken,
}: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const connectionVersion = useTerminalStore(
    (state) => state.connectionVersionByTerminal[terminalId] ?? 0,
  );
  const { ensureTabConnection, resizeTab } = useTerminalActions();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (xtermRef.current) return; // already initialized

    setIsTerminalReady(false);
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let unsubscribeTheme = () => {};
    let unsubscribeData = () => {};

    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      // Check container is still in the DOM and we haven't already initialized
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

        // Double-check before attaching to DOM — the await above yields control
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

      // Final cancellation check after open()
      if (cancelled) {
        term.dispose();
        return;
      }

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      unsubscribeTheme = onThemeChange(() => {
        term.options.theme = getTerminalTheme();
      });

      unsubscribeData = onTerminalData(terminalId, (data) => {
        term.write(data);
      });

      term.onData((data) => {
        const wsHandle = getTerminalWsHandle(terminalId);
        wsHandle?.send(data);
      });

      term.onResize(({ cols, rows }) => {
        void resizeTab(terminalId, cols, rows);
        const handle = getTerminalWsHandle(terminalId);
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
  }, [terminalId, resizeTab]);

  useEffect(() => {
    if (!visible || !isTerminalReady || !canConnect) {
      return;
    }
    void ensureTabConnection(terminalId);
  }, [canConnect, connectionVersion, ensureTabConnection, isTerminalReady, terminalId, visible]);

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
      data-terminal-id={terminalId}
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
          Terminal crashed — switch tabs to recover
        </div>
      );
    }
    return this.props.children;
  }
}
