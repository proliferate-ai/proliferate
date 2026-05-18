import type { components } from "../generated/openapi.js";

export type AuthLinkedProvider = components["schemas"]["AuthLinkedProvider"];
export type AuthProviderAvailability =
  components["schemas"]["AuthProviderAvailability"];
export type AuthProviderName = AuthLinkedProvider["provider"];
export type AuthViewerResponse = components["schemas"]["AuthViewerResponse"];
export type AuthOnboardingState = AuthViewerResponse["onboardingState"];
export type AuthSurface = "web" | "mobile";
export type AuthPurpose = "login" | "link" | "required_github_link";
export type AuthUser = components["schemas"]["UserRead"];

export interface StartAuthRequest {
  purpose?: AuthPurpose;
  clientState: string;
  codeChallenge: string;
  codeChallengeMethod?: "S256";
  redirectUri: string;
  prompt?: "select_account" | null;
}

export interface StartAuthResponse {
  provider: AuthProviderName;
  authorizationUrl: string | null;
  state: string;
  nonce: string;
  expiresAt: string;
}

export interface AuthTokenRequest {
  code: string;
  codeVerifier: string;
  grantType?: "authorization_code";
}

export interface AuthRefreshRequest {
  refreshToken: string;
  grantType?: "refresh_token";
}

export interface AppleMobileCompleteRequest {
  state: string;
  identityToken: string;
  authorizationCode?: string | null;
  email?: string | null;
  displayName?: string | null;
}

export interface AccountReadinessResponse {
  productReady: boolean;
  missingRequirements: string[];
  githubIdentityId: string | null;
  githubGrantStatus: string | null;
}

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string | null;
  tokenType: "bearer";
  expiresIn: number;
  user: AuthUser;
  readiness: AccountReadinessResponse;
}
