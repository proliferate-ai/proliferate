import { ensureDeepLinkBridge } from "@/platform/tauri/deep-link";
import {
  clearStoredAuthSession,
  clearStoredPendingAuthSession,
  getStoredAuthSession,
  getStoredPendingAuthSession,
  setStoredAuthSession,
  setStoredPendingAuthSession,
  type StoredAuthSession,
  type StoredPendingAuthSession,
} from "@/platform/tauri/auth";
import { desktopNavigationTarget } from "@/lib/domain/auth/desktop-navigation";
import { closeAllSessionStreamHandles } from "@/lib/integrations/anyharness/session-stream-handles";
import { markTelemetryHandled } from "@/lib/domain/telemetry/errors";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useRepoSetupModalStore } from "@/stores/ui/repo-setup-modal-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  cancelGitHubSignIn,
  getActiveGitHubSignIn,
  rejectGitHubSignIn,
  resolveGitHubSignIn,
  startGitHubSignIn,
} from "@/lib/domain/auth/github-signin-state";
import { createDevBypassSession, isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import type { AuthUser } from "@/lib/integrations/auth/proliferate-auth";
import type { GitHubDesktopSignInOptions } from "@/lib/integrations/auth/proliferate-auth";
import type { AuthSignInSource, AuthTelemetryProvider } from "@/lib/domain/telemetry/events";
import {
  AuthRequestError,
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
  sessionUser,
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
} from "@/lib/infra/debug-startup";

function applyDevBypassState(): void {
  const session = createDevBypassSession();

  useAuthStore.setState({
    status: "authenticated",
    session,
    user: sessionUser(session),
    error: null,
  });
}

function isTransientBootstrapError(error: unknown): boolean {
  if (error instanceof AuthRequestError) {
    return error.status >= 500;
  }

  return error instanceof Error;
}

function persistValidatedSession(
  session: StoredAuthSession,
  user: AuthUser,
): StoredAuthSession {
  return {
    ...session,
    user_id: user.id,
    email: user.email,
    display_name: user.display_name,
    github_login: user.github_login ?? null,
    avatar_url: user.avatar_url ?? null,
  };
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
): Promise<void> {
  const expectedRefreshToken = storedSession.refresh_token;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await wait(1000);

    const currentSession = useAuthStore.getState().session;
    if (currentSession?.refresh_token !== expectedRefreshToken) {
      return;
    }

    try {
      const { session, user } = await validateSession(storedSession);
      const persistedSession = persistValidatedSession(session, user);
      await setStoredAuthSession(persistedSession);

      if (useAuthStore.getState().session?.refresh_token !== expectedRefreshToken) {
        return;
      }

      useAuthStore.setState({
        status: "authenticated",
        session: persistedSession,
        user,
        error: null,
      });
      return;
    } catch (error) {
      if (isTransientBootstrapError(error)) {
        continue;
      }

      if (useAuthStore.getState().session?.refresh_token !== expectedRefreshToken) {
        return;
      }

      await applyAnonymousState();
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

async function applyAnonymousState(options?: {
  clearPendingAuth?: boolean;
}): Promise<void> {
  await clearStoredAuthSession();
  if (options?.clearPendingAuth) {
    await clearStoredPendingAuthSession();
  }
  clearSessionRuntimeStateForAuth();
  useRepoSetupModalStore.getState().close();
  useAuthStore.setState({
    status: "anonymous",
    session: null,
    user: null,
    error: null,
  });
}

async function applyAuthenticatedState(session: StoredAuthSession): Promise<void> {
  await setStoredAuthSession(session);
  useAuthStore.setState({
    status: "authenticated",
    session,
    user: sessionUser(session),
    error: null,
  });
}

function reportBackgroundAuthError(message: string): void {
  useToastStore.getState().show(message);
  if (useAuthStore.getState().status !== "authenticated") {
    useAuthStore.setState({ error: message });
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

export async function bootstrapAuth(): Promise<void> {
  const startedAt = startStartupTimer();
  useAuthStore.setState({ status: "bootstrapping", error: null });
  logStartupDebug("auth.bootstrap.start");

  if (isDevAuthBypassed()) {
    await clearStoredPendingAuthSession();
    applyDevBypassState();
    logStartupDebug("auth.bootstrap.dev_bypass", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  const storedSession = await getStoredAuthSession();
  const controlPlaneReachable = await checkControlPlaneReachable();
  if (!controlPlaneReachable) {
    await clearStoredPendingAuthSession();
    clearSessionRuntimeStateForAuth();

    if (storedSession) {
      useAuthStore.setState({
        status: "authenticated",
        session: storedSession,
        user: sessionUser(storedSession),
        error: null,
      });
      logStartupDebug("auth.bootstrap.control_plane_unreachable.cached_session", {
        elapsedMs: elapsedStartupMs(startedAt),
      });
      return;
    }

    useAuthStore.setState({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
    });
    logStartupDebug("auth.bootstrap.control_plane_unreachable.anonymous", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  await ensureDeepLinkBridge(handleDesktopCallbackUrl);

  const pending = await getStoredPendingAuthSession();
  if (pending && isPendingDesktopAuthExpired(pending)) {
    await clearPendingGitHubAuth(
      pending.state,
      new Error("GitHub sign-in expired. Start again from Proliferate."),
    );
  }

  if (!storedSession) {
    useAuthStore.setState({
      status: "anonymous",
      session: null,
      user: null,
      error: null,
    });
    logStartupDebug("auth.bootstrap.no_stored_session", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  try {
    logStartupDebug("auth.bootstrap.validate_stored_session.start");
    const { session, user } = await validateSession(storedSession);
    const persistedSession = persistValidatedSession(session, user);
    await setStoredAuthSession(persistedSession);
    useAuthStore.setState({
      status: "authenticated",
      session: persistedSession,
      user,
      error: null,
    });
    logStartupDebug("auth.bootstrap.validate_stored_session.completed", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
  } catch (error) {
    if (isTransientBootstrapError(error)) {
      useAuthStore.setState({
        status: "authenticated",
        session: storedSession,
        user: sessionUser(storedSession),
        error: null,
      });
      logStartupDebug("auth.bootstrap.transient_failure_background_recovery", {
        elapsedMs: elapsedStartupMs(startedAt),
        ...summarizeStartupError(error),
      });
      void recoverValidatedSessionAfterTransientFailure(storedSession);
      return;
    }

    await applyAnonymousState();
    logStartupDebug("auth.bootstrap.failed_anonymous", {
      elapsedMs: elapsedStartupMs(startedAt),
      ...summarizeStartupError(error),
    });
    throw toError(error, "Auth bootstrap failed");
  }
}

function clearSessionRuntimeStateForAuth(): void {
  closeAllSessionStreamHandles();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  useSessionSelectionStore.getState().clearSelection();
}

export async function signInWithGitHub(options?: GitHubDesktopSignInOptions): Promise<{
  provider: AuthTelemetryProvider;
  source: AuthSignInSource;
}> {
  if (isDevAuthBypassed()) {
    applyDevBypassState();
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
    await applyAuthenticatedState(session);
    return {
      provider: "github",
      source,
    };
  } catch (error) {
    if (
      error instanceof Error
      && error.name === "AbortError"
      && useAuthStore.getState().status === "authenticated"
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

export async function signOut(): Promise<{
  provider: AuthTelemetryProvider;
}> {
  if (isDevAuthBypassed()) {
    await clearPendingGitHubAuth();
    applyDevBypassState();
    return {
      provider: "dev_bypass",
    };
  }

  await clearPendingGitHubAuth();
  await applyAnonymousState({ clearPendingAuth: true });
  return {
    provider: "github",
  };
}

export async function handleDesktopCallbackUrl(url: string): Promise<boolean> {
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
    const message = "GitHub sign-in expired. Start again from Proliferate.";
    await clearPendingGitHubAuth(pending.state, new Error(message));
    reportBackgroundAuthError(message);
    return false;
  }

  if (pending.state !== callback.state) {
    reportBackgroundAuthError(
      "Proliferate ignored a stale browser callback because it did not match the active sign-in.",
    );
    return false;
  }

  if (pending.last_handled_callback_url === callback.url) {
    return true;
  }

  await markPendingCallbackUrl(pending, callback.url);

  try {
    const session = await exchangeDesktopAuthCode(
      callback.code,
      pending.code_verifier,
    );

    resolveGitHubSignIn(pending.state, session);
    await clearStoredPendingAuthSession();
    await applyAuthenticatedState(session);
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
        markTelemetryHandled(toError(error, "GitHub sign-in failed")),
      );
      return false;
    }

    reportBackgroundAuthError(
      error instanceof Error ? error.message : "GitHub sign-in failed",
    );
    return false;
  }
}
