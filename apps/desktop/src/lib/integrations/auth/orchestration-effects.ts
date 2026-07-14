import {
  clearStoredPendingAuthSession,
  getStoredPendingAuthSession,
  setStoredPendingAuthSession,
  type StoredPendingAuthSession,
} from "@/lib/access/tauri/auth";
import { markTelemetryHandled } from "@/lib/domain/telemetry/errors";
import {
  cancelGitHubSignIn,
} from "@/lib/domain/auth/github-signin-state";
import { createDevBypassSession } from "@/lib/domain/auth/auth-mode";
import {
  anonymousAuthState,
  type AuthClientState,
  type AuthClientStatePatch,
} from "@/lib/domain/auth/auth-state-mapping";
import {
  storedSessionWithValidatedUser,
} from "@/lib/domain/auth/session-mapping";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";
import {
  AuthRequestError,
  fetchCurrentDesktopUser,
  isSessionExpiring,
  refreshDesktopUserSession,
} from "@/lib/integrations/auth/proliferate-auth";
import {
  claimDesktopAuthPendingState,
  currentDesktopAuthTransaction,
  isCurrentDesktopAuthSessionAuthority,
  replaceDesktopAuthSessionAuthority,
  releaseDesktopAuthPendingState,
  withDesktopAuthPendingMutation,
  type DesktopAuthSessionAuthority,
  type DesktopAuthTransaction,
} from "./desktop-auth-transaction";
import {
  applyAnonymousStateForAuthority,
  applyAuthenticatedStateForAuthority,
} from "./orchestration-session-authority";
import { applyVolatileAuthenticatedAuthState } from "@/lib/workflows/auth/apply-auth-state";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";

export interface AuthOrchestrationDeps {
  cloudClient?: ProliferateCloudClient | null;
  getAuthState(): AuthClientState;
  setAuthState(state: AuthClientStatePatch): void;
  clearSessionRuntimeState(): void;
  closeRepoSetupModal(): void;
  showToast(message: string): void;
}

export function applyDevBypassState(deps: AuthOrchestrationDeps): void {
  const session = createDevBypassSession();
  applyVolatileAuthenticatedAuthState({ session }, deps);
}

export function isTransientBootstrapError(error: unknown): boolean {
  if (error instanceof AuthRequestError) {
    return error.status >= 500;
  }

  return error instanceof Error;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function validateSession(
  session: StoredAuthSession,
): Promise<{ session: StoredAuthSession; user: AuthUser }> {
  const sessionToValidate = isSessionExpiring(session)
    ? await refreshDesktopUserSession(session.refresh_token)
    : session;

  try {
    const user = await fetchCurrentDesktopUser(sessionToValidate.access_token);
    return { session: sessionToValidate, user };
  } catch {
    const refreshed = await refreshDesktopUserSession(sessionToValidate.refresh_token);
    const user = await fetchCurrentDesktopUser(refreshed.access_token);
    return { session: refreshed, user };
  }
}

export async function recoverValidatedSessionAfterTransientFailure(
  storedSession: StoredAuthSession,
  deps: AuthOrchestrationDeps,
  authority: DesktopAuthSessionAuthority,
): Promise<void> {
  const expectedRefreshToken = storedSession.refresh_token;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await wait(1000);

    const currentSession = deps.getAuthState().session;
    if (
      !isCurrentDesktopAuthSessionAuthority(authority)
      || currentSession?.refresh_token !== expectedRefreshToken
    ) {
      return;
    }

    try {
      const { session, user } = await validateSession(storedSession);
      const persistedSession = storedSessionWithValidatedUser(session, user);
      await applyAuthenticatedStateForAuthority(
        deps,
        persistedSession,
        authority,
        { user, expectedStoredSession: storedSession },
      );
      return;
    } catch (error) {
      if (isTransientBootstrapError(error)) {
        continue;
      }

      if (
        !isCurrentDesktopAuthSessionAuthority(authority)
        || deps.getAuthState().session?.refresh_token !== expectedRefreshToken
      ) {
        return;
      }

      await applyAnonymousStateForAuthority(
        deps,
        authority,
        { expectedStoredSession: storedSession },
      );
      return;
    }
  }
}

export function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallback);
}

export async function applyAnonymousState(
  deps: AuthOrchestrationDeps,
  options?: {
    clearPendingAuth?: boolean;
  },
  transaction: DesktopAuthTransaction = currentDesktopAuthTransaction(),
): Promise<boolean> {
  const authority = replaceDesktopAuthSessionAuthority(transaction);
  if (!authority) {
    return false;
  }
  return applyAnonymousStateForAuthority(deps, authority, options);
}

export async function applyAuthenticatedState(
  deps: AuthOrchestrationDeps,
  session: StoredAuthSession,
  transaction?: DesktopAuthTransaction,
): Promise<boolean> {
  const authority = replaceDesktopAuthSessionAuthority(
    transaction ?? currentDesktopAuthTransaction(),
  );
  if (!authority) {
    return false;
  }

  return applyAuthenticatedStateForAuthority(deps, session, authority);
}

export function applyAnonymousClientState(deps: AuthOrchestrationDeps): void {
  deps.setAuthState(anonymousAuthState());
}

export async function clearPendingGitHubAuth(
  state?: string,
  error?: Error,
  transaction: DesktopAuthTransaction = currentDesktopAuthTransaction(),
): Promise<boolean> {
  if (state && !claimDesktopAuthPendingState(transaction, state)) {
    return false;
  }

  const cleared = await withDesktopAuthPendingMutation(
    transaction,
    async () => {
      if (state) {
        const stored = await getStoredPendingAuthSession();
        if (stored && stored.state !== state) {
          return false;
        }
      }
      await clearStoredPendingAuthSession();
      cancelGitHubSignIn(state, error);
      if (state) {
        releaseDesktopAuthPendingState(transaction, state);
      }
      return true;
    },
  );
  return cleared === true;
}

export async function markPendingCallbackUrl(
  pending: StoredPendingAuthSession,
  url: string,
  transaction: DesktopAuthTransaction = currentDesktopAuthTransaction(),
): Promise<boolean> {
  if (!claimDesktopAuthPendingState(transaction, pending.state)) {
    return false;
  }

  const marked = await withDesktopAuthPendingMutation(
    transaction,
    async () => {
      const stored = await getStoredPendingAuthSession();
      if (!stored || stored.state !== pending.state) {
        return false;
      }
      await setStoredPendingAuthSession({
        ...stored,
        last_handled_callback_url: url,
      });
      return true;
    },
  );
  return marked === true;
}

export { markTelemetryHandled };
