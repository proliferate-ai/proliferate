import {
  clearStoredAuthSession,
  clearStoredPendingAuthSession,
  setStoredAuthSession,
  setStoredPendingAuthSession,
  type StoredPendingAuthSession,
} from "@/lib/access/tauri/auth";
import { desktopNavigationTarget } from "@/lib/domain/auth/desktop-navigation";
import { markTelemetryHandled } from "@/lib/domain/telemetry/errors";
import {
  cancelGitHubSignIn,
} from "@/lib/domain/auth/github-signin-state";
import { createDevBypassSession } from "@/lib/domain/auth/auth-mode";
import {
  anonymousAuthState,
  authErrorStatePatch,
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
  captureTelemetryException,
} from "@/lib/integrations/telemetry/client";
import {
  applyAnonymousAuthState,
  applyPersistedAuthenticatedAuthState,
  applyVolatileAuthenticatedAuthState,
} from "@/lib/workflows/auth/apply-auth-state";

export interface AuthOrchestrationDeps {
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
): Promise<void> {
  const expectedRefreshToken = storedSession.refresh_token;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await wait(1000);

    const currentSession = deps.getAuthState().session;
    if (currentSession?.refresh_token !== expectedRefreshToken) {
      return;
    }

    try {
      const { session, user } = await validateSession(storedSession);
      const persistedSession = storedSessionWithValidatedUser(session, user);
      await setStoredAuthSession(persistedSession);

      if (deps.getAuthState().session?.refresh_token !== expectedRefreshToken) {
        return;
      }

      applyVolatileAuthenticatedAuthState({ session: persistedSession, user }, deps);
      return;
    } catch (error) {
      if (isTransientBootstrapError(error)) {
        continue;
      }

      if (deps.getAuthState().session?.refresh_token !== expectedRefreshToken) {
        return;
      }

      await applyAnonymousState(deps);
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
): Promise<void> {
  await applyAnonymousAuthState(options ?? {}, {
    clearStoredAuthSession,
    clearStoredPendingAuthSession,
    clearSessionRuntimeState: deps.clearSessionRuntimeState,
    closeRepoSetupModal: deps.closeRepoSetupModal,
    setAuthState: deps.setAuthState,
  });
}

export async function applyAuthenticatedState(
  deps: AuthOrchestrationDeps,
  session: StoredAuthSession,
): Promise<void> {
  await applyPersistedAuthenticatedAuthState({ session }, {
    setStoredAuthSession,
    setAuthState: deps.setAuthState,
  });
}

export function applyAnonymousClientState(deps: AuthOrchestrationDeps): void {
  deps.setAuthState(anonymousAuthState());
}

export function reportBackgroundAuthError(
  message: string,
  deps: AuthOrchestrationDeps,
): void {
  deps.showToast(message);
  if (deps.getAuthState().status !== "authenticated") {
    deps.setAuthState(authErrorStatePatch(message));
  }
  captureTelemetryException(new Error(message), {
    level: "warning",
    tags: {
      action: "background_callback",
      domain: "auth",
      provider: "github",
    },
  });
}

export function handleDesktopNavigationUrl(url: string): boolean {
  const target = desktopNavigationTarget(url);
  if (!target) {
    return false;
  }

  window.location.assign(target);
  return true;
}

export async function clearPendingGitHubAuth(
  state?: string,
  error?: Error,
): Promise<void> {
  await clearStoredPendingAuthSession();
  cancelGitHubSignIn(state, error);
}

export async function markPendingCallbackUrl(
  pending: StoredPendingAuthSession,
  url: string,
): Promise<void> {
  await setStoredPendingAuthSession({
    ...pending,
    last_handled_callback_url: url,
  });
}

export async function restorePendingCallbackMarker(
  pending: StoredPendingAuthSession,
): Promise<void> {
  await setStoredPendingAuthSession({
    ...pending,
    last_handled_callback_url: pending.last_handled_callback_url,
  });
}

export { markTelemetryHandled };
