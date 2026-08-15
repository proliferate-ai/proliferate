export const WORKFLOW_RESUME_COPY = {
  title: "Resume interrupted workflows",
  resumeLabel: "Resume",
  dismissLabel: "Dismiss",
  fallbackRunTitle: "Workflow run",
  moreRunsHint: (count: number) =>
    `And ${count} more — resuming or dismissing a run reveals the next.`,

  /**
   * The resume request itself failed — a runtime mid-restart is the case that
   * motivated this, and it is exactly the case where silence would be worst.
   *
   * The headline is a written line, never a built string: the exception rides in
   * `cause` and reaches the user only through the toast's Details strip (see
   * `scripts/check_toast_copy.py`). The consequence line has to state both
   * halves of what did not happen, because the row staying put is the other
   * half of this fix.
   */
  resumeFailedHeadline: "Workflow resume failed",
  resumeFailedConsequence: "The run is still paused, and it stays in this list.",
} as const;
