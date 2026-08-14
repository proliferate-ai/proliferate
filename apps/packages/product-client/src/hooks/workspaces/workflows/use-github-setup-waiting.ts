import { useCallback, useEffect, useState } from "react";
import {
  buildGitHubWaitingView,
  cloudEnvironmentAdminRequestCopy,
  type GitHubWaitingStep,
} from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-model";
import type { CloudRepoPickerBlockerView } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";
import { useGitHubAppStateInvalidation } from "#product/hooks/workspaces/cache/use-github-app-state-invalidation";

export interface GitHubSetupWaitingInput {
  /** Whether the hosting surface is showing the flow at all. */
  open: boolean;
  canManageInstallation: boolean;
  /** Whether the step the user is on still reports a setup blocker. */
  blocked: boolean;
}

export interface GitHubSetupWaitingResult {
  /**
   * Wrap a setup blocker so its CTA also parks the panel on the waiting state,
   * or replace it outright with that waiting state while the user is away.
   */
  decorateBlocker: (
    blocker: CloudRepoPickerBlockerView | null | undefined,
  ) => CloudRepoPickerBlockerView | null;
  /** True once the user has actually been sent to GitHub during this visit. */
  returnedFromGitHub: boolean;
  /** Leave the waiting panel without re-querying. */
  cancelWaiting: () => void;
}

/**
 * The "you're on GitHub now" leg of the add-repository flow.
 *
 * Manual re-check only: an auto-poll gives the user nothing to press while the
 * answer is still "not yet", and the trip can take minutes (see the waiting
 * view model).
 */
export function useGitHubSetupWaiting({
  open,
  canManageInstallation,
  blocked,
}: GitHubSetupWaitingInput): GitHubSetupWaitingResult {
  const invalidateGitHubAppState = useGitHubAppStateInvalidation();
  const [waitingStep, setWaitingStep] = useState<GitHubWaitingStep | null>(null);
  const [checking, setChecking] = useState(false);
  const [returnedFromGitHub, setReturnedFromGitHub] = useState(false);

  useEffect(() => {
    if (!open) {
      setWaitingStep(null);
      setChecking(false);
      setReturnedFromGitHub(false);
    }
  }, [open]);

  // The step has nothing left to block on, so the trip is over however it
  // ended — the manual re-check, a background refetch, or a window-focus
  // refetch. Drop the parked waiting step, or it resurrects on a LATER blocker
  // (a different gate, a different repo) as a panel about a trip already made.
  useEffect(() => {
    if (!blocked && waitingStep) {
      setWaitingStep(null);
      setChecking(false);
    }
  }, [blocked, waitingStep]);

  const checkAgain = useCallback(() => {
    setChecking(true);
    setReturnedFromGitHub(true);
    // The same invalidation the authorization/installation callback triggers.
    void invalidateGitHubAppState().finally(() => {
      setChecking(false);
      setWaitingStep(null);
    });
  }, [invalidateGitHubAppState]);

  const cancelWaiting = useCallback(() => {
    setWaitingStep(null);
    setChecking(false);
  }, []);

  const decorateBlocker = useCallback((
    blocker: CloudRepoPickerBlockerView | null | undefined,
  ): CloudRepoPickerBlockerView | null => {
    if (!blocker) {
      return null;
    }
    // Parked on GitHub: the checklist and its CTA would only restate the tab
    // the user is already looking at, so the waiting panel replaces both.
    if (waitingStep) {
      return {
        ...blocker,
        waiting: buildGitHubWaitingView({
          step: waitingStep,
          canManageInstallation,
          checking,
          requestText: canManageInstallation ? null : cloudEnvironmentAdminRequestCopy(),
          onCheckAgain: checkAgain,
          onCancel: cancelWaiting,
        }),
      };
    }
    const action = blocker.onAction;
    if (!action) {
      return blocker;
    }
    // Which trip this is, read off the checklist the blocker already carries.
    const nextWaitingStep: GitHubWaitingStep =
      blocker.steps?.[0]?.status === "complete" ? "install" : "authorize";
    return {
      ...blocker,
      onAction: () => {
        action();
        setWaitingStep(nextWaitingStep);
        // Departure, not the manual re-check, is what earns the arrival
        // confirmation: a background or window-focus refetch can clear the
        // blocker without the user ever pressing "Check again", and landing on
        // a bare repository list with no sign the connection worked is the
        // exact thing the banner exists to prevent.
        setReturnedFromGitHub(true);
      },
    };
  }, [
    cancelWaiting,
    canManageInstallation,
    checkAgain,
    checking,
    waitingStep,
  ]);

  return { decorateBlocker, returnedFromGitHub, cancelWaiting };
}
