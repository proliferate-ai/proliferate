import {
  getStoredPendingAuthSession,
  setStoredPendingAuthSession,
  clearStoredPendingAuthSession,
} from "@/lib/access/tauri/auth";
import {
  getActiveGitHubSignIn,
  resolveGitHubSignIn,
  startGitHubSignIn,
} from "@/lib/domain/auth/github-signin-state";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import type { AuthSignInSource, AuthTelemetryProvider } from "@/lib/domain/telemetry/events";
import type { GitHubDesktopSignInOptions } from "@/lib/integrations/auth/proliferate-auth";
import type { DesktopSsoSignInOptions } from "@/lib/integrations/auth/proliferate-sso-auth";
import {
  abortError,
  AuthRequestError,
  beginDesktopProviderAuth,
  beginGitHubDesktopSignIn,
  createPendingGitHubDesktopAuth,
  getGitHubDesktopAuthAvailability,
  isPendingDesktopAuthExpired,
  pollGitHubDesktopSession,
  type DesktopIdentityProvider,
} from "@/lib/integrations/auth/proliferate-auth";
import {
  beginDesktopSsoSignIn,
  discoverDesktopSso,
} from "@/lib/integrations/auth/proliferate-sso-auth";
import { checkControlPlaneReachable } from "@/lib/access/cloud/health";
import { revokeDesktopWorkerServerSide } from "@/lib/workflows/cloud/ensure-desktop-worker";
import {
  applyAnonymousState,
  applyAuthenticatedState,
  applyDevBypassState,
  clearPendingGitHubAuth,
  toError,
  type AuthOrchestrationDeps,
} from "./orchestration-effects";

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
      {
        signal: controller.abortController.signal,
        transientFailureMessage: "GitHub sign-in failed",
        timeoutMessage: "GitHub sign-in timed out. Finish the browser flow and try again.",
      },
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
      {
        signal: controller.abortController.signal,
        transientFailureMessage: "Provider linking failed",
        timeoutMessage: "Provider linking timed out. Finish the browser flow and try again.",
      },
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

export async function signInWithSso(
  options: DesktopSsoSignInOptions | undefined,
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
      "SSO sign-in requires a reachable control plane.",
      503,
    );
  }

  const discovery = await discoverDesktopSso(options);
  if (!discovery.enabled) {
    throw new AuthRequestError(
      discovery.reason === "not_configured"
        ? "SSO is not configured for this environment."
        : "SSO is not available for this environment.",
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
    await beginDesktopSsoSignIn(
      pending.state,
      pending.code_verifier,
      pending.redirect_uri,
      {
        ...options,
        organizationId: options?.organizationId ?? discovery.organizationId,
        connectionId: options?.connectionId ?? discovery.connectionId,
        prompt: options?.prompt ?? "select_account",
      },
    );

    const recoverySession = pollGitHubDesktopSession(
      pending.state,
      pending.code_verifier,
      {
        signal: controller.abortController.signal,
        transientFailureMessage: "SSO sign-in failed",
        timeoutMessage: "SSO sign-in timed out. Finish the browser flow and try again.",
      },
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
      provider: "sso",
      source,
    };
  } catch (error) {
    await clearPendingGitHubAuth(
      pending.state,
      toError(error, "SSO sign-in failed"),
    );
    throw toError(error, "SSO sign-in failed");
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

  // Revoke the desktop worker + gateway token server-side while the auth
  // session is still valid; once applyAnonymousState clears it the request
  // can only fail. The enrollment hook's teardown (fired by the store
  // flipping to anonymous) handles the local process + dotfile cleanup.
  await revokeDesktopWorkerServerSide();
  await clearPendingGitHubAuth();
  await applyAnonymousState(deps, { clearPendingAuth: true });
  return {
    provider: "github",
  };
}

export async function cancelActiveAuthFlow(message = "Sign-in cancelled."): Promise<void> {
  await clearPendingGitHubAuth(undefined, abortError(message));
}
