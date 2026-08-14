/**
 * Authored strings for the Workflows gen-2 run view (the right-panel pane).
 * Kept beside `workflow-trigger-copy.ts` under the same rule: pane copy is
 * written text, not presentation logic, so it lives here rather than inline
 * in the pane and the facade.
 *
 * The two functions take already-rendered labels rather than node rows: this
 * module stays free of SDK types, and the caller decides what a node is
 * called. `nodeLabel` is the one place that decides what that rendering is.
 */
export const WORKFLOW_RUN_VIEW_COPY = {
  /** Right-panel header title, and the header entry's tab label. */
  paneTitle: "Workflow",

  /** The run exists but the projection has not arrived yet. */
  loading: "Loading run…",
  /** The workspace has no gen-2 run at all. */
  emptyTitle: "No workflow run here",
  emptyDescription:
    "Start a workflow from the workflows page and its run appears in this pane.",
  /** The runs list or the run projection could not be read. */
  errorTitle: "This run is unavailable",
  errorDescription:
    "The runtime did not return this workflow run. It may still be starting up.",

  /** Section labels inside the pane. */
  graphSectionTitle: "Steps",
  docsSectionTitle: "Documents",
  /** The run exists and has produced no documents yet. */
  docsEmpty: "No documents yet. Nodes write them as they finish.",

  /** The interrupted-run banner and its one action. */
  resumeTitle: "This run is paused",
  resumeBody: "Nothing advances until you resume it.",
  resumeAction: "Resume",

  /** Eyebrow on every toast this pane raises. */
  toastBadge: "WORKFLOW",
  /**
   * How a node is named in a toast: its chain position when it has one (ad hoc
   * side nodes do not), then its title.
   */
  nodeLabel: (node: { chainIndex: number | null; title: string }): string =>
    node.chainIndex === null
      ? node.title
      : `${node.chainIndex + 1}. ${node.title}`,
  /** The auto-advance toast: what just finished, and what started in its place. */
  autoAdvanceTitle: (completedLabel: string, startedLabel: string): string =>
    `${completedLabel} done, ${startedLabel} started`,
  autoAdvanceDescription: "Undo puts the run back on the finished step.",
  undoLabel: "Undo",

  /**
   * A control the user pressed was already illegal by the time it landed
   * (WORKFLOW_TRANSITION_ILLEGAL / 409): the run moved underneath them, which
   * is a race with the run, never a broken button.
   */
  raceTitle: "The run already moved on",
  raceDescription: "That step changed before the action reached it. The pane is now up to date.",

  /** Any other command failure. The exception itself rides in `cause`. */
  commandFailedHeadline: "Workflow action failed",
  commandFailedConsequence: "The run is unchanged.",
} as const;
