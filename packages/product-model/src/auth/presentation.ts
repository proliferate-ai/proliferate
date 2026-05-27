import type { AuthProvider } from "./model";

export const AUTH_PROVIDER_ORDER = ["github", "apple", "google"] as const satisfies readonly AuthProvider[];

export const AUTH_SIGN_IN_COPY = {
  title: "Let's help you get your life's work done.",
  subtitle: "Sign in to run cloud workspaces, automations, and coding agents across devices.",
  note: "GitHub is required for cloud workspaces and automations. You can link it after signing in with Apple or Google.",
  footer: "By continuing you agree to the Proliferate Terms and Privacy Policy.",
} as const;

export const AUTH_REQUIRED_GITHUB_COPY = {
  title: "Connect GitHub",
  subtitle:
    "Proliferate runs cloud sessions on your behalf. Linking GitHub gives agents the access they need to read and modify your repos.",
  footer: "We only request the permissions needed to materialize sandboxes and push branches.",
} as const;

export interface AuthProviderPresentation {
  label: string;
  actionLabel: string;
  description: string;
}

const providerPresentation: Record<AuthProvider, AuthProviderPresentation> = {
  github: {
    label: "GitHub",
    actionLabel: "Continue with GitHub",
    description: "Required for product access and repository-backed agent work.",
  },
  google: {
    label: "Google",
    actionLabel: "Continue with Google",
    description: "Alternate sign-in. GitHub is still required before product use.",
  },
  apple: {
    label: "Apple",
    actionLabel: "Continue with Apple",
    description: "Alternate sign-in. GitHub is still required before product use.",
  },
};

export function authProviderPresentation(provider: AuthProvider): AuthProviderPresentation {
  return providerPresentation[provider];
}
