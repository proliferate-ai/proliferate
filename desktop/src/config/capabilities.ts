export const OFFICIAL_HOSTED_API_ORIGINS = [
  "https://app.proliferate.com",
  "https://api.proliferate.dev",
] as const;

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
  cloudDocsUrl:
    "https://github.com/proliferate-ai/proliferate/blob/main/docs/reference/deployment-self-hosting.md",
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
  supportInAppDescription:
    "This sends an in-app support notification to the Proliferate team.",
  supportFallbackDescription:
    "Support is available by email in this environment.",
  supportEmailAddress: "support@proliferate.com",
  supportCopyLabel: "Copy email",
  supportOpenLabel: "Open Gmail",
  supportGmailSubject: "Proliferate support",
} as const;
