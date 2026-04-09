import type { AgentReadinessState } from "@anyharness/sdk";

export const AGENTS_PAGE_COPY = {
  title: "Agents",
  description: "Install and manage agent runtimes and authentication.",
  runtimeVersionPrefix: "Runtime v",
  reconnectTitle: "Could not connect to the AnyHarness runtime.",
  reconnectLoadingMessage: "Starting runtime",
  reconnectLoadingSubtext: "Connecting to AnyHarness...",
  loadingMessage: "Loading agents",
  loadingSubtext: "Fetching available agent runtimes...",
  loadErrorTitle: "Could not load agent state.",
  empty: "No agents available",
  reconcileAction: "Reinstall All",
  reconcileLoadingAction: "Installing...",
  reconcileError: "Could not reinstall the available agents.",
} as const;

export const AGENT_SETUP_COPY = {
  docs: "Docs",
  install: "Install",
  retryInstall: "Retry Install",
  installFailed: "Install failed",
  justInstalled: "Just installed",
  installing: "Installing...",
  apiKeys: "API Keys",
  cliLogin: "CLI Login",
  saveCredential: "Save",
  savedInKeychain: "Saved in Keychain",
  changeSavedCredential: "Change",
  loginAction: "Get login command",
  refreshLoginAction: "Refresh login command",
  noCredentials: "This agent has no configurable credentials.",
  savedChangesNotice: "Saved credentials will apply after the runtime restarts.",
  applyAndRestart: "Apply & Restart Runtime",
  applying: "Applying...",
  done: "Done",
  close: "Close",
  credentialPlaceholder: "Paste API key",
  subtitles: {
    ready: "Update authentication credentials",
    unsupported: "Runtime compatibility issue",
    retryInstall: "Retry installation",
    install: "Install and configure",
    credentials: "Configure credentials",
  },
} as const;

export const AGENT_READINESS_LABELS: Record<AgentReadinessState, string> = {
  ready: "Configured",
  install_required: "Install required",
  credentials_required: "Credentials required",
  login_required: "Login required",
  unsupported: "Unsupported",
  error: "Unavailable",
};

export const AGENT_STATUS_TONE_BADGE_CLASSNAMES = {
  muted: "border-border/60 bg-muted/35 text-muted-foreground",
  success: "border-success/20 bg-success/10 text-success/90",
  warning: "border-warning-border bg-warning text-warning-foreground",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
} as const satisfies Record<"muted" | "success" | "warning" | "destructive", string>;
