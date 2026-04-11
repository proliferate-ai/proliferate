export const AUTH_GATE_LABELS = {
  loadingMessage: "Checking your session",
  loadingSubtext: "Proliferate is restoring your account before opening the workspace.",
} as const;

export const AUTH_LOGIN_LABELS = {
  intro: "Welcome! Sign in to get started.",
  signIn: "Sign in with GitHub",
  checking: "Checking GitHub sign-in...",
  waiting: "Waiting for GitHub...",
  continueLocally: "Continue locally",
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
