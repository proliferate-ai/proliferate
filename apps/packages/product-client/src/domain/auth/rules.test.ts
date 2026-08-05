import { describe, expect, it } from "vitest";
import {
  authMethodRequiresGitHubGate,
  deriveAuthGateState,
  providerRequiresGitHubGate,
} from "./rules";
import type { ProductViewer } from "./model";

const baseViewer: ProductViewer = {
  id: "user-1",
  displayName: "Pablo",
  email: "pablo@example.com",
  githubConnected: true,
  onboardingState: "active",
  linkedProviders: [{ provider: "github", connected: true }],
  passwordCredential: { enabled: false, setAt: null },
};

describe("auth rules", () => {
  it("requires authentication when no viewer is loaded", () => {
    expect(deriveAuthGateState(null)).toEqual({ kind: "unauthenticated" });
  });

  it("gates a limited user without GitHub", () => {
    expect(
      deriveAuthGateState({
        ...baseViewer,
        githubConnected: false,
        onboardingState: "needs_github",
        linkedProviders: [{ provider: "google", connected: true }],
      }),
    ).toEqual({
      kind: "needs_github",
      viewer: {
        ...baseViewer,
        githubConnected: false,
        onboardingState: "needs_github",
        linkedProviders: [{ provider: "google", connected: true }],
      },
    });
  });

  it("allows a GitHub-backed user into product surfaces", () => {
    expect(deriveAuthGateState(baseViewer)).toEqual({ kind: "active", viewer: baseViewer });
  });

  it("treats Apple and Google as secondary providers", () => {
    expect(providerRequiresGitHubGate("github")).toBe(false);
    expect(providerRequiresGitHubGate("google")).toBe(true);
    expect(providerRequiresGitHubGate("apple")).toBe(true);
  });

  it("models password as a sign-in method rather than a linked provider", () => {
    expect(authMethodRequiresGitHubGate("password")).toBe(true);
    expect(authMethodRequiresGitHubGate("sso")).toBe(true);
    expect(authMethodRequiresGitHubGate("github")).toBe(false);
  });
});
