import type { AuthProvider } from "./model";

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
