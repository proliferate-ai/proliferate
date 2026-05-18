import type { components } from "../generated/openapi.js";

export type AuthLinkedProvider = components["schemas"]["AuthLinkedProvider"];
export type AuthProviderAvailability =
  components["schemas"]["AuthProviderAvailability"];
export type AuthProviderName = AuthLinkedProvider["provider"];
export type AuthViewerResponse = components["schemas"]["AuthViewerResponse"];
export type AuthOnboardingState = AuthViewerResponse["onboardingState"];
