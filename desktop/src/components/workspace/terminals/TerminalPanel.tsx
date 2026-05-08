import type { TerminalRecord } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { Terminal as TerminalIcon } from "@/components/ui/icons";
import { TerminalCommandFloatingAction } from "@/components/workspace/terminals/TerminalCommandFloatingAction";
import { TerminalErrorBoundary } from "@/components/workspace/terminals/TerminalErrorBoundary";
import { TerminalTopBar } from "@/components/workspace/terminals/TerminalTopBar";
import { TerminalViewport } from "@/components/workspace/terminals/TerminalViewport";

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

function TerminalEmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
