import type { AuthAuthority } from "@/lib/domain/auth/auth-authority";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import { authUserFromStoredSession } from "@/lib/domain/auth/session-mapping";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";

// "unreachable" is the normalized status for a transiently unavailable
// authenticated deployment. It retains the resolved principal, authority, and
// authGeneration underneath and never participates in cache identity.
export type AuthClientStatus =
  | "bootstrapping"
  | "anonymous"
  | "authenticated"
  | "unreachable";

export interface AuthClientState {
  status: AuthClientStatus;
  session: StoredAuthSession | null;
  user: AuthUser | null;
  error: string | null;
  // Resolved session authority; null only before host bootstrap resolves one.
  authority: AuthAuthority | null;
  // Session authority epoch (§5.1): advances only when the session authority
  // is replaced (login, logout, revocation, replacement login for the same
  // principal). Never advances on ordinary token refresh.
  authGeneration: number;
  // Non-identity transport refresh signal: advances when the access token is
  // replaced without replacing the authority. Never part of cache identity.
  credentialRevision: number;
}

export type AuthClientStatePatch = Partial<AuthClientState>;

// Presentation patches deliberately exclude the authority fields: only the
// auth coordinator may move authority/authGeneration/credentialRevision.
export type AuthPresentationState = Omit<
  AuthClientState,
  "authority" | "authGeneration" | "credentialRevision"
>;

// Signed-in for presentation/feature gating: an unreachable deployment keeps
// the user signed in with their principal retained.
export function isSignedInAuthStatus(status: AuthClientStatus): boolean {
  return status === "authenticated" || status === "unreachable";
}

export function bootstrappingAuthStatePatch(): Pick<AuthClientState, "status" | "error"> {
  return {
    status: "bootstrapping",
    error: null,
  };
}

export function anonymousAuthState(): AuthPresentationState {
  return {
    status: "anonymous",
    session: null,
    user: null,
    error: null,
  };
}

export function authenticatedAuthState(
  session: StoredAuthSession,
  user: AuthUser = authUserFromStoredSession(session),
): AuthPresentationState {
  return {
    status: "authenticated",
    session,
    user,
    error: null,
  };
}

export function unreachableAuthState(
  session: StoredAuthSession,
  user: AuthUser = authUserFromStoredSession(session),
): AuthPresentationState {
  return {
    status: "unreachable",
    session,
    user,
    error: null,
  };
}

export function authErrorStatePatch(error: string): Pick<AuthClientState, "error"> {
  return { error };
}
