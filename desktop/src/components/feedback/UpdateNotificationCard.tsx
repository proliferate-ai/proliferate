import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { X } from "@/components/ui/icons";
import { useUpdater, type UpdaterPhase } from "@/hooks/access/tauri/use-updater";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";

const CHANGELOG_URL = "https://proliferate.com/changelog";

const UPDATE_CARD_PHASES = new Set<UpdaterPhase>([
  "available",
  "downloading",
  "ready",
]);
const FORCE_DEV_UPDATE_CARD_PREVIEW = import.meta.env.DEV && import.meta.env.MODE !== "test";
const DEV_UPDATE_CARD_PREVIEW_PHASE: UpdaterPhase = "ready";
const DEV_UPDATE_CARD_PREVIEW_VERSION = "0.1.99";

export function UpdateNotificationCard() {
  const {
    phase,
    availableVersion,
    downloadProgress,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();
  const { openExternal } = useTauriShellActions();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const previewingDevCard = FORCE_DEV_UPDATE_CARD_PREVIEW && !UPDATE_CARD_PHASES.has(phase);
  const displayPhase = previewingDevCard ? DEV_UPDATE_CARD_PREVIEW_PHASE : phase;
  const displayAvailableVersion = previewingDevCard
    ? DEV_UPDATE_CARD_PREVIEW_VERSION
    : availableVersion;
  const visibleKey = `${displayPhase}:${displayAvailableVersion ?? "unknown"}`;

  useEffect(() => {
    setDismissedKey(null);
  }, [visibleKey]);

  if (!UPDATE_CARD_PHASES.has(displayPhase) || dismissedKey === visibleKey) {
    return null;
  }

  const card = updateCardPresentation(displayPhase, downloadProgress);

  return (
    <aside
      aria-label={card.ariaLabel}
      className="relative flex w-[min(22rem,calc(100vw-2rem))] flex-wrap items-start gap-2 rounded-lg border border-border bg-background px-3 py-3 pr-10 text-sm text-foreground shadow-floating-dark animate-toast-in"
    >
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

      <div className="w-full min-w-0">
        <h2 className="select-text truncate text-sm font-medium leading-5 text-foreground">
          {card.title}
        </h2>
      </div>

      {displayPhase === "downloading" && typeof downloadProgress === "number" && (
        <ProgressBar
          value={downloadProgress}
          className="h-1 w-full bg-muted"
          indicatorClassName="h-full bg-foreground transition-[width]"
        />
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-md border-input bg-background px-2.5 text-xs font-normal"
          onClick={() => { void openExternal(CHANGELOG_URL); }}
        >
          See changes
        </Button>
        <Button
          type="button"
          variant="inverted"
          size="sm"
          disabled={displayPhase === "downloading"}
          className="h-7 rounded-md px-2.5 text-xs font-medium"
          onClick={() => {
            if (displayPhase === "available") {
              void downloadUpdate();
              return;
            }
            if (displayPhase === "ready") {
              openRestartPrompt();
            }
          }}
        >
          {card.actionLabel}
        </Button>
      </div>
    </aside>
  );
}

function updateCardPresentation(
  phase: UpdaterPhase,
  downloadProgress: number | null,
) {
  if (phase === "downloading") {
    const progressLabel = typeof downloadProgress === "number" ? ` ${downloadProgress}%` : "";
    return {
      phase,
      ariaLabel: `Desktop update is downloading${progressLabel}`,
      title: "Downloading update",
      actionLabel: "Downloading",
    } as const;
  }

  if (phase === "ready") {
    return {
      phase,
      ariaLabel: "Desktop update is ready to install",
      title: "New update available",
      actionLabel: "Restart",
    } as const;
  }

  return {
    phase: "available",
    ariaLabel: "Desktop update is available",
    title: "New update available",
    actionLabel: "Download",
  } as const;
}
