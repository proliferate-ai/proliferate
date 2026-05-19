import { ensureDeepLinkBridge } from "@/lib/access/tauri/deep-link";
import {
  clearStoredAuthSession,
  clearStoredPendingAuthSession,
  getStoredAuthSession,
  getStoredPendingAuthSession,
  setStoredAuthSession,
  setStoredPendingAuthSession,
  type StoredPendingAuthSession,
} from "@/lib/access/tauri/auth";
import { desktopNavigationTarget } from "@/lib/domain/auth/desktop-navigation";
import { markTelemetryHandled } from "@/lib/domain/telemetry/errors";
import {
  cancelGitHubSignIn,
  getActiveGitHubSignIn,
  rejectGitHubSignIn,
  resolveGitHubSignIn,
  startGitHubSignIn,
} from "@/lib/domain/auth/github-signin-state";
import { createDevBypassSession, isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import {
  anonymousAuthState,
  authErrorStatePatch,
  bootstrappingAuthStatePatch,
  type AuthClientState,
  type AuthClientStatePatch,
} from "@/lib/domain/auth/auth-state-mapping";
import {
  storedSessionWithValidatedUser,
} from "@/lib/domain/auth/session-mapping";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";
import type { GitHubDesktopSignInOptions } from "@/lib/integrations/auth/proliferate-auth";
import type { AuthSignInSource, AuthTelemetryProvider } from "@/lib/domain/telemetry/events";
import {
  AuthRequestError,
  beginDesktopProviderAuth,
  beginGitHubDesktopSignIn,
  createPendingGitHubDesktopAuth,
  exchangeDesktopAuthCode,
  fetchCurrentDesktopUser,
  getGitHubDesktopAuthAvailability,
  isPendingDesktopAuthExpired,
  isSessionExpiring,
  parseDesktopAuthCallback,
  pollGitHubDesktopSession,
  refreshDesktopUserSession,
  type DesktopIdentityProvider,
} from "@/lib/integrations/auth/proliferate-auth";
import {
  captureTelemetryException,
} from "@/lib/integrations/telemetry/client";
import { checkControlPlaneReachable } from "@/lib/access/cloud/health";
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
} from "@/lib/infra/measurement/debug-startup";
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

function applyDevBypassState(deps: AuthOrchestrationDeps): void {
  const session = createDevBypassSession();
  applyVolatileAuthenticatedAuthState({ session }, deps);
}

