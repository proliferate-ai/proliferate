import { Button } from "@/components/ui/Button";
import { CircleAlert } from "@/components/ui/icons";
import { ModalShell } from "@/components/ui/ModalShell";

interface AppCloseWarningDialogProps {
  open: boolean;
  runningAgentCount: number;
  isQuitting: boolean;
  onClose: () => void;
  onHideWindow: () => void | Promise<void>;
  onQuitApp: () => void | Promise<void>;
}

export function AppCloseWarningDialog({
  open,
  runningAgentCount,
  isQuitting,
  onClose,
  onHideWindow,
  onQuitApp,
}: AppCloseWarningDialogProps) {
  const runningAgentLabel = runningAgentCount === 1
    ? "1 running agent will be paused."
    : `${runningAgentCount} running agents will be paused.`;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      sizeClassName="max-w-[420px]"
      title={(
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <CircleAlert className="size-4" />
          </span>
          <span className="text-base font-semibold text-foreground">Quit Proliferate?</span>
        </div>
      )}
      description="Closing the app pauses active agents until you reopen Proliferate."
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => void onHideWindow()}>
            Hide window
          </Button>
          <Button
            variant="destructive"
            loading={isQuitting}
            onClick={() => void onQuitApp()}
          >
            Quit app
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-sm font-medium text-foreground">
            {runningAgentCount > 0
              ? runningAgentLabel
              : "Any running agents will be paused."}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Hide the window to keep Proliferate running in the background, or quit if you are
            ready to stop here.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
