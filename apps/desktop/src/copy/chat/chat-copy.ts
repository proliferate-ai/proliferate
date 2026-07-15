export const CHAT_COMPOSER_LABELS = {
  placeholder: "Describe a task, @mention files, run /commands",
  followUpPlaceholder: "Ask for a follow-up",
  send: "Send message",
  stop: "Stop run",
} as const;

// Labels for the animated streaming/status indicator. Dispatch and agent work
// both read as "Thinking" — the send/queue distinction is plumbing the user
// shouldn't have to care about, and one voice keeps the status line calm.
export const CHAT_STREAMING_STATUS_LABELS = {
  thinking: "Thinking",
  sending: "Thinking",
  steering: "Steering…",
  restoringSession: "Restoring session…",
} as const;

export const CHAT_MODE_CONTROL_LABELS = {
  shortcut: "Shift+Tab",
  cycleHint: "Cycle mode",
} as const;

export const CHAT_PRE_MESSAGE_LABELS = {
  readyTitle: "Ready when you are",
  loadingCaption: {
    "bootstrapping-workspace": "Preparing workspace",
    "opening-session": "Opening session",
    "connecting-stream": "Connecting",
    "loading-history": "Loading history",
    "awaiting-first-turn": null,
  },
} as const;

export const CHAT_MODEL_SELECTOR_LABELS = {
  empty: "Select model",
  unknownModel: "Unknown model",
  noProviders: "No harnesses yet. Add one to get started.",
} as const;
