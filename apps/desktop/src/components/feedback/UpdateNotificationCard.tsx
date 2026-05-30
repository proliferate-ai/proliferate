import { useEffect, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { X } from "@proliferate/ui/icons";
import { useUpdater, type UpdaterPhase } from "@/hooks/access/tauri/use-updater";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";

const CHANGELOG_URL = "https://proliferate.com/changelog";

const UPDATE_CARD_PHASES = new Set<UpdaterPhase>([
  "available",
  "downloading",
  "ready",
]);

export function UpdateNotificationCard() {
  const {
    phase,
    availableVersion,
    restartPromptOpen,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();
  const { openExternal } = useTauriShellActions();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const visibleKey = [
    phase,
    availableVersion ?? "unknown",
    restartPromptOpen ? "prompt-open" : "prompt-closed",
  ].join(":");

  useEffect(() => {
    setDismissedKey(null);
  }, [visibleKey]);

  if (
    !UPDATE_CARD_PHASES.has(phase)
    || dismissedKey === visibleKey
    || (phase === "ready" && restartPromptOpen)
  ) {
    return null;
  }

  const card = updateCardPresentation(phase, availableVersion);
  const canDismiss = phase !== "downloading";

  return (
    <aside
      aria-label={card.ariaLabel}
      className="relative w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border/80 bg-card px-3 py-2.5 text-sm text-card-foreground shadow-floating-dark animate-toast-in"
    >
      {canDismiss ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label="Dismiss update notification"
          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => setDismissedKey(visibleKey)}
        >
          <X className="size-3" />
        </Button>
      ) : null}

      <div className={`${canDismiss ? "pr-7" : ""}`}>
        <h2 className="select-text truncate text-[13px] font-medium leading-5 text-card-foreground">
          {card.title}
        </h2>
        <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
          {card.description}
        </p>
      </div>

      {phase !== "downloading" ? (
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => { void openExternal(CHANGELOG_URL); }}
          >
            See changes
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => {
              if (phase === "available") {
                void downloadUpdate();
                return;
              }
              if (phase === "ready") {
                openRestartPrompt();
              }
            }}
          >
            {card.actionLabel}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function updateCardPresentation(
  phase: UpdaterPhase,
  availableVersion: string | null,
) {
  const versionLabel = availableVersion ? ` ${availableVersion}` : "";

  if (phase === "downloading") {
    return {
      phase,
      ariaLabel: "Desktop update is downloading",
      title: "Downloading update",
      description: "Preparing the update in the background.",
      actionLabel: "Downloading",
    } as const;
  }

  if (phase === "ready") {
    return {
      phase,
      ariaLabel: "Desktop update is ready to install",
      title: "Update ready",
      description: `Restart to finish installing Proliferate${versionLabel}.`,
      actionLabel: "Restart",
    } as const;
  }

  return {
    phase: "available",
    ariaLabel: "Desktop update is available",
    title: "Update available",
    description: `Proliferate${versionLabel} is ready to download.`,
    actionLabel: "Download",
  } as const;
}
