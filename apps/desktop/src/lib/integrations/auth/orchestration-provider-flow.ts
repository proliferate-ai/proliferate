import {
  getActiveGitHubSignIn,
  resolveGitHubSignIn,
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
  getGitHubDesktopAuthAvailability,
  pollGitHubDesktopSession,
  type DesktopIdentityProvider,
} from "@/lib/integrations/auth/proliferate-auth";
import {
  beginDesktopSsoSignIn,
  discoverDesktopSso,
} from "@/lib/integrations/auth/proliferate-sso-auth";
import { checkControlPlaneReachable } from "@/lib/access/cloud/health";
import { revokeDesktopWorkerServerSide } from "@/lib/integrations/auth/desktop-worker-revocation";
import {
  applyAnonymousState,
  applyAuthenticatedState,
  applyDevBypassState,
  clearPendingGitHubAuth,
  toError,
  type AuthOrchestrationDeps,
} from "./orchestration-effects";
import {
  isCurrentDesktopAuthTransaction,
  staleDesktopAuthTransactionError,
  type DesktopAuthTransaction,
} from "./desktop-auth-transaction";
import {
  assertCurrentTransaction,
  prepareProviderTransaction,
} from "./orchestration-provider-transaction";

export async function signInWithGitHub(
  options: GitHubDesktopSignInOptions | undefined,
  deps: AuthOrchestrationDeps,
  transaction: DesktopAuthTransaction,
): Promise<{
  provider: AuthTelemetryProvider;
  source: AuthSignInSource;
}> {
  assertCurrentTransaction(transaction);
  if (isDevAuthBypassed()) {
    applyDevBypassState(deps);
    return {
      provider: "dev_bypass",
      source: "dev_bypass",
    };
  }

  const controlPlaneReachable = await checkControlPlaneReachable();
  assertCurrentTransaction(transaction);
  if (!controlPlaneReachable) {
    throw new AuthRequestError(
      "GitHub sign-in requires a reachable control plane.",
      503,
    );
  }

  const availability = await getGitHubDesktopAuthAvailability();
  assertCurrentTransaction(transaction);
  if (!availability.enabled) {
    throw new AuthRequestError(
      "GitHub sign-in is not configured for this environment",
      503,
    );
  }

  const { pending, controller } = await prepareProviderTransaction(
    "github",
    "login",
    transaction,
  );

  try {
    await beginGitHubDesktopSignIn(
      pending.state,
      pending.code_verifier,
      pending.redirect_uri,
      options,
    );
    assertCurrentTransaction(transaction);

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
    assertCurrentTransaction(transaction);
    const activeSignIn = getActiveGitHubSignIn();
    if (activeSignIn?.state === pending.state && !activeSignIn.settled) {
      resolveGitHubSignIn(pending.state, session);
    }

    await clearPendingGitHubAuth(pending.state, undefined, transaction);
    assertCurrentTransaction(transaction);
    await applyAuthenticatedState(deps, session, transaction);
    assertCurrentTransaction(transaction);
    return {
      provider: "github",
      source,
    };
  } catch (error) {
    if (!isCurrentDesktopAuthTransaction(transaction)) {
      throw staleDesktopAuthTransactionError();
    }
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
      transaction,
    );
    throw toError(error, "GitHub sign-in failed");
  }
}

export async function linkDesktopProvider(
  provider: Exclude<DesktopIdentityProvider, "github">,
  deps: AuthOrchestrationDeps,
  transaction: DesktopAuthTransaction,
): Promise<{
  provider: AuthTelemetryProvider;
  source: AuthSignInSource;
}> {
  assertCurrentTransaction(transaction);
  if (isDevAuthBypassed()) {
    throw new AuthRequestError("Provider linking requires real sign-in.", 401);
  }

  const authState = deps.getAuthState();
  if (authState.status !== "authenticated" || !authState.session) {
    throw new AuthRequestError("Sign in before linking another provider.", 401);
  }

  const controlPlaneReachable = await checkControlPlaneReachable();
  assertCurrentTransaction(transaction);
  if (!controlPlaneReachable) {
    throw new AuthRequestError(
      "Provider linking requires a reachable control plane.",
      503,
    );
  }

  const { pending, controller } = await prepareProviderTransaction(
    provider,
    "link",
    transaction,
  );

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
    assertCurrentTransaction(transaction);

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
    assertCurrentTransaction(transaction);
    const activeSignIn = getActiveGitHubSignIn();
    if (activeSignIn?.state === pending.state && !activeSignIn.settled) {
      resolveGitHubSignIn(pending.state, session);
    }

    await clearPendingGitHubAuth(pending.state, undefined, transaction);
    assertCurrentTransaction(transaction);
    await applyAuthenticatedState(deps, session, transaction);
    assertCurrentTransaction(transaction);
    return {
      provider,
      source,
    };
  } catch (error) {
    if (!isCurrentDesktopAuthTransaction(transaction)) {
      throw staleDesktopAuthTransactionError();
    }
    await clearPendingGitHubAuth(
      pending.state,
      toError(error, "Provider linking failed"),
      transaction,
    );
    throw toError(error, "Provider linking failed");
  }
}

