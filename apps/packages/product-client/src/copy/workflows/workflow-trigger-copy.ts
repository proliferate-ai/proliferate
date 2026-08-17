/**
 * Authored strings for the Workflows gen-2 trigger dialog. Kept beside
 * `workflow-copy.ts` (the beta gate and auth interstitials) rather than
 * inline, following the same rule those modals follow: dialog copy is
 * authored text, not presentation logic.
 */
export const WORKFLOW_TRIGGER_COPY = {
  manualDescription: "Manual trigger · this run is recorded like any scheduled one",
  inputsLabel: "Inputs",
  inputsEmpty: "This workflow takes no inputs.",
  optionalHint: "Optional",
  repositoryLabel: "Repository",
  repositoryPlaceholder: "Select a repository",
  repositoryUnavailable: (repoRootId: string) =>
    `Saved repository unavailable (${repoRootId})`,
  repositoriesLoadFailed:
    "Repositories could not be loaded. Close this dialog and try again.",
  placementLabel: "Placement",
  whereItRunsLabel: "Where it runs",
  placementWorktree: "Repository worktree",
  placementWorktreeHelp:
    "Default — a new branch and worktree cut from the repository's default branch",
  placementRepoRoot: "Repository root",
  placementRepoRootHelp: "Use the repository's existing checkout",
  locationSummaryPrefix: "Runs in",
  changeLocationLabel: "Change",
  cancelLabel: "Cancel",
  confirmLabel: "Run",
  runningLabel: "Running",
} as const;
