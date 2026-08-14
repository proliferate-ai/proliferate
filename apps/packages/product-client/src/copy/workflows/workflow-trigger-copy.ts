/**
 * Authored strings for the Workflows gen-2 trigger dialog. Kept beside
 * `workflow-copy.ts` (the beta gate and auth interstitials) rather than
 * inline, following the same rule those modals follow: dialog copy is
 * authored text, not presentation logic.
 */
export const WORKFLOW_TRIGGER_COPY = {
  description: "Fill in this workflow's inputs and choose where the run works.",
  inputsEmpty: "This workflow takes no inputs.",
  optionalHint: "Optional",
  repositoryLabel: "Repository",
  repositoryPlaceholder: "Select a repository",
  repositoryUnavailable: (repoRootId: string) =>
    `Saved repository unavailable (${repoRootId})`,
  repositoriesLoadFailed:
    "Repositories could not be loaded. Close this dialog and try again.",
  placementLabel: "Placement",
  placementWorktree: "New worktree",
  placementRepoRoot: "Repo root",
  placementHelp:
    "A new worktree keeps this run isolated. Repo root runs in the existing checkout.",
  cancelLabel: "Cancel",
  confirmLabel: "Start run",
} as const;
