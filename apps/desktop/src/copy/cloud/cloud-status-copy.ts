export const CLOUD_STATUS_COMPACT_COPY = {
  preparingTitle: "Preparing cloud workspace",
  preparingPhaseLabel: "Opening automatically when ready",
  firstRuntimeFooterMessage: "First cloud workspace for this repo can take longer while we start the shared runtime. Later workspaces usually reuse it.",
  syncingTitle: "Syncing workspace",
  attentionTitle: "Cloud workspace needs attention",
} as const;

export const CLOUD_STATUS_ACTION_COPY = {
  retry: "Retry",
} as const;