function isTransientBootstrapError(error: unknown): boolean {
  if (error instanceof AuthRequestError) {
    return error.status >= 500;
  }

  return error instanceof Error;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function validateSession(
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

async function recoverValidatedSessionAfterTransientFailure(
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

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallback);
}

async function applyAnonymousState(
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

async function applyAuthenticatedState(
  deps: AuthOrchestrationDeps,
  session: StoredAuthSession,
): Promise<void> {
  await applyPersistedAuthenticatedAuthState({ session }, {
    setStoredAuthSession,
    setAuthState: deps.setAuthState,
  });
}

function reportBackgroundAuthError(
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

function handleDesktopNavigationUrl(url: string): boolean {
  const target = desktopNavigationTarget(url);
  if (!target) {
    return false;
  }

  window.location.assign(target);
  return true;
}

async function clearPendingGitHubAuth(
  state?: string,
  error?: Error,
): Promise<void> {
  await clearStoredPendingAuthSession();
  cancelGitHubSignIn(state, error);
}

async function markPendingCallbackUrl(
  pending: StoredPendingAuthSession,
  url: string,
): Promise<void> {
  await setStoredPendingAuthSession({
    ...pending,
    last_handled_callback_url: url,
  });
}

async function restorePendingCallbackMarker(
  pending: StoredPendingAuthSession,
): Promise<void> {
  await setStoredPendingAuthSession({
    ...pending,
    last_handled_callback_url: pending.last_handled_callback_url,
  });
}

export async function bootstrapAuth(deps: AuthOrchestrationDeps): Promise<void> {
  const startedAt = startStartupTimer();
  deps.setAuthState(bootstrappingAuthStatePatch());
  logStartupDebug("auth.bootstrap.start");

  if (isDevAuthBypassed()) {
    await clearStoredPendingAuthSession();
    applyDevBypassState(deps);
    logStartupDebug("auth.bootstrap.dev_bypass", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  const storedSession = await getStoredAuthSession();
  const controlPlaneReachable = await checkControlPlaneReachable();
  if (!controlPlaneReachable) {
    await clearStoredPendingAuthSession();
    deps.clearSessionRuntimeState();

    if (storedSession) {
      applyVolatileAuthenticatedAuthState({ session: storedSession }, deps);
      logStartupDebug("auth.bootstrap.control_plane_unreachable.cached_session", {
        elapsedMs: elapsedStartupMs(startedAt),
      });
      return;
    }

    deps.setAuthState(anonymousAuthState());
    logStartupDebug("auth.bootstrap.control_plane_unreachable.anonymous", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  await ensureDeepLinkBridge((url) => handleDesktopCallbackUrl(url, deps));

  const pending = await getStoredPendingAuthSession();
  if (pending && isPendingDesktopAuthExpired(pending)) {
    await clearPendingGitHubAuth(
      pending.state,
      new Error("GitHub sign-in expired. Start again from Proliferate."),
    );
  }

  if (!storedSession) {
    deps.setAuthState(anonymousAuthState());
    logStartupDebug("auth.bootstrap.no_stored_session", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  try {
    logStartupDebug("auth.bootstrap.validate_stored_session.start");
    const { session, user } = await validateSession(storedSession);
    const persistedSession = storedSessionWithValidatedUser(session, user);
    await applyPersistedAuthenticatedAuthState(
      { session: persistedSession, user },
      {
        setStoredAuthSession,
        setAuthState: deps.setAuthState,
      },
    );
    logStartupDebug("auth.bootstrap.validate_stored_session.completed", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
  } catch (error) {
    if (isTransientBootstrapError(error)) {
      applyVolatileAuthenticatedAuthState({ session: storedSession }, deps);
      logStartupDebug("auth.bootstrap.transient_failure_background_recovery", {
        elapsedMs: elapsedStartupMs(startedAt),
        ...summarizeStartupError(error),
      });
      void recoverValidatedSessionAfterTransientFailure(storedSession, deps);
      return;
    }

    await applyAnonymousState(deps);
    logStartupDebug("auth.bootstrap.failed_anonymous", {
      elapsedMs: elapsedStartupMs(startedAt),
      ...summarizeStartupError(error),
    });
    throw toError(error, "Auth bootstrap failed");
  }
}

export async function signInWithGitHub(
  options: GitHubDesktopSignInOptions | undefined,
  deps: AuthOrchestrationDeps,
): Promise<{
  provider: AuthTelemetryProvider;
  source: AuthSignInSource;
}> {
  if (isDevAuthBypassed()) {
    applyDevBypassState(deps);
    return {
      provider: "dev_bypass",
      source: "dev_bypass",
    };
  }

  const controlPlaneReachable = await checkControlPlaneReachable();
  if (!controlPlaneReachable) {
    throw new AuthRequestError(
      "GitHub sign-in requires a reachable control plane.",
      503,
    );
  }

  const availability = await getGitHubDesktopAuthAvailability();
  if (!availability.enabled) {
    throw new AuthRequestError(
      "GitHub sign-in is not configured for this environment",
      503,
    );
  }

  const existingPending = await getStoredPendingAuthSession();
  if (existingPending) {
    if (isPendingDesktopAuthExpired(existingPending)) {
      await clearPendingGitHubAuth(existingPending.state);
    } else if (getActiveGitHubSignIn() && !getActiveGitHubSignIn()?.settled) {
      throw new Error("GitHub sign-in is already in progress");
    } else {
      await clearPendingGitHubAuth(existingPending.state);
    }
  }

  const pending = createPendingGitHubDesktopAuth();
  await setStoredPendingAuthSession(pending);

  const controller = startGitHubSignIn(pending.state);

  try {
    await beginGitHubDesktopSignIn(
      pending.state,
      pending.code_verifier,
      pending.redirect_uri,
      options,
    );

    const recoverySession = pollGitHubDesktopSession(
      pending.state,
      pending.code_verifier,
      controller.abortController.signal,
    );

    const { session, source } = await Promise.race([
      controller.promise.then((session) => ({
        session,
        source: "desktop_callback" as const,
      })),
      recoverySession.then((session) => ({
        session,
        source: "interactive_poll" as const,
      })),
    ]);
    const activeSignIn = getActiveGitHubSignIn();
    if (activeSignIn?.state === pending.state && !activeSignIn.settled) {
      resolveGitHubSignIn(pending.state, session);
    }

    await clearStoredPendingAuthSession();
    await applyAuthenticatedState(deps, session);
    return {
      provider: "github",
      source,
    };
  } catch (error) {
    if (
      error instanceof Error
      && error.name === "AbortError"
      && deps.getAuthState().status === "authenticated"
    ) {
      return {
        provider: "github",
        source: "desktop_callback",
      };
    }

    await clearPendingGitHubAuth(
      pending.state,
      toError(error, "GitHub sign-in failed"),
    );
    throw toError(error, "GitHub sign-in failed");
  }
}

export async function linkDesktopProvider(
  provider: Exclude<DesktopIdentityProvider, "github">,
  deps: AuthOrchestrationDeps,
): Promise<{
  provider: AuthTelemetryProvider;
  source: AuthSignInSource;
}> {
  if (isDevAuthBypassed()) {
    throw new AuthRequestError("Provider linking requires real sign-in.", 401);
  }

  const authState = deps.getAuthState();
  if (authState.status !== "authenticated" || !authState.session) {
    throw new AuthRequestError("Sign in before linking another provider.", 401);
  }

  const controlPlaneReachable = await checkControlPlaneReachable();
  if (!controlPlaneReachable) {
    throw new AuthRequestError(
      "Provider linking requires a reachable control plane.",
      503,
    );
  }

  const existingPending = await getStoredPendingAuthSession();
  if (existingPending) {
    if (isPendingDesktopAuthExpired(existingPending)) {
      await clearPendingGitHubAuth(existingPending.state);
    } else if (getActiveGitHubSignIn() && !getActiveGitHubSignIn()?.settled) {
      throw new Error("Another auth flow is already in progress.");
    } else {
      await clearPendingGitHubAuth(existingPending.state);
    }
  }

  const pending = createPendingGitHubDesktopAuth();
  await setStoredPendingAuthSession(pending);
  const controller = startGitHubSignIn(pending.state);

  try {
    await beginDesktopProviderAuth(
      provider,
      pending.state,
      pending.code_verifier,
      pending.redirect_uri,
      {
        purpose: "link",
        prompt: "select_account",
        accessToken: authState.session.access_token,
      },
    );

    const recoverySession = pollGitHubDesktopSession(
      pending.state,
      pending.code_verifier,
      controller.abortController.signal,
    );

    const { session, source } = await Promise.race([
      controller.promise.then((session) => ({
        session,
        source: "desktop_callback" as const,
      })),
      recoverySession.then((session) => ({
        session,
        source: "interactive_poll" as const,
      })),
    ]);
    const activeSignIn = getActiveGitHubSignIn();
    if (activeSignIn?.state === pending.state && !activeSignIn.settled) {
      resolveGitHubSignIn(pending.state, session);
    }

    await clearStoredPendingAuthSession();
    await applyAuthenticatedState(deps, session);
    return {
      provider,
      source,
    };
  } catch (error) {
    await clearPendingGitHubAuth(
      pending.state,
      toError(error, "Provider linking failed"),
    );
    throw toError(error, "Provider linking failed");
  }
}

export async function signOut(deps: AuthOrchestrationDeps): Promise<{
  provider: AuthTelemetryProvider;
}> {
  if (isDevAuthBypassed()) {
    await clearPendingGitHubAuth();
    applyDevBypassState(deps);
    return {
      provider: "dev_bypass",
    };
  }

  await clearPendingGitHubAuth();
  await applyAnonymousState(deps, { clearPendingAuth: true });
  return {
    provider: "github",
  };
}

export async function handleDesktopCallbackUrl(
  url: string,
  deps: AuthOrchestrationDeps,
): Promise<boolean> {
  if (handleDesktopNavigationUrl(url)) {
    return true;
  }

  if (isDevAuthBypassed()) {
    return false;
  }

  const callback = parseDesktopAuthCallback(url);
  if (!callback) {
    return false;
  }

  const pending = await getStoredPendingAuthSession();
  if (!pending) {
    return false;
  }

  if (isPendingDesktopAuthExpired(pending)) {
    const message = "Authentication expired. Start again from Proliferate.";
    await clearPendingGitHubAuth(pending.state, new Error(message));
    reportBackgroundAuthError(message, deps);
    return false;
  }

  if (pending.state !== callback.state) {
    reportBackgroundAuthError(
      "Proliferate ignored a stale browser callback because it did not match the active auth flow.",
      deps,
    );
    return false;
  }

  if (pending.last_handled_callback_url === callback.url) {
    return true;
  }

  await markPendingCallbackUrl(pending, callback.url);

  if (callback.error) {
    const message = `Authentication failed: ${callback.error}`;
    await clearPendingGitHubAuth(pending.state, new Error(message));
    reportBackgroundAuthError(message, deps);
    return true;
  }

  if (!callback.code) {
    reportBackgroundAuthError("Authentication failed: missing authorization code.", deps);
    await restorePendingCallbackMarker(pending);
    return false;
  }

  try {
    const session = await exchangeDesktopAuthCode(
      callback.code,
      pending.code_verifier,
    );

    resolveGitHubSignIn(pending.state, session);
    await clearStoredPendingAuthSession();
    await applyAuthenticatedState(deps, session);
    return true;
  } catch (error) {
    const latestPending = await getStoredPendingAuthSession();
    if (!latestPending || latestPending.state !== pending.state) {
      return true;
    }

    await restorePendingCallbackMarker(pending);

    if (getActiveGitHubSignIn()?.state === pending.state) {
      captureTelemetryException(error, {
        tags: {
          action: "callback_exchange",
          domain: "auth",
          provider: "github",
        },
      });
      rejectGitHubSignIn(
        pending.state,
        markTelemetryHandled(toError(error, "Authentication failed")),
      );
      return false;
    }

    reportBackgroundAuthError(
      error instanceof Error ? error.message : "Authentication failed",
      deps,
    );
    return false;
  }
}
