/**
 * Authored strings for the Workflows gen-2 main (list) surface. Kept beside
 * `workflow-builder-copy.ts`/`workflow-trigger-copy.ts` under the same rule
 * those files follow: authored text is copy, not presentation logic.
 */
export const WORKFLOW_MAIN_COPY = {
  pageTitle: "Workflows",
  pageDescription: "Reusable agent chains you can run against any repository.",

  newWorkflowLabel: "New workflow",
  newBlankLabel: "Blank workflow",
  newFromTemplateSectionLabel: "From a template",
  newMenuLabel: "New workflow options",

  loadingTitle: "Loading workflows",
  loadingDescription: "Loading your saved workflows.",
  errorTitle: "Could not load workflows",
  errorDescription: "Refresh the page or sign in again.",
  retryLabel: "Retry",

  emptyTitle: "No workflows yet",
  emptyDescription: "Start from a template or build one from a blank chain.",
  // A visible legacy group below contradicts "no workflows yet", so the empty
  // state says what is actually empty.
  emptyWithLegacyTitle: "Nothing rebuilt yet",
  emptyWithLegacyDescription:
    "Your earlier workflows are listed below as legacy. Start from a template or a blank chain to rebuild one.",
  useTemplateLabel: "Use template",
  startBlankLabel: "Start blank",

  runLabel: (title: string) => `Run ${title}`,
  editLabel: (title: string) => `Edit ${title}`,
  rowActionsLabel: (title: string) => `${title} actions`,
  deleteItemLabel: "Delete...",

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
