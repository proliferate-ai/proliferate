export const CHAT_COMPOSER_LABELS = {
  placeholder: "Describe a task",
  send: "Send message",
  stop: "Stop run",
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
  noProviders: "No configured providers. Add one to get started.",
  addProvider: "Add provider",
} as const;
