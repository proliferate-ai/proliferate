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
import {
  AuthRequestError,
  beginDesktopProviderAuth,
  beginGitHubDesktopSignIn,
  createPendingGitHubDesktopAuth,
  getGitHubDesktopAuthAvailability,
  isPendingDesktopAuthExpired,
  pollGitHubDesktopSession,
  type DesktopIdentityProvider,
} from "@/lib/integrations/auth/proliferate-auth";
import { checkControlPlaneReachable } from "@/lib/access/cloud/health";
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
