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

  const installed = availableVersion
    ? `Proliferate ${availableVersion} is installed.`
    : "The update is installed.";
  const hasRunning = runningCount > 0;
  const runningLabel = runningCount === 1
    ? "1 session is running"
    : `${runningCount} sessions are running`;
  const stopClause = runningCount === 1
    ? "restarting will stop it."
    : "restarting will stop them.";

  return (
    <ModalShell
      open={restartPromptOpen && phase === "ready"}
      onClose={closeRestartPrompt}
      title="Restart to finish updating"
      showCloseButton={false}
      sizeClassName="max-w-[440px]"
      panelClassName="!rounded-lg border-border/80 bg-card shadow-floating-dark"
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
              Restart when they finish
            </Button>
          ) : null}
        </>
      )}
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        {hasRunning ? (
          <>
            {installed} <span className="text-foreground">{runningLabel}</span> — {stopClause}
          </>
        ) : (
          `${installed} It’s ready to use.`
        )}
      </p>
    </ModalShell>
  );
}
