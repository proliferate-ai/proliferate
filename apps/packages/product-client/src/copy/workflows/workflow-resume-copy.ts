export const WORKFLOW_RESUME_COPY = {
  title: "Resume interrupted workflows",
  resumeLabel: "Resume",
  dismissLabel: "Dismiss",
  fallbackRunTitle: "Workflow run",
  moreRunsHint: (count: number) =>
    `And ${count} more — resuming or dismissing a run reveals the next.`,
} as const;
