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
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  Check,
  ChevronDown,
  Pencil,
  Plus,
  RefreshCw,
  Terminal as TerminalIcon,
  X,
} from "@/components/ui/icons";
import { useTerminalStore } from "@/stores/terminal/terminal-store";
import {
  subscribeWithReplay,
  TERMINAL_OUTPUT_GAP_MESSAGE,
  type TerminalReplayEntry,
  type TerminalStreamIdentity,
} from "@/lib/workflows/terminals/terminal-stream-registry";
import { useTerminalActions } from "@/hooks/terminals/use-terminal-actions";
import { getTerminalTheme, onThemeChange } from "@/config/theme";
import { useRerunSetupMutation } from "@anyharness/sdk-react";
import { useToastStore } from "@/stores/toast/toast-store";

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
  unreadByTerminal: Record<string, boolean>;
  onNewTerminal: () => void;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
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
  unreadByTerminal,
  onNewTerminal,
  onSelectTerminal,
  onCloseTerminal,
  onRenameTerminal,
}: TerminalPanelProps) {
  const activeTerminal = terminals.find((terminal) => terminal.id === activeTerminalId) ?? null;

  return (
    <div className="flex h-full flex-col" data-telemetry-block data-focus-zone="terminal">
      <TerminalTopBar
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        unreadByTerminal={unreadByTerminal}
        isRuntimeReady={isRuntimeReady}
        onSelectTerminal={onSelectTerminal}
        onCloseTerminal={onCloseTerminal}
        onRenameTerminal={onRenameTerminal}
        onNewTerminal={onNewTerminal}
      />
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
        ) : !activeTerminal ? (
          <TerminalEmptyState label="Terminal unavailable" />
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
        {activeTerminal && workspaceId && (
          <TerminalCommandFloatingAction
            terminal={activeTerminal}
            workspaceId={workspaceId}
          />
        )}
      </div>
    </div>
  );
}

