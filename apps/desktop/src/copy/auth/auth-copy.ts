export const AUTH_GATE_LABELS = {
  loadingMessage: "Checking your session",
  loadingSubtext: "Proliferate is restoring your account before opening the workspace.",
} as const;

// Shared by the persistent initial-page shell (loading -> auth). The heading is
// identical in both modes so it never reflows; the loading hint sits in the
// reserved action slot where the GitHub button lands.
export const AUTH_SCREEN_LABELS = {
  heading: "Let's get your life's work done.",
  loadingHint: "Restoring your session…",
} as const;

export const AUTH_LOGIN_LABELS = {
  title: "Let's help you get your life's work done.",
  detail: "Start by signing in with GitHub.",
  detailWithLocalPrefix: "Continue with GitHub, or",
  signIn: "Continue with GitHub",
  waiting: "Waiting for GitHub...",
  ssoSignIn: (displayName?: string | null) => (
    displayName ? `Continue with ${displayName}` : "Continue with SSO"
  ),
  ssoWaiting: "Waiting for SSO...",
  cancelSignIn: "Cancel sign-in",
  continueLocally: "Start locally",
  continueLocallyInline: "start locally",
  // Email/password sign-in (default surface when GitHub OAuth is not
  // configured on the connected server, e.g. self-hosted instances).
  emailFieldLabel: "Email",
  emailFieldPlaceholder: "you@company.com",
  passwordFieldLabel: "Password",
  passwordFieldPlaceholder: "Password",
  passwordSignIn: "Sign in",
  passwordWaiting: "Signing in...",
} as const;

// Connect-to-a-self-hosted-server flow: the sign-in screen's quiet secondary
// affordance plus its dialog copy.
export const CONNECT_SERVER_LABELS = {
  connectAffordance: "Connect to a server",
  connectedPrefix: "Connected to",
  reset: "Reset",
  dialogTitle: "Connect to a server",
  entryDescription: "Point this app at a self-hosted Proliferate server.",
  addressFieldLabel: "Server address",
  addressFieldPlaceholder: "https://proliferate.corp.example",
  continue: "Continue",
  checking: "Checking…",
  cancel: "Cancel",
  trustDescription: (host: string) => `You're connecting to ${host}.`,
  serverVersionLabel: (version: string) => `Server version ${version}`,
  // Shown when this desktop is older than the server's minimum supported
  // version. Not a hard block — the server advertises the floor and the user
  // is warned to update the desktop app.
  minVersionWarning: (minVersion: string) =>
    `This server needs desktop ${minVersion} or newer. Update the app if you hit problems.`,
  connect: "Connect",
  connecting: "Connecting…",
  useDifferentAddress: "Use a different address",
  // Shown when the connect flow is opened from an invite link issued by a
  // different server than the one this desktop is pointed at.
  inviteContext: "This invitation is hosted on a different Proliferate server.",
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
  checkingSignIn: "Checking GitHub…",
  signingIn: "Waiting for GitHub…",
  connectGitHub: "Connect GitHub",
  connectingGitHub: "Waiting for GitHub…",
  reconnect: "Reconnect",
  reconnecting: "Reconnecting…",
  manageAccess: "Manage access",
  signOut: "Sign out",
  signingOut: "Signing out…",
  sync: "Sync",
  syncing: "Syncing…",
  clear: "Clear",
  clearing: "Clearing…",
} as const;
