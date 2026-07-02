export const CHAT_COMPOSER_LABELS = {
  placeholder: "Describe a task",
  send: "Send message",
  stop: "Stop run",
} as const;

// Context-appropriate labels for the animated streaming/status indicator. The
// same shimmer used to say "Thinking" everywhere; callers now thread the label
// that matches their context ("Thinking" is agent work only).
export const CHAT_STREAMING_STATUS_LABELS = {
  thinking: "Thinking",
  sending: "Sending…",
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
  newChatBadge: "New chat",
  newChatHint: "Opens a new chat in this workspace",
  searchPlaceholder: "Search models",
  noMatchPrefix: "No models matching",
  noProviders: "No harnesses yet. Add one to get started.",
  addHarness: "Add harness",
} as const;
