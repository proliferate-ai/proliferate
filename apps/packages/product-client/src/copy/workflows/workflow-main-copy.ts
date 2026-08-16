/**
 * Authored strings for the Workflows gen-2 main (list) surface. Kept beside
 * `workflow-builder-copy.ts`/`workflow-trigger-copy.ts` under the same rule
 * those files follow: authored text is copy, not presentation logic.
 */
export const WORKFLOW_MAIN_COPY = {
  pageTitle: "Workflows",
  pageDescription: "Reusable agent chains you can run against any repository.",

  loadingTitle: "Loading workflows",
  loadingDescription: "Loading your saved workflows.",
  errorTitle: "Could not load workflows",
  errorDescription: "Refresh the page or sign in again.",
  retryLabel: "Retry",

  runLabel: (title: string) => `Run ${title}`,

  filterPlaceholder: "Filter workflows...",
  filterLabel: "Filter workflows",

  createGroupTitle: "Create workflows",
  createBlankTitle: "Create a new workflow",
  createBlankSubtitle: "Start from an empty graph",
  runRowTitle: "Run this workflow",

  savedGroupTitle: "Saved Workflows",

  executionsGroupTitle: "Executions",
  executionsGroupDescription:
    "Runs recorded from these workflows. Selecting one opens its workspace.",
  // `definitionJson` carries no title today; same fallback the resume popover
  // wears until the frozen invocation contract grows one.
  executionFallbackTitle: "Workflow run",

  legacyGroupTitle: "Legacy",
  legacyGroupDescription:
    "Saved before workflows were rebuilt. These cannot be opened or run here — rebuild the ones you still want, then delete them.",
  legacyBadgeLabel: "v1",
  legacyDeleteLabel: (title: string) => `Delete ${title}`,

  deleteConfirmTitle: "Delete this workflow?",
  deleteConfirmDescription: (title: string) =>
    `“${title}” and its saved definition will be removed. Runs already started are not affected.`,
  deleteCancelLabel: "Cancel",
  deleteConfirmLabel: "Delete",
  deleteErrorMessage: "This workflow could not be deleted. Try again.",

  unavailableTitle: "Workflows are being rebuilt",
  unavailableDescription: "This surface is not available in this build yet.",
} as const;
