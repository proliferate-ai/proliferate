import type { AuthUser } from "@/lib/domain/auth/auth-user";
import { authUserFromStoredSession } from "@/lib/domain/auth/session-mapping";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";

export type AuthClientStatus = "bootstrapping" | "anonymous" | "authenticated";

export interface AuthClientState {
  status: AuthClientStatus;
  session: StoredAuthSession | null;
  user: AuthUser | null;
  error: string | null;
}

export type AuthClientStatePatch = Partial<AuthClientState>;

export function bootstrappingAuthStatePatch(): Pick<AuthClientState, "status" | "error"> {
  return {
    status: "bootstrapping",
    error: null,
  };
}

export function anonymousAuthState(): AuthClientState {
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
): AuthClientState {
  return {
    status: "authenticated",
    session,
    user,
    error: null,
  };
}

export function authErrorStatePatch(error: string): Pick<AuthClientState, "error"> {
  return { error };
}
