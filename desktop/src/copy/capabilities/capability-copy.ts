export const CAPABILITY_COPY = {
  cloudDisabledDescription:
    "Cloud workspaces require a reachable control plane.",
  cloudDisabledDetails:
    "Proliferate could not reach the configured control plane. Local workspaces remain available.",
  cloudDisabledTooltip:
    "Cloud workspaces are unavailable because the configured control plane could not be reached.",
  cloudSignInDescription:
    "Cloud workspaces and credential sync are available when you're signed in.",
  cloudSignInDetails:
    "This control plane is reachable. Sign in to create cloud workspaces and sync credentials.",
  cloudSignInTooltip:
    "Sign in to create cloud workspaces.",
  cloudAuthUnavailableDescription:
    "This control plane is reachable, but desktop GitHub sign-in is not configured.",
  cloudAuthUnavailableDetails:
    "Add GitHub OAuth credentials to this environment to enable desktop sign-in and cloud workspace creation.",
  cloudDocsLabel: "Open setup docs",
  accountLocalDescription:
    "Cloud features require a reachable control plane.",
  accountAuthUnavailableDescription:
    "This environment can reach the control plane, but desktop GitHub sign-in is not configured.",
  githubLocalDescription:
    "GitHub sign-in is unavailable while the control plane is unreachable.",
  githubAuthCheckingDescription:
    "Checking whether GitHub sign-in is configured for this environment.",
  githubAuthUnavailableDescription:
    "GitHub sign-in is not configured for this environment.",
  githubSignedInUnavailableDescription:
    "Connected through GitHub desktop sign-in, but cloud is currently unavailable.",
  supportCopyLabel: "Copy email",
  supportGmailLabel: "Open Gmail",
  supportOutlookLabel: "Open Outlook",
  supportMailAppLabel: "Mail app",
  supportEmailSubject: "Proliferate support",
} as const;
