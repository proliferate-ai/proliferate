import { useEffect, useRef } from "react";
import {
  dismissToast,
  showToast,
} from "#product/primitives/utils/show-toast";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useUpdater, type UpdaterPhase } from "#product/hooks/access/tauri/use-updater";
import { useAppVersion } from "#product/hooks/access/tauri/app/use-app-version";
import { useRunningAgentCount } from "#product/hooks/app/lifecycle/use-running-agent-count";
import { RELEASE_NOTICE_CHANGELOG_URL } from "#product/config/release-notice";
import {
  formatStallDescription,
  formatStallTitle,
  stalledSeconds,
} from "#product/lib/domain/updates/download-stall";
import { RESTART_COUNTDOWN_MS } from "#product/hooks/access/tauri/use-update-restart-watcher";
import { useTickingSeconds } from "#product/hooks/activity/derived/use-ticking-seconds";

export const UPDATE_TOAST_ID = "app-update";
// The "you're up to date" receipt is a transient answer to a question the user
// asked, not a lifecycle phase, so it gets its own id — the morphing
// UPDATE_TOAST_ID is dismissed whenever the phase leaves the update flow.
export const UP_TO_DATE_TOAST_ID = "app-update-up-to-date";
export const RESTART_COUNTDOWN_TOAST_ID = "app-update-restart-countdown";

/**
 * The phases that speak. `checking` and `downloading` are deliberately absent:
 * the sidebar update button owns continuous state, and a toast that narrates
 * progress is a progress bar that steals focus. A toast fires only at a
 * resolution — ready, stalled, failed, or the receipt for a check the user
 * asked for.
 */
const UPDATE_TOAST_PHASES = new Set<UpdaterPhase>([
  "available",
  "stalled",
  "ready",
]);

const UPDATE_BADGE = "UPDATE";

/**
 * The update flow's toasts.
 *
 * Every one of them is an `announcement`: an update is consequential, so it
 * gets a headline, a consequence, and — where there is a choice — a cluster
 * with exactly one solid button. No layout is authored here; the weight decides
 * it, which is why the per-call specificity overrides this file used to carry
 * are gone.
 */
