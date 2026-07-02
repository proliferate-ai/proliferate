import { Button } from "@proliferate/ui/primitives/Button";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { RefreshCw } from "@proliferate/ui/icons";
import { useUpdater } from "@/hooks/access/tauri/use-updater";
import { useRunningAgentCount } from "@/hooks/app/lifecycle/use-running-agent-count";

export function UpdateRestartDialog() {
  const {
    phase,
    availableVersion,
    restartPromptOpen,
    closeRestartPrompt,
    scheduleRestartWhenIdle,
    restartNow,
  } = useUpdater();
  const runningCount = useRunningAgentCount();

  const ready = availableVersion
    ? `Proliferate ${availableVersion} is ready.`
    : "The update is ready.";
  const hasRunning = runningCount > 0;
  const runningLabel = runningCount === 1
    ? "1 session is running"
    : `${runningCount} sessions are running`;
  const stopClause = runningCount === 1
    ? "restarting stops it."
    : "restarting stops them.";
  const deferLabel = runningCount === 1
    ? "Restart when it finishes"
    : "Restart when they finish";

  return (
    <ModalShell
      open={restartPromptOpen && phase === "ready"}
      onClose={closeRestartPrompt}
      title="Restart to update"
      showCloseButton={false}
      sizeClassName="max-w-[440px]"
      // animate-dialog-pop-in: ModalShell itself renders static (kit Dialog has
      // no data-state animations), so the entrance motion rides the panel here.
      panelClassName="animate-dialog-pop-in !rounded-lg border-border/80 bg-card shadow-floating-dark"
      bodyClassName="px-5 pb-4 pt-0"
      // Later sits apart on the left; the restart choices cluster on the right.
      footerClassName="flex shrink-0 items-center gap-2 px-5 pb-5 pt-0"
      footer={(
        <>
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={closeRestartPrompt}
          >
            Later
          </Button>
          <Button
            variant={hasRunning ? "secondary" : "primary"}
            size="sm"
            onClick={() => void restartNow()}
          >
            Restart now
          </Button>
          {hasRunning ? (
            <Button variant="primary" size="sm" onClick={scheduleRestartWhenIdle}>
              {deferLabel}
            </Button>
          ) : null}
        </>
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-foreground/5">
          <RefreshCw className="size-4 text-special" />
        </span>
        <div className="min-w-0 space-y-0.5 pt-0.5">
          <p className="text-ui text-foreground">{ready}</p>
          <p className="text-ui-sm text-muted-foreground">
            Restart now to switch over.
          </p>
        </div>
      </div>
      {hasRunning ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-border/70 bg-foreground/[0.03] px-3 py-2">
          <span className="relative flex size-1.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-special opacity-50 motion-reduce:hidden" />
            <span className="relative inline-flex size-1.5 rounded-full bg-special" />
          </span>
          <span className="text-ui-sm text-muted-foreground">
            <span className="text-foreground">{runningLabel}</span> — {stopClause}
          </span>
        </div>
      ) : null}
    </ModalShell>
  );
}
