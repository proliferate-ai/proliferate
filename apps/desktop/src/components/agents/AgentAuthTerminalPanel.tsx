import type { AgentAuthTerminalSession } from "@/hooks/agents/workflows/use-agent-auth-terminal-workflow";
import { useCallback } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { TerminalErrorBoundary } from "@/components/workspace/terminals/TerminalErrorBoundary";
import { useAgentAuthTerminalViewport } from "@/hooks/agents/lifecycle/use-agent-auth-terminal-viewport";

interface AgentAuthTerminalPanelProps {
  session: AgentAuthTerminalSession;
  baseUrl: string;
  authToken?: string;
  onClose: (kind: string) => void;
  onExit: (kind: string, code: number | null) => void;
  onRestart: () => void;
}

export function AgentAuthTerminalPanel({
  session,
  baseUrl,
  authToken,
  onClose,
  onExit,
  onRestart,
}: AgentAuthTerminalPanelProps) {
  const terminal = session.terminal;
  const handleExit = useCallback((code: number | null) => {
    onExit(session.kind, code);
  }, [onExit, session.kind]);
  const { connectionError, containerRef } = useAgentAuthTerminalViewport({
    terminal,
    baseUrl,
    authToken,
    visible: Boolean(terminal),
    focusRequestToken: session.focusRequestToken,
    onExit: handleExit,
  });
  const statusText = terminal?.status === "exited"
    ? terminal.exitCode == null
      ? "Exited"
      : `Exited ${terminal.exitCode}`
    : terminal?.status === "failed"
      ? "Failed"
      : terminal
        ? "Running"
        : session.errorMessage
          ? "Needs retry"
        : session.isStarting
          ? "Opening"
          : "Idle";

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-sidebar" data-telemetry-block>
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span className="font-medium text-foreground">Auth terminal</span>
            <span className="text-muted-foreground">{statusText}</span>
          </div>
          {terminal ? (
            <p
              className="truncate font-mono text-xs leading-5 text-muted-foreground"
              title={terminal.commandDisplay}
            >
              {terminal.commandDisplay}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            loading={session.isStarting}
            onClick={onRestart}
          >
            {terminal ? "Restart auth" : "Retry auth"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onClose(session.kind)}
          >
            Close
          </Button>
        </div>
      </div>

      {session.message ? (
        <p className="border-b border-border/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {session.message}
        </p>
      ) : null}

      {session.errorMessage ? (
        <div className="border-b border-border/70 px-3 py-3 text-xs leading-relaxed text-destructive">
          {session.errorMessage}
        </div>
      ) : null}

      {connectionError ? (
        <div className="border-b border-border/70 px-3 py-2 text-xs text-warning">
          {connectionError}
        </div>
      ) : null}

      {session.errorMessage && !terminal ? null : (
        <div className="relative h-80 min-h-80 overflow-hidden">
          {session.isStarting && !terminal ? (
          <div className="flex h-full items-center px-3 text-xs text-muted-foreground">
            Opening auth terminal...
          </div>
          ) : terminal ? (
            <TerminalErrorBoundary>
              <div
                ref={containerRef}
                className="absolute inset-0 overflow-hidden px-2 py-2"
                data-terminal-id={terminal.id}
              />
            </TerminalErrorBoundary>
          ) : (
            <div className="flex h-full items-center px-3 text-xs text-muted-foreground">
              Terminal unavailable
            </div>
          )}
        </div>
      )}
    </div>
  );
}
