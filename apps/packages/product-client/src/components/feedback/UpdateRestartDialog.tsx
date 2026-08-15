import { Button } from "#product/primitives/Button";
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { RefreshCw } from "#product/primitives/icons/platform";
import { useUpdater } from "#product/hooks/access/tauri/use-updater";
import { useRunningAgentCount } from "#product/hooks/app/lifecycle/use-running-agent-count";
import { useRunningAgentSummaries } from "#product/hooks/app/lifecycle/use-running-agent-summaries";

// Cap the listed titles so a large batch of running sessions doesn't blow out
// the dialog; the remainder folds into an "and N more" tail.
const MAX_LISTED_TITLES = 5;

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
  const runningSummaries = useRunningAgentSummaries();

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

  // Untitled entries (no transcript title synced yet) never get listed
  // individually — the count-only copy already covers them, and a bare
  // "Untitled" line would be noise, not information.
  const listedTitles = runningSummaries
    .map((summary) => summary.title?.trim())
    .filter((title): title is string => Boolean(title))
    .slice(0, MAX_LISTED_TITLES);
  const remainingCount = Math.max(0, runningCount - listedTitles.length);

  return (
    <ModalShell
      open={restartPromptOpen && phase === "ready"}
      onClose={closeRestartPrompt}
      title="Restart to update"
      showCloseButton={false}
      sizeClassName="max-w-[440px]"
      // animate-dialog-pop-in: ModalShell itself renders static (kit Dialog has
      // no data-state animations), so the entrance motion rides the panel here.
      panelClassName="animate-dialog-pop-in !rounded-lg border-border/80 bg-card shadow-modal"
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
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-elevated-secondary">
          <RefreshCw className="icon-paired text-special" />
        </span>
        <div className="min-w-0 space-y-0.5 pt-0.5">
          <p className="text-ui text-foreground">{ready}</p>
          <p className="text-ui-sm text-muted-foreground">
            Restart now to switch over.
          </p>
        </div>
      </div>
      {hasRunning ? (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-border/70 bg-surface-elevated-secondary px-3 py-2">
          <span className="relative mt-1 flex size-1.5 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-special opacity-50 motion-reduce:hidden" />
            <span className="relative inline-flex icon-status rounded-full bg-special [font-size:var(--text-ui-sm)]" />
          </span>
          <div className="min-w-0 text-ui-sm text-muted-foreground">
            <p>
              <span className="text-foreground">{runningLabel}</span> — {stopClause}
            </p>
            {listedTitles.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {listedTitles.map((title, index) => (
                  <li key={`${title}-${index}`} className="truncate text-foreground">
                    {title}
                  </li>
                ))}
                {remainingCount > 0 ? (
                  <li className="text-muted-foreground">and {remainingCount} more</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}
