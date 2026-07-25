import {
  clearStoredPendingAuthSession,
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
  authErrorStatePatch,
  isSignedInAuthStatus,
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
import { desktopAuthCoordinator } from "./auth-coordinator-instance";

export interface AuthOrchestrationDeps {
  getAuthState(): AuthClientState;
  setAuthState(state: AuthClientStatePatch): void;
  clearSessionRuntimeState(): void;
  closeRepoSetupModal(): void;
  showToast(message: string): void;
  navigateDesktopRoute(target: string): void;
}

export async function applyDevBypassState(): Promise<void> {
  const session = createDevBypassSession();
  await desktopAuthCoordinator.commitVolatileSession(session);
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
  // The recovery belongs to the authority generation it started under; any
  // later sign-in/sign-out advances the generation and fences this loop.
  const expectedGeneration = deps.getAuthState().authGeneration;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await wait(1000);

    if (deps.getAuthState().authGeneration !== expectedGeneration) {
      return;
    }

    try {
      const { session, user } = await validateSession(storedSession);
      const persistedSession = storedSessionWithValidatedUser(session, user);
      await desktopAuthCoordinator.commitBootstrapSession({
        expectedGeneration,
        session: persistedSession,
        user,
        persist: true,
        reachable: true,
      });
      return;
    } catch (error) {
      if (isTransientBootstrapError(error)) {
        continue;
      }

      await applySignedOutState(deps, {
        expectedGeneration,
        viaInvalidation: true,
      });
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

export interface ApplySignedOutStateOptions {
  expectedGeneration: number;
  // Definitive rejection/revocation (vs an explicit user sign-out).
  viaInvalidation?: boolean;
  clearPendingAuth?: boolean;
}

// Compare-and-swapped sign-out/invalidation. Stored credentials are cleared
// and anonymous state published only if the authority is still the expected
// one; a stale completion also skips the runtime teardown so it cannot wipe
// a newer authority's session state. Returns whether the CAS applied.
export async function applySignedOutState(
  deps: AuthOrchestrationDeps,
  options: ApplySignedOutStateOptions,
): Promise<boolean> {
  const applied = options.viaInvalidation
    ? await desktopAuthCoordinator.invalidateAuthority({
      expectedGeneration: options.expectedGeneration,
    })
    : await desktopAuthCoordinator.signOut({
      expectedGeneration: options.expectedGeneration,
    });
  if (!applied) {
    return false;
  }
  if (options.clearPendingAuth) {
    await clearStoredPendingAuthSession();
  }
  deps.clearSessionRuntimeState();
  deps.closeRepoSetupModal();
  return true;
}

export function reportBackgroundAuthError(
  message: string,
  deps: AuthOrchestrationDeps,
): void {
  deps.showToast(message);
  if (!isSignedInAuthStatus(deps.getAuthState().status)) {
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

export function handleDesktopNavigationUrl(
  url: string,
  deps: AuthOrchestrationDeps,
): boolean {
  const target = desktopNavigationTarget(url);
  if (!target) {
    return false;
  }

  deps.navigateDesktopRoute(target);
  return true;
}

export async function clearPendingGitHubAuth(
  state?: string,
  error?: Error,
): Promise<void> {
  desktopAuthCoordinator.cancelSignInTransaction(state);
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
