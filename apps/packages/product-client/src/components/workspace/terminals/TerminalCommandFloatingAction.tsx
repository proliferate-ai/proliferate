import { useState } from "react";
import type { TerminalRecord } from "@anyharness/sdk";
import { useRerunSetupMutation } from "@anyharness/sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { RefreshCw } from "@proliferate/ui/icons";
import { useTerminalActions } from "#product/hooks/terminals/workflows/use-terminal-actions";
import { useToastStore } from "#product/stores/toast/toast-store";

export function TerminalCommandFloatingAction({
  terminal,
  workspaceId,
}: {
  terminal: TerminalRecord;
  workspaceId: string;
}) {
  const showErrorToast = useToastStore((state) => state.showError);
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
        className="pointer-events-auto border border-border/60 bg-background/95 shadow-popover backdrop-blur hover:bg-hover active:bg-active"
        disabled={isRerunning || rerunSetup.isPending}
        onClick={function rerun() {
          setIsRerunning(true);
          const operation = isSetup
            ? rerunSetup.mutateAsync(workspaceId)
            : rerunCommand(terminal.id, workspaceId, command);
          void operation
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              showErrorToast({
                // Two literal headlines, because the two commands are different
                // things to a person and the label above already says which.
                headline: isSetup ? "Setup command not rerun" : "Run command not rerun",
                consequence: "The terminal is unchanged; nothing was started.",
                cause: message,
                retry: rerun,
              });
            })
            .finally(() => setIsRerunning(false));
        }}
      >
        <RefreshCw className="icon-paired" />
        {label}
      </Button>
    </div>
  );
}
