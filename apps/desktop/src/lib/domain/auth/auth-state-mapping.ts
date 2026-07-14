import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";

import type { AuthUser } from "@/lib/domain/auth/auth-user";
import { authUserFromStoredSession } from "@/lib/domain/auth/session-mapping";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";

export type AuthClientStatus = "bootstrapping" | "anonymous" | "authenticated";

export interface AuthClientState {
  status: AuthClientStatus;
  session: StoredAuthSession | null;
  user: AuthUser | null;
  error: string | null;
  /**
   * The normalized reason the current (anonymous) state is a failure rather than
   * a fresh gate — an unreachable deployment at bootstrap, or a normalized
   * auth-callback failure from the callback machine. Null on a clean gate or once
   * authenticated. The host publishes this straight through as the anonymous
   * {@link ProductAuthIssue}; it never crosses into an authenticated snapshot.
   */
  issue: ProductAuthIssue | null;
}

export type AuthClientStatePatch = Partial<AuthClientState>;

export function bootstrappingAuthStatePatch(): Pick<
  AuthClientState,
  "status" | "error" | "issue"
> {
  return {
    status: "bootstrapping",
    error: null,
    issue: null,
  };
}

export function anonymousAuthState(): AuthClientState {
  return {
    status: "anonymous",
    session: null,
    user: null,
    error: null,
    issue: null,
  };
}

export function authenticatedAuthState(
  session: StoredAuthSession,
  user: AuthUser = authUserFromStoredSession(session),
): AuthClientState {
  return {
    status: "authenticated",
    session,
    user,
    error: null,
    issue: null,
  };
}

export function authErrorStatePatch(error: string): Pick<AuthClientState, "error"> {
  return { error };
}

/**
 * Patch publishing a normalized auth issue alongside the existing error string,
 * so both the shared {@link ProductAuthIssue} surface and the current
 * error-string UX see the failure until product consumers migrate.
 */
export function authIssueStatePatch(
  issue: ProductAuthIssue,
  error: string,
): Pick<AuthClientState, "issue" | "error"> {
  return { issue, error };
}
