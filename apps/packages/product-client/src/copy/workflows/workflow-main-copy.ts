/**
 * Authored strings for the Workflows gen-2 main (list) surface. Kept beside
 * `workflow-builder-copy.ts`/`workflow-trigger-copy.ts` under the same rule
 * those files follow: authored text is copy, not presentation logic.
 */
export const WORKFLOW_MAIN_COPY = {
  pageTitle: "Workflows",
  pageDescription: "Saved workflow definitions and the runs recorded from them.",

  newWorkflowLabel: "New workflow",
  newBlankLabel: "Blank workflow",
  newFromTemplateSectionLabel: "From a template",
  newMenuLabel: "New workflow options",

  loadingTitle: "Loading workflows",
  loadingDescription: "Loading your saved workflows.",
  errorTitle: "Workflows could not be loaded",
  errorDescription: "The definitions list failed to load. Retrying does not lose any saved work.",
  retryLabel: "Retry",

  emptyTitle: "No workflows yet",
  emptyDescription: "Start from a template or build one from a blank chain.",
  useTemplateLabel: "Use template",
  startBlankLabel: "Start blank",

  runLabel: (title: string) => `Run ${title}`,
  editLabel: (title: string) => `Edit ${title}`,
  rowActionsLabel: (title: string) => `${title} actions`,
  deleteItemLabel: "Delete...",

  filterPlaceholder: "Filter workflows...",
  filterLabel: "Filter workflows",
  filterNoMatches: (query: string) => `Nothing matches “${query}”.`,

  savedGroupTitle: "Saved Workflows",
  savedGroupDescription: "Definitions you can run, edit, or start a new run from.",

  executionsGroupTitle: "Executions",
  executionsGroupDescription:
    "Runs recorded from these workflows. Selecting one opens its workspace.",
  // `definitionJson` carries no title today; same fallback the resume popover
  // wears until the frozen invocation contract grows one.
  executionFallbackTitle: "Workflow run",

  deleteConfirmTitle: "Delete this workflow?",
  deleteConfirmDescription: (title: string) =>
    `“${title}” and its saved definition will be removed. Runs already started are not affected.`,
  deleteCancelLabel: "Cancel",
  deleteConfirmLabel: "Delete",
  deleteErrorMessage: "This workflow could not be deleted. Try again.",

  unavailableTitle: "Workflows are being rebuilt",
  unavailableDescription: "This surface is not available in this build yet.",
} as const;
