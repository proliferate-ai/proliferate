export type AuthProvider = "github" | "google" | "apple";
export type AuthLinkedProviderKind = AuthProvider | "sso";

export type AuthMethod = "password" | "sso" | AuthProvider;

export type OnboardingState = "needs_github" | "active";

export interface LinkedAuthProvider {
  provider: AuthLinkedProviderKind;
  email?: string | null;
  displayName?: string | null;
  brandLabel?: string | null;
  connected: boolean;
}

export interface PasswordCredential {
  enabled: boolean;
  setAt?: string | null;
}

export interface ProductViewer {
  id: string;
  displayName?: string | null;
  email?: string | null;
  githubConnected: boolean;
  onboardingState: OnboardingState;
  linkedProviders: readonly LinkedAuthProvider[];
  passwordCredential: PasswordCredential;
}

export type AuthGateState =
  | { kind: "unauthenticated" }
  | { kind: "needs_github"; viewer: ProductViewer }
  | { kind: "active"; viewer: ProductViewer };
