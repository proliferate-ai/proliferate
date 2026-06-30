import type { components } from "../generated/openapi.js";

export type AuthLinkedProvider = components["schemas"]["AuthLinkedProvider"];
export type AuthProviderAvailability =
  components["schemas"]["AuthProviderAvailability"];
export type AuthPasswordCredential = components["schemas"]["AuthPasswordCredential"];
export type AuthProviderName = AuthProviderAvailability["provider"];
export type AuthLinkedProviderName = AuthLinkedProvider["provider"];
export type AuthViewerResponse = components["schemas"]["AuthViewerResponse"];
export type AuthOnboardingState = AuthViewerResponse["onboardingState"];
export type AuthSurface = "web" | "mobile" | "desktop";
export type AuthUser = components["schemas"]["UserRead"];
export type StartAuthRequest = components["schemas"]["StartAuthRequest"];
export type AuthPurpose = StartAuthRequest["purpose"];
export type StartAuthResponse = components["schemas"]["StartAuthResponse"];
export type AuthTokenRequest = components["schemas"]["AuthTokenRequest"];
export type AuthRefreshRequest = components["schemas"]["AuthRefreshRequest"];
export type PasswordLoginRequest = components["schemas"]["PasswordLoginRequest"];
export type PasswordSetRequest = components["schemas"]["PasswordSetRequest"];
export type PasswordCredentialResponse =
  components["schemas"]["PasswordCredentialResponse"];
export type AppleMobileCompleteRequest =
  components["schemas"]["AppleMobileCompleteRequest"];
export type AccountReadinessResponse =
  components["schemas"]["AccountReadinessResponse"];
export type AuthSessionResponse = components["schemas"]["AuthSessionResponse"];
