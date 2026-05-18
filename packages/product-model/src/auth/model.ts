export type AuthProvider = "github" | "google" | "apple";

export type OnboardingState = "needs_github" | "active";

export interface LinkedAuthProvider {
  provider: AuthProvider;
  email?: string | null;
  connected: boolean;
}

export interface ProductViewer {
  id: string;
  displayName?: string | null;
  email?: string | null;
  githubConnected: boolean;
  onboardingState: OnboardingState;
  linkedProviders: readonly LinkedAuthProvider[];
}

export type AuthGateState =
  | { kind: "unauthenticated" }
  | { kind: "needs_github"; viewer: ProductViewer }
  | { kind: "active"; viewer: ProductViewer };
