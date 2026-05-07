export const AUTH_GATE_LABELS = {
  loadingMessage: "Checking your session",
  loadingSubtext: "Proliferate is restoring your account before opening the workspace.",
} as const;

export const AUTH_LOGIN_LABELS = {
  title: "Let's help you get your life's work done.",
  detail: "Start by signing in with GitHub.",
  detailWithLocalPrefix: "Continue with GitHub, or",
  signIn: "Continue with GitHub",
  checking: "Checking GitHub sign-in...",
  waiting: "Waiting for GitHub...",
  continueLocally: "Start locally",
  continueLocallyInline: "start locally",
} as const;

export const AUTH_ACCOUNT_LABELS = {
  devBypassBadge: "Dev bypass",
  devBypassTitle: "Local development mode",
  devBypassLabel: "Signed in as",
  devBypassDescription:
    "Auth is bypassed. Set VITE_DEV_DISABLE_AUTH=false to use real sign-in and cloud workspaces.",
  signedInLabel: "Signed in as",
  anonymousTitle: "Not signed in",
  anonymousLabel: "Local mode",
  anonymousDescription:
    "Local workspaces are available without an account. Sign in to use cloud workspaces and credential sync.",
  localPill: "Local",
  signIn: "Sign in",
  checkingSignIn: "Checking GitHub...",
  signingIn: "Waiting for GitHub...",
  reconnect: "Reconnect",
  reconnecting: "Reconnecting...",
  manageAccess: "Manage access",
  signOut: "Sign out",
  signingOut: "Signing out...",
  sync: "Sync",
  syncing: "Syncing...",
  clear: "Clear",
  clearing: "Clearing...",
} as const;