function TerminalTopBar({
  terminals,
  activeTerminalId,
  unreadByTerminal,
  isRuntimeReady,
  onSelectTerminal,
  onCloseTerminal,
  onRenameTerminal,
  onNewTerminal,
}: {
  terminals: readonly TerminalRecord[];
  activeTerminalId: string | null;
  unreadByTerminal: Record<string, boolean>;
  isRuntimeReady: boolean;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
  onNewTerminal: () => void;
}) {
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null);
  const activeTerminalIndex = terminals.findIndex((terminal) => terminal.id === activeTerminalId);
  const activeTerminal = activeTerminalIndex >= 0 ? terminals[activeTerminalIndex] : null;
  const activeTitle = activeTerminal
    ? terminalDisplayTitle(activeTerminal, activeTerminalIndex)
    : "Terminal";

  const beginRename = (terminal: TerminalRecord, index: number) => {
    setEditingTerminalId(terminal.id);
    setRenameDraft(terminalDisplayTitle(terminal, index));
  };

  const submitRename = (terminalId: string) => {
    const title = renameDraft.trim();
    if (!title || title.length > 160) {
      return;
    }
    setRenamingTerminalId(terminalId);
    onRenameTerminal(terminalId, title)
      .then(() => {
        setEditingTerminalId(null);
      })
      .catch(() => undefined)
      .finally(() => setRenamingTerminalId(null));
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar-background px-2 text-sidebar-foreground">
      <PopoverButton
        align="start"
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-w-0 flex-1 justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <TerminalIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate text-left">{activeTitle}</span>
            <ChevronDown className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
          </Button>
        }
        className="w-72 rounded-md border border-sidebar-border bg-sidebar-background p-1 shadow-floating"
      >
        {(close) => (
          <div className="max-h-80 overflow-y-auto py-0.5">
            {terminals.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-sidebar-muted-foreground">
                No terminals
              </div>
            ) : (
              terminals.map((terminal, index) => {
                const displayTitle = terminalDisplayTitle(terminal, index);
                const isActive = terminal.id === activeTerminalId;
                const isEditing = editingTerminalId === terminal.id;
                const isRenaming = renamingTerminalId === terminal.id;
                return (
                  <div
                    key={terminal.id}
                    className="group/terminal-row flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-sidebar-foreground hover:bg-sidebar-accent"
                  >
                    {isEditing ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitRename(terminal.id);
                        }}
                      >
                        <Input
                          value={renameDraft}
                          maxLength={160}
                          autoFocus
                          onChange={(event) => setRenameDraft(event.target.value)}
                          className="h-7 min-w-0 flex-1 border-sidebar-border bg-sidebar-background text-xs text-sidebar-foreground"
                        />
                        <IconButton
                          size="xs"
                          tone="sidebar"
                          title="Save terminal title"
                          type="submit"
                          disabled={isRenaming || !renameDraft.trim()}
                        >
                          <Check className="ui-icon" />
                        </IconButton>
                        <IconButton
                          size="xs"
                          tone="sidebar"
                          title="Cancel terminal title edit"
                          onClick={() => setEditingTerminalId(null)}
                        >
                          <X className="ui-icon" />
                        </IconButton>
                      </form>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="unstyled"
                          className="min-w-0 flex-1 justify-start gap-2 rounded-md px-1.5 py-1 text-xs text-sidebar-foreground hover:bg-transparent hover:text-sidebar-foreground"
                          onClick={() => {
                            onSelectTerminal(terminal.id);
                            close();
                          }}
                        >
                          <TerminalIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {displayTitle}
                          </span>
                          {unreadByTerminal[terminal.id] && (
                            <span
                              className="size-1.5 rounded-full bg-sidebar-foreground"
                              aria-hidden="true"
                            />
                          )}
                          {isActive && (
                            <span className="text-[10px] text-sidebar-muted-foreground">
                              Active
                            </span>
                          )}
                        </Button>
                        <IconButton
                          size="xs"
                          tone="sidebar"
                          title={`Rename ${displayTitle}`}
                          onClick={() => beginRename(terminal, index)}
                        >
                          <Pencil className="ui-icon" />
                        </IconButton>
                        <IconButton
                          size="xs"
                          tone="sidebar"
                          title={`Close ${displayTitle}`}
                          disabled={!isRuntimeReady}
                          onClick={() => {
                            onCloseTerminal(terminal.id);
                            close();
                          }}
                        >
                          <X className="ui-icon" />
                        </IconButton>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </PopoverButton>
      <IconButton
        size="sm"
        tone="sidebar"
        title="New terminal"
        disabled={!isRuntimeReady}
        onClick={onNewTerminal}
      >
        <Plus className="ui-icon" />
      </IconButton>
    </div>
  );
}

function TerminalCommandFloatingAction({
  terminal,
  workspaceId,
}: {
  terminal: TerminalRecord;
  workspaceId: string;
}) {
  const showToast = useToastStore((state) => state.show);
  const rerunSetup = useRerunSetupMutation();
  const { rerunCommand } = useTerminalActions();
  const [isRerunning, setIsRerunning] = useState(false);
  const command = terminal.commandRun?.command?.trim() ?? "";
  const isSetup = terminal.purpose === "setup";
  const isRun = terminal.purpose === "run";

  if (!command || (!isSetup && !isRun)) {
    return null;
  }

  const label = isSetup ? "Rerun setup command" : "Rerun run command";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end px-3 pt-3">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="pointer-events-auto border border-border/60 bg-background/95 shadow-floating backdrop-blur hover:bg-accent"
        disabled={isRerunning || rerunSetup.isPending}
        onClick={() => {
          setIsRerunning(true);
          const operation = isSetup
            ? rerunSetup.mutateAsync(workspaceId)
            : rerunCommand(terminal.id, workspaceId, command);
          void operation
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              showToast(`Failed to rerun command: ${message}`);
            })
            .finally(() => setIsRerunning(false));
        }}
      >
        <RefreshCw className="size-3.5" />
        {label}
      </Button>
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
  const streamIdentityRef = useRef<TerminalStreamIdentity | null>(null);
  const unsubscribeReplayRef = useRef<(() => void) | null>(null);
  const connectionVersion = useTerminalStore(
    (state) => state.connectionVersionByTerminal[terminal.id] ?? 0,
  );
  const { ensureTabConnection, resizeTab, sendInput, sendResize } = useTerminalActions();

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

  return (
    <div
      ref={containerRef}
      data-telemetry-block
      className={`absolute inset-0 overflow-hidden ${visible ? "block" : "hidden"}`}
      data-terminal-id={terminal.id}
    />
  );
}

function terminalDisplayTitle(terminal: TerminalRecord, index: number): string {
  const fallbackTitle = `Terminal ${index + 1}`;
  return terminal.title === "Terminal" ? fallbackTitle : terminal.title;
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
