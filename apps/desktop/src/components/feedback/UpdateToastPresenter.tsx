import { useEffect, useRef } from "react";
import { toast } from "@proliferate/ui/kit/Sonner";
import { CircleAlert } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { useUpdater, type UpdaterPhase } from "@/hooks/access/tauri/use-updater";
import { useAppVersion } from "@/hooks/access/tauri/app/use-app-version";

export const UPDATE_TOAST_ID = "app-update";
// The "you're up to date" confirmation is a transient success signal, not a
// lifecycle phase, so it gets its own id — the morphing UPDATE_TOAST_ID is
// dismissed whenever the phase leaves the update flow, which would kill it.
export const UP_TO_DATE_TOAST_ID = "app-update-up-to-date";

const UPDATE_TOAST_PHASES = new Set<UpdaterPhase>([
  "available",
  "downloading",
  "ready",
]);

const DOWNLOAD_ERROR_FALLBACK =
  "Something went wrong downloading the update. Try again.";

/**
 * Keep the raw updater message only when it reads like a sentence a human
 * wrote: short, single-line, no "Error:" prefixes or stack-frame markers.
 */
function humanizeDownloadError(message: string): string {
  const looksHuman =
    message.length < 80
    && !message.includes("\n")
    && !/error:/i.test(message)
    && !/\bat\s+\S+:\d+/.test(message);
  return looksHuman ? message : DOWNLOAD_ERROR_FALLBACK;
}

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

function AuthoredUpdateTitle({ title }: { title: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1.5">
      <Badge className="shrink-0">UPDATE</Badge>
      <span
        className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]"
        title={title}
      >
        {title}
      </span>
    </span>
  );
}

function TitledDownloadProgress({
  version,
  progress,
}: {
  version: string | null;
  progress: number | null;
}) {
  return (
    <span className="block">
      <span className="block">
        {version ? `Downloading Proliferate ${version}.` : "Downloading update."}
      </span>
      <DownloadProgressBar progress={progress} />
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
    availableTitle,
    errorMessage,
    errorSource,
    downloadProgress,
    restartPromptOpen,
    manualCheckCompletedAt,
    downloadUpdate,
    openRestartPrompt,
    clearManualCheckCompleted,
  } = useUpdater();
  const { data: currentVersion } = useAppVersion();
  // Session-scoped dismissal: closing the toast keeps it hidden until the
  // phase or version changes (progress ticks must not resurface it).
  const dismissedKeyRef = useRef<string | null>(null);
  const shownErrorRef = useRef<string | null>(null);

  // One-shot "you're up to date" confirmation: only manual checks raise the
  // signal, and we clear it right after surfacing so it never replays.
  useEffect(() => {
    if (manualCheckCompletedAt === null) {
      return;
    }
    toast("You're up to date", {
      id: UP_TO_DATE_TOAST_ID,
      description: currentVersion
        ? `Proliferate ${currentVersion} is the latest.`
        : "You're on the latest version.",
      duration: 4000,
      action: undefined,
      cancel: undefined,
    });
    clearManualCheckCompleted();
  }, [clearManualCheckCompleted, currentVersion, manualCheckCompletedAt]);

  useEffect(() => {
    const dismissalKey = `${phase}:${availableVersion ?? "unknown"}`;

    // Once the phase leaves "error", forget the shown message so a retry that
    // fails with the same message re-surfaces the toast.
    if (phase !== "error") {
      shownErrorRef.current = null;
    }

    if (phase === "error" && errorMessage && shownErrorRef.current !== errorMessage) {
      shownErrorRef.current = errorMessage;
      // Check failures get stable, actionable copy — the raw message is
      // usually a network-layer string. Download failures keep the store
      // message only when it's short and human.
      const checkFailed = errorSource === "check";
      toast.dismiss(UP_TO_DATE_TOAST_ID);
      toast(checkFailed ? "Couldn't check for updates" : "Update failed", {
        id: UPDATE_TOAST_ID,
        description: checkFailed
          ? "Check your connection and try again."
          : humanizeDownloadError(errorMessage),
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
      if (phase === "ready" && restartPromptOpen) {
        toast.dismiss(UPDATE_TOAST_ID);
      }
      if (!UPDATE_TOAST_PHASES.has(phase) && phase !== "error") {
        toast.dismiss(UPDATE_TOAST_ID);
      }
      return;
    }

    // An update entering the flow supersedes the "you're up to date"
    // confirmation — the two contradict each other in the stack.
    toast.dismiss(UP_TO_DATE_TOAST_ID);

    const versionLabel = availableVersion ? ` ${availableVersion}` : "";
    const authoredTitle = availableTitle ? (
      <AuthoredUpdateTitle title={availableTitle} />
    ) : null;
    const onDismiss = () => {
      dismissedKeyRef.current = dismissalKey;
    };

    if (phase === "available") {
      toast(authoredTitle ?? "Update available", {
        id: UPDATE_TOAST_ID,
        description: `Proliferate${versionLabel} — downloads in the background.`,
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
        // Spec §12: solid is reserved for Restart — Download stays secondary,
        // but quiet-secondary (faint fill + full-contrast label), not ghost:
        // muted-on-transparent was near-invisible on the toast surface.
        // [&&] doubles specificity: the kit's solid-primary default is also
        // !important, and sonner concatenates rather than replaces classNames.
        classNames: {
          actionButton:
            "[&&]:!bg-foreground/5 [&&]:!text-foreground [&&]:hover:!bg-foreground/10 [&&]:!border [&&]:!border-input",
        },
      });
      return;
    }

    if (phase === "downloading") {
      toast(authoredTitle ?? "Downloading update", {
        id: UPDATE_TOAST_ID,
        description: authoredTitle ? (
          <TitledDownloadProgress
            version={availableVersion}
            progress={downloadProgress}
          />
        ) : (
          <DownloadProgressBar progress={downloadProgress} />
        ),
        duration: Infinity,
        closeButton: true,
        onDismiss,
        action: undefined,
        cancel: undefined,
      });
      return;
    }

    // ready
    toast(authoredTitle ?? "Restart to update", {
      id: UPDATE_TOAST_ID,
      description: `Proliferate${versionLabel} is ready.`,
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
      // Sonner defaults every button to a 28px start margin; the pair should
      // read as one control cluster, so the action hugs the cancel.
      classNames: {
        actionButton: "!ml-2",
      },
    });
  }, [
    availableTitle,
    availableVersion,
    downloadProgress,
    downloadUpdate,
    errorMessage,
    errorSource,
    openRestartPrompt,
    phase,
    restartPromptOpen,
  ]);

  return null;
}
