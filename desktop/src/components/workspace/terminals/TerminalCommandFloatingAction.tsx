import { useState } from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { useRerunSetupMutation } from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import { RefreshCw } from "@/components/ui/icons";
import { useTerminalActions } from "@/hooks/terminals/workflows/use-terminal-actions";
import { useToastStore } from "@/stores/toast/toast-store";

export function TerminalCommandFloatingAction({
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