export async function signInWithSso(
  options: DesktopSsoSignInOptions | undefined,
  deps: AuthOrchestrationDeps,
  transaction: DesktopAuthTransaction,
): Promise<{
  provider: AuthTelemetryProvider;
  source: AuthSignInSource;
}> {
  assertCurrentTransaction(transaction);
  if (isDevAuthBypassed()) {
    applyDevBypassState(deps);
    return {
      provider: "dev_bypass",
      source: "dev_bypass",
    };
  }

  const controlPlaneReachable = await checkControlPlaneReachable();
  assertCurrentTransaction(transaction);
  if (!controlPlaneReachable) {
    throw new AuthRequestError(
      "SSO sign-in requires a reachable control plane.",
      503,
    );
  }

  const discovery = await discoverDesktopSso(options);
  assertCurrentTransaction(transaction);
  if (!discovery.enabled) {
    throw new AuthRequestError(
      discovery.reason === "not_configured"
        ? "SSO is not configured for this environment."
        : "SSO is not available for this environment.",
      503,
    );
  }

  const { pending, controller } = await prepareProviderTransaction(
    "sso",
    "login",
    transaction,
  );

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
    assertCurrentTransaction(transaction);

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
    assertCurrentTransaction(transaction);
    const activeSignIn = getActiveGitHubSignIn();
    if (activeSignIn?.state === pending.state && !activeSignIn.settled) {
      resolveGitHubSignIn(pending.state, session);
    }

    await clearPendingGitHubAuth(pending.state, undefined, transaction);
    assertCurrentTransaction(transaction);
    await applyAuthenticatedState(deps, session, transaction);
    assertCurrentTransaction(transaction);
    return {
      provider: "sso",
      source,
    };
  } catch (error) {
    if (!isCurrentDesktopAuthTransaction(transaction)) {
      throw staleDesktopAuthTransactionError();
    }
    await clearPendingGitHubAuth(
      pending.state,
      toError(error, "SSO sign-in failed"),
      transaction,
    );
    throw toError(error, "SSO sign-in failed");
  }
}

export async function signOut(
  deps: AuthOrchestrationDeps,
  transaction: DesktopAuthTransaction,
): Promise<{
  provider: AuthTelemetryProvider;
}> {
  assertCurrentTransaction(transaction);
  if (isDevAuthBypassed()) {
    await clearPendingGitHubAuth(undefined, undefined, transaction);
    assertCurrentTransaction(transaction);
    applyDevBypassState(deps);
    return {
      provider: "dev_bypass",
    };
  }

  // Revoke the desktop worker + gateway token server-side while the auth
  // session is still valid; once applyAnonymousState clears it the request
  // can only fail. The enrollment hook's teardown (fired by the store
  // flipping to anonymous) handles the local process + dotfile cleanup.
  await revokeDesktopWorkerServerSide(deps.cloudClient ?? null);
  assertCurrentTransaction(transaction);
  await clearPendingGitHubAuth(undefined, undefined, transaction);
  assertCurrentTransaction(transaction);
  await applyAnonymousState(deps, undefined, transaction);
  assertCurrentTransaction(transaction);
  return {
    provider: "github",
  };
}

export async function cancelActiveAuthFlow(message = "Sign-in cancelled."): Promise<void> {
  await clearPendingGitHubAuth(undefined, abortError(message));
}
