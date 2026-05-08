import type { TerminalRecord } from "@anyharness/sdk";
import { useTerminalViewport } from "@/hooks/terminals/lifecycle/use-terminal-viewport";

interface TerminalViewportProps {
  terminal: TerminalRecord;
  workspaceId: string | null;
  visible: boolean;
  canConnect: boolean;
  focusRequestToken: number;
}

export function TerminalViewport({
  terminal,
  workspaceId,
  visible,
  canConnect,
  focusRequestToken,
}: TerminalViewportProps) {
  const { containerRef } = useTerminalViewport({
    terminal,
    workspaceId,
    visible,
    canConnect,
    focusRequestToken,
  });

  return (
    <div
      ref={containerRef}
      data-telemetry-block
      className={`absolute inset-0 overflow-hidden ${visible ? "block" : "hidden"}`}
      data-terminal-id={terminal.id}
    />
  );
}
