export const WORKFLOW_AUTH_COPY = {
  signInTitle: "Sign in to use workflows",
  signInDescription:
    "Workflow definitions are saved to your Proliferate account. Sign in to create and manage them.",
  signInAction: "Sign in",
  devBypassTitle: "Workflows need account authentication",
  devBypassDescription:
    "Development auth bypass cannot access personal workflow definitions. Set VITE_DEV_DISABLE_AUTH=false, restart this profile, and sign in.",
  identityUnavailableTitle: "Account details unavailable",
  identityUnavailableDescription:
    "Workflows could not verify the current account. Restart Proliferate or sign out and sign in again.",
} as const;
