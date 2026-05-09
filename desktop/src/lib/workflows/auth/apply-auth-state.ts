import {
  anonymousAuthState,
  authenticatedAuthState,
  type AuthClientStatePatch,
} from "@/lib/domain/auth/auth-state-mapping";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";

export interface AuthStateWriterDeps {
  setAuthState(state: AuthClientStatePatch): void;
}

export interface ApplyAnonymousAuthStateDeps extends AuthStateWriterDeps {
  clearStoredAuthSession(): Promise<void>;
  clearStoredPendingAuthSession(): Promise<void>;
  clearSessionRuntimeState(): void;
  closeRepoSetupModal(): void;
}

export interface ApplyAnonymousAuthStateInput {
  clearPendingAuth?: boolean;
}

export async function applyAnonymousAuthState(
  input: ApplyAnonymousAuthStateInput,
  deps: ApplyAnonymousAuthStateDeps,
): Promise<void> {
  await deps.clearStoredAuthSession();
  if (input.clearPendingAuth) {
    await deps.clearStoredPendingAuthSession();
  }
  deps.clearSessionRuntimeState();
  deps.closeRepoSetupModal();
  deps.setAuthState(anonymousAuthState());
}

export interface ApplyPersistedAuthenticatedAuthStateDeps extends AuthStateWriterDeps {
  setStoredAuthSession(session: StoredAuthSession): Promise<void>;
}

export interface ApplyAuthenticatedAuthStateInput {
  session: StoredAuthSession;
  user?: AuthUser;
}

export async function applyPersistedAuthenticatedAuthState(
  input: ApplyAuthenticatedAuthStateInput,
  deps: ApplyPersistedAuthenticatedAuthStateDeps,
): Promise<void> {
  await deps.setStoredAuthSession(input.session);
  applyVolatileAuthenticatedAuthState(input, deps);
}

export function applyVolatileAuthenticatedAuthState(
  input: ApplyAuthenticatedAuthStateInput,
  deps: AuthStateWriterDeps,
): void {
  deps.setAuthState(authenticatedAuthState(input.session, input.user));
}
