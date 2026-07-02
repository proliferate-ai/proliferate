export const AGENTS_OVERVIEW_COPY = {
  title: "Agents",
  description: "Installed coding agents and their models.",
  refresh: "Refresh",
  refreshing: "Refreshing...",
  refreshStarted: "Checking local agent installs.",
  loadingMessage: "Loading agents",
  loadingSubtext: "Fetching installed coding agents...",
  connectingMessage: "Connecting",
  connectingSubtext: "Waiting for the runtime before loading agents...",
  unavailableTitle: "Agents are unavailable",
  unavailableDescription: "Reconnect the runtime to manage coding agents.",
  installGate: {
    title: "No agents installed",
    description:
      "No coding agent harnesses are installed on this machine yet. Missing agents install on demand when a session starts.",
    action: "Check for installs",
  },
  status: {
    ready: "Ready",
    installing: "Installing...",
    installFailed: "Install failed",
    notInstalled: "Not installed",
    loginRequired: "Login required",
    credentialsRequired: "Credentials required",
    needsAttention: "Needs attention",
  },
} as const;
