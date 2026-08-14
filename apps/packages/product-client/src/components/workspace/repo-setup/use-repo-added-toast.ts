import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { APP_ROUTES } from "#product/config/app-routes";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";
import { useHomeNextTargetSelectionState } from "#product/hooks/home/ui/use-home-next-target-selection-state";
import { dismissToast, showToast } from "#product/primitives/utils/show-toast";

/**
 * One live "repository added" toast at a time: adding a second repository
 * before the first receipt is dismissed replaces it rather than stacking two
 * cards that offer the same two decisions about different repos.
 */
export const REPO_ADDED_TOAST_ID = "repo-added";

/** Where the repository came from, which is the whole of the toast's detail line. */
export type RepoAddedSource = "local" | "cloud";

export interface RepoAddedToastInput {
  /** The repository's display name — the toast's headline. */
  repoName: string;
  /**
   * The settings identity of the new repository: a local checkout path, or the
   * `cloud:owner/name` key for a Cloud environment. Drives both actions.
   */
  sourceRoot: string;
  source: RepoAddedSource;
}

/**
 * The receipt for a completed add.
 *
 * This used to be a modal ("Repository added", Customize defaults / Done). A
 * modal is a question, and the add had already happened — there was nothing to
 * decide and no way to keep working until it was dismissed. The same content
 * as a toast keeps both onward moves (use it now, or configure it) reachable
 * without stopping anything.
 */
export function useRepoAddedToast() {
  const navigate = useNavigate();
  const { patchTargetSelection } = useHomeNextTargetSelectionState();

  return useCallback(({ repoName, sourceRoot, source }: RepoAddedToastInput) => {
    showToast({
      id: REPO_ADDED_TOAST_ID,
      weight: "announcement",
      tone: "success",
      badge: "Added",
      title: repoName,
      description: source === "cloud" ? "Proliferate Cloud" : sourceRoot,
      secondary: {
        label: "Create workspace",
        onClick: () => {
          patchTargetSelection({
            destination: "repository",
            repositorySelection: { kind: "repository", sourceRoot },
            baseBranchOverride: null,
          });
          navigate(APP_ROUTES.home);
          dismissToast(REPO_ADDED_TOAST_ID);
        },
      },
      commit: {
        label: "Customize defaults",
        onClick: () => {
          navigate(buildSettingsHref({ section: "repo", repo: sourceRoot }));
          dismissToast(REPO_ADDED_TOAST_ID);
        },
      },
    });
  }, [navigate, patchTargetSelection]);
}
