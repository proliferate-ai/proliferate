export const AUTOMATION_TEMPLATE_OPTIONS = [
  {
    title: "Check recent commits",
    prompt: "Scan recent commits since the last run, or the last 24 hours if there is no previous run. Look for likely bugs, regressions, risky migrations, and missing tests. Propose minimal fixes and call out anything that needs human review.",
  },
  {
    title: "Summarize CI failures",
    prompt: "Summarize CI failures and flaky tests from the last CI window. Group failures by likely root cause, identify the highest-impact fix first, and suggest the smallest useful next step.",
  },
  {
    title: "Draft release notes",
    prompt: "Draft weekly release notes from merged PRs. Group changes by theme, include links when available, and flag rollout risks or follow-up work.",
  },
  {
    title: "Prepare standup notes",
    prompt: "Summarize yesterday's git activity for standup. Focus on shipped work, blocked work, review needs, and any risk that should be mentioned.",
  },
] as const;

export const AUTOMATION_RUN_COPY = {
  queued: "Queued",
  claimed: "Claimed by executor",
  creatingWorkspace: "Creating cloud workspace",
  creatingLocalWorkspace: "Creating local worktree",
  provisioningWorkspace: "Preparing runtime",
  provisioningLocalWorkspace: "Preparing worktree",
  creatingSession: "Creating session",
  dispatching: "Sending prompt",
  dispatched: "Session started",
  failed: "Failed",
  localQueued: "Queued, local executor not available yet",
  cancelled: "Cancelled",
} as const;

export const AUTOMATION_PREEXECUTOR_COPY = {
  pageDescription: "Schedule recurring cloud or local agent sessions.",
  emptyState: "Create an automation to queue scheduled runs.",
  modalDescription: "Cloud automations start a new cloud workspace and session for each run.",
} as const;
