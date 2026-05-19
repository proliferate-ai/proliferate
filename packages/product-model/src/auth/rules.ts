import type { AuthGateState, AuthProvider, ProductViewer } from "./model";

export function deriveAuthGateState(viewer: ProductViewer | null): AuthGateState {
  if (!viewer) {
    return { kind: "unauthenticated" };
  }

  if (!viewer.githubConnected || viewer.onboardingState === "needs_github") {
    return { kind: "needs_github", viewer };
  }

  return { kind: "active", viewer };
}

export function providerRequiresGitHubGate(provider: AuthProvider): boolean {
  return provider === "apple" || provider === "google";
}

export function isProductViewer(viewer: ProductViewer): boolean {
  return deriveAuthGateState(viewer).kind === "active";
}
