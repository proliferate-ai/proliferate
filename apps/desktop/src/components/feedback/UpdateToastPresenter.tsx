import { useEffect, useRef } from "react";
import { toast } from "@proliferate/ui/kit/Sonner";
import { CircleAlert } from "@proliferate/ui/icons";
import { useUpdater, type UpdaterPhase } from "@/hooks/access/tauri/use-updater";

export const UPDATE_TOAST_ID = "app-update";

const UPDATE_TOAST_PHASES = new Set<UpdaterPhase>([
  "available",
  "downloading",
  "ready",
]);

function DownloadProgressBar({ progress }: { progress: number | null }) {
  return (
    <span className="mt-1.5 block">
      <span className="block h-0.5 w-full overflow-hidden rounded-full bg-accent">
        <span
          className="block h-full rounded-full bg-special transition-[width] duration-300"
          style={{ width: `${Math.max(2, progress ?? 2)}%` }}
        />
      </span>
    </span>
  );
}

/**
 * Update lifecycle notifications as toasts (UX spec §12): available →
 * downloading (progress bar) → ready ("Restart to update", the toast's one
 * solid button + "Later" ghost). Errors reuse the same toast with a danger
 * icon. The restart confirm stays in UpdateRestartDialog.
 */
export function UpdateToastPresenter() {
  const {
    phase,
    availableVersion,
    errorMessage,
    downloadProgress,
    restartPromptOpen,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();
  // Session-scoped dismissal: closing the toast keeps it hidden until the
  // phase or version changes (progress ticks must not resurface it).
  const dismissedKeyRef = useRef<string | null>(null);
  const shownErrorRef = useRef<string | null>(null);

  useEffect(() => {
    const dismissalKey = `${phase}:${availableVersion ?? "unknown"}`;

    if (phase === "error" && errorMessage && shownErrorRef.current !== errorMessage) {
      shownErrorRef.current = errorMessage;
      toast("Update failed", {
        id: UPDATE_TOAST_ID,
        description: errorMessage,
        icon: <CircleAlert className="size-4 text-destructive" />,
        duration: 8000,
        action: undefined,
        cancel: undefined,
      });
      return;
    }

    if (
      !UPDATE_TOAST_PHASES.has(phase)
      || dismissedKeyRef.current === dismissalKey
      || (phase === "ready" && restartPromptOpen)
    ) {
      if (UPDATE_TOAST_PHASES.has(phase) && phase === "ready" && restartPromptOpen) {
        toast.dismiss(UPDATE_TOAST_ID);
      }
      if (!UPDATE_TOAST_PHASES.has(phase) && phase !== "error") {
        toast.dismiss(UPDATE_TOAST_ID);
      }
      return;
    }

    const versionLabel = availableVersion ? ` ${availableVersion}` : "";
    const onDismiss = () => {
      dismissedKeyRef.current = dismissalKey;
    };

    if (phase === "available") {
      toast("Update available", {
        id: UPDATE_TOAST_ID,
        description: `Proliferate${versionLabel} is ready to download.`,
        duration: Infinity,
        closeButton: true,
        onDismiss,
        action: {
          label: "Download",
          onClick: (event) => {
            event.preventDefault();
            void downloadUpdate();
          },
        },
        cancel: undefined,
        // Spec §12: Download is a ghost button; solid is reserved for Restart.
        classNames: {
          actionButton:
            "!bg-transparent !text-muted-foreground hover:!text-foreground !border !border-input",
        },
      });
      return;
    }

    if (phase === "downloading") {
      toast("Downloading update", {
        id: UPDATE_TOAST_ID,
        description: <DownloadProgressBar progress={downloadProgress} />,
        duration: Infinity,
        closeButton: true,
        onDismiss,
        action: undefined,
        cancel: undefined,
      });
      return;
    }

    // ready
    toast("Restart to update", {
      id: UPDATE_TOAST_ID,
      description: `Proliferate${versionLabel} is installed.`,
      duration: Infinity,
      onDismiss,
      action: {
        label: "Restart",
        onClick: (event) => {
          event.preventDefault();
          openRestartPrompt();
        },
      },
      cancel: {
        label: "Later",
        onClick: () => {
          dismissedKeyRef.current = dismissalKey;
        },
      },
    });
  }, [
    availableVersion,
    downloadProgress,
    downloadUpdate,
    errorMessage,
    openRestartPrompt,
    phase,
    restartPromptOpen,
  ]);

  return null;
}
