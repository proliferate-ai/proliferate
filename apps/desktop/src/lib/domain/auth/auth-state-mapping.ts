import type { AuthUser } from "@/lib/domain/auth/auth-user";
import { authUserFromStoredSession } from "@/lib/domain/auth/session-mapping";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";
import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";

export type AuthClientStatus = "bootstrapping" | "anonymous" | "authenticated";

export interface AuthClientState {
  status: AuthClientStatus;
  session: StoredAuthSession | null;
  user: AuthUser | null;
  error: string | null;
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