export function UpdateToastPresenter() {
  const {
    phase,
    availableVersion,
    availableTitle,
    errorMessage,
    errorSource,
    downloadProgress,
    lastProgressAt,
    downloadRetryCount,
    restartPromptOpen,
    restartCountdownStartedAt,
    manualCheckCompletedAt,
    downloadUpdate,
    retryDownload,
    cancelUpdate,
    skipVersion,
    cancelRestartCountdown,
    openRestartPrompt,
    restartNow,
    checkNow,
    clearManualCheckCompleted,
  } = useUpdater();
  const { data: currentVersion } = useAppVersion();
  const { openExternal } = useProductHost().links;
  // Read at click time, not render time: the ready toast persists, so whether
  // work is in flight must be answered when Restart is pressed.
  const runningCount = useRunningAgentCount();
  const runningCountRef = useRef(runningCount);
  runningCountRef.current = runningCount;
  // Session-scoped dismissal: closing the toast keeps it hidden until the
  // phase or version changes (progress ticks must not resurface it).
  const dismissedKeyRef = useRef<string | null>(null);
  const shownErrorRef = useRef<string | null>(null);
  // Two pieces of copy in this flow state a duration, and both are only true at
  // the instant they are computed. The clock runs only while one of them is on
  // screen.
  const nowMs = useTickingSeconds(
    phase === "stalled" || restartCountdownStartedAt !== null,
  );

  // One-shot "you're up to date" receipt. Only manual checks raise the signal —
  // a background check that finds nothing has nothing to report — and we clear
  // it right after surfacing so it never replays.
  useEffect(() => {
    if (manualCheckCompletedAt === null) {
      return;
    }
    showToast({
      id: UP_TO_DATE_TOAST_ID,
      weight: "announcement",
      title: "You're up to date",
      description: currentVersion
        ? `Proliferate ${currentVersion} is the latest — checked just now.`
        : "You're on the latest version — checked just now.",
      // No badge: a receipt for a question the user just asked needs no
      // domain eyebrow, and 4s is a glance.
      duration: 4_000,
    });
    clearManualCheckCompleted();
  }, [clearManualCheckCompleted, currentVersion, manualCheckCompletedAt]);

  // The cancellable countdown before a deferred relaunch. The watcher owns the
  // clock; this is the only warning the user gets, so it persists (it carries
  // actions) and dies when the countdown is cancelled.
  useEffect(() => {
    if (restartCountdownStartedAt === null) {
      dismissToast(RESTART_COUNTDOWN_TOAST_ID);
      return;
    }
    // The countdown supersedes the ready announcement. Both are about the same
    // update and both offer Restart, but once the clock is running the ready
    // toast's choice is already made — leaving it up asks the same question
    // twice and lets "Later" contradict a restart that is seconds away.
    dismissToast(UPDATE_TOAST_ID);
    // Counts down against the watcher's clock rather than restating the interval
    // constant: a toast that says "restarts in 10 seconds" for the whole ten
    // seconds and then restarts mid-sentence reads as a broken promise, and the
    // number is the entire reason the warning window exists.
    const remainingMs = restartCountdownStartedAt + RESTART_COUNTDOWN_MS - nowMs;
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    showToast({
      id: RESTART_COUNTDOWN_TOAST_ID,
      weight: "announcement",
      badge: UPDATE_BADGE,
      tone: "info",
      title: "Restarting to update",
      // Split for the same reason the number exists at all. Sonner's toast list
      // is a `polite` live region with `aria-relevant="additions text"`, so a
      // description that changes every second is re-announced every second —
      // the ticking numeral that makes the warning honest to a sighted user
      // would make it unusable to a screen-reader user. So the numeral is
      // hidden from assistive tech and a stable sentence carries the same
      // meaning without the count, which announces once and stays quiet.
      description: (
        <>
          <span aria-hidden="true">
            {`Your sessions finished, so Proliferate restarts in ${seconds} second${seconds === 1 ? "" : "s"}.`}
          </span>
          <span className="sr-only">
            Your sessions finished, so Proliferate restarts in a few seconds.
            Choose Restart now, or Not now to cancel.
          </span>
        </>
      ),
      secondary: { label: "Not now", onClick: cancelRestartCountdown },
      commit: { label: "Restart now", onClick: () => void restartNow() },
    });
  }, [cancelRestartCountdown, nowMs, restartCountdownStartedAt, restartNow]);

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
      dismissToast(UP_TO_DATE_TOAST_ID);
      showToast({
        id: UPDATE_TOAST_ID,
        weight: "announcement",
        badge: UPDATE_BADGE,
        tone: "destructive",
        title: checkFailed ? "Couldn't check for updates" : "Update failed",
        // The description states the consequence; the raw updater string is the
        // cause and goes to Details, per the kit's rule that a cause is never
        // rendered in the body. Putting the exception text here would both break
        // that rule and leave the full message nowhere else to be read.
        description: checkFailed
          ? "Check your connection and try again. You're still on the version you had."
          : `The update wasn't installed, so you're still on ${currentVersion ?? "the version you had"}.`,
        details: {
          kind: "modal",
          title: checkFailed ? "Couldn't check for updates" : "Update failed",
          payload: errorMessage,
        },
        // A failure the user can act on never auto-closes: `isError` plus the
        // Retry action both force persistence.
        isError: true,
        secondary: { label: "Dismiss", onClick: cancelUpdate },
        // Retry has to redo the thing that failed. A failed CHECK never
        // populated the store's update handle, and both download paths bail on
        // `if (!update) return` — so routing a check failure at a download made
        // the only button on a toast that never auto-closes a silent no-op.
        commit: {
          label: "Retry",
          onClick: () => {
            void (checkFailed ? checkNow() : retryDownload());
          },
        },
      });
      return;
    }

    // Two things outrank the ready announcement, and for the same reason: the
    // dialog and the countdown have each already taken the decision it asks
    // for. Suppressed here as well as dismissed above, or the next store update
    // re-raises it underneath whichever one is showing.
    const readyIsSuperseded =
      phase === "ready" && (restartPromptOpen || restartCountdownStartedAt !== null);

    if (
      !UPDATE_TOAST_PHASES.has(phase)
      || dismissedKeyRef.current === dismissalKey
      || readyIsSuperseded
    ) {
      if (readyIsSuperseded) {
        dismissToast(UPDATE_TOAST_ID);
      }
      if (!UPDATE_TOAST_PHASES.has(phase) && phase !== "error") {
        dismissToast(UPDATE_TOAST_ID);
      }
      return;
    }

    // An update entering the flow supersedes the "you're up to date"
    // receipt — the two contradict each other in the stack.
    dismissToast(UP_TO_DATE_TOAST_ID);

    const versionLabel = availableVersion ? ` ${availableVersion}` : "";
    const releaseTitle = availableTitle;
    // Closing a toast is an answer, so it has to stick: without this the next
    // store update would re-raise the same id and the close would look broken.
    const onDismiss = () => {
      dismissedKeyRef.current = dismissalKey;
    };

    if (phase === "available") {
      // Reached only when auto-update is off (useAutoUpdateDownload starts the
      // download otherwise), so asking for a click is honest here.
      showToast({
        id: UPDATE_TOAST_ID,
        weight: "announcement",
        badge: UPDATE_BADGE,
        title: releaseTitle ?? "Update available",
        onDismiss,
        description: `Proliferate${versionLabel} is ready to download. Automatic updates are off.`,
        link: {
          label: "What's new",
          onClick: () => void openExternal(RELEASE_NOTICE_CHANGELOG_URL),
        },
        secondary: { label: "Skip this version", onClick: skipVersion },
        commit: { label: "Download update", onClick: () => void downloadUpdate() },
      });
      return;
    }

    if (phase === "stalled") {
      const seconds = stalledSeconds(lastProgressAt, nowMs);
      showToast({
        id: UPDATE_TOAST_ID,
        weight: "announcement",
        badge: UPDATE_BADGE,
        tone: "warning",
        title: formatStallTitle(downloadProgress),
        onDismiss,
        description: formatStallDescription(seconds, downloadRetryCount),
        secondary: { label: "Cancel update", onClick: cancelUpdate },
        commit: { label: "Retry now", onClick: () => void retryDownload() },
      });
      return;
    }

    // ready — the one interrupting announcement in the flow. Restart commits
    // directly; the confirm dialog exists only for the running-sessions case,
    // which `restartNow` itself routes to.
    showToast({
      id: UPDATE_TOAST_ID,
      weight: "announcement",
      badge: UPDATE_BADGE,
      tone: "success",
      title: releaseTitle ?? `Proliferate${versionLabel} is ready`,
      onDismiss,
      description: "Restart takes about 5 seconds and reopens where you left off.",
      link: {
        label: "What's new",
        onClick: () => void openExternal(RELEASE_NOTICE_CHANGELOG_URL),
      },
      secondary: {
        label: "Later",
        onClick: () => {
          dismissedKeyRef.current = dismissalKey;
          dismissToast(UPDATE_TOAST_ID);
        },
      },
      // Restart commits directly. The confirm dialog only earns its
      // interruption when restarting would kill work in flight.
      commit: {
        label: "Restart",
        onClick: () => {
          if (runningCountRef.current > 0) {
            openRestartPrompt();
            return;
          }
          void restartNow();
        },
      },
    });
  }, [
    availableTitle,
    availableVersion,
    cancelUpdate,
    checkNow,
    downloadProgress,
    downloadRetryCount,
    downloadUpdate,
    errorMessage,
    errorSource,
    lastProgressAt,
    nowMs,
    openExternal,
    openRestartPrompt,
    phase,
    restartCountdownStartedAt,
    restartNow,
    restartPromptOpen,
    retryDownload,
    skipVersion,
  ]);

  return null;
}
