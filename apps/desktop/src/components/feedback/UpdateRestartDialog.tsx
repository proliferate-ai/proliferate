import { Button } from "@proliferate/ui/primitives/Button";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
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
      bodyClassName="px-5 pb-5 pt-0"
      footerClassName="flex shrink-0 items-center justify-end gap-2 px-5 pb-5 pt-0"
      footer={(
        <>
          <Button variant="ghost" size="sm" onClick={closeRestartPrompt}>
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
      <p className="text-sm leading-relaxed text-muted-foreground">
        {hasRunning ? (
          <>
            {ready} <span className="text-foreground">{runningLabel}</span> — {stopClause}
          </>
        ) : (
          `${ready} Restart now to switch over.`
        )}
      </p>
    </ModalShell>
  );
}
