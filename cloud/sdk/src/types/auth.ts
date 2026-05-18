import type { components } from "../generated/openapi.js";

export type AuthProviderName = "github" | "google" | "apple";
export type AuthOnboardingState = "needs_github" | "active";

export type AuthLinkedProvider = Omit<
  components["schemas"]["AuthLinkedProvider"],
  "provider"
> & {
  provider: AuthProviderName;
};

export type AuthProviderAvailability = Omit<
  components["schemas"]["AuthProviderAvailability"],
  "provider"
> & {
  provider: AuthProviderName;
};

export type AuthViewerResponse = Omit<
  components["schemas"]["AuthViewerResponse"],
  "onboardingState" | "linkedProviders" | "providerAvailability"
> & {
  onboardingState: AuthOnboardingState;
  linkedProviders: AuthLinkedProvider[];
  providerAvailability: AuthProviderAvailability[];
};
