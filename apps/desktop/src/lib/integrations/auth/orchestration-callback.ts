import {
  getStoredPendingAuthSession,
  clearStoredPendingAuthSession,
} from "@/lib/access/tauri/auth";
import {
  getActiveGitHubSignIn,
  rejectGitHubSignIn,
  resolveGitHubSignIn,
} from "@/lib/domain/auth/github-signin-state";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import {
  exchangeDesktopAuthCode,
  isPendingDesktopAuthExpired,
  parseDesktopAuthCallback,
  type DesktopAuthCallback,
} from "@/lib/integrations/auth/proliferate-auth";
import {
  captureTelemetryException,
} from "@/lib/integrations/telemetry/client";
import {
  applyAuthenticatedState,
  clearPendingGitHubAuth,
  handleDesktopNavigationUrl,
  markPendingCallbackUrl,
  markTelemetryHandled,
  publishCallbackIssue,
  toError,
  type AuthOrchestrationDeps,
} from "./orchestration-effects";

/**
 * The bounded, single-flight callback state machine. Every raw callback URL is
 * decoded, then one host-owned single-flight (keyed by the normalized callback
 * URL) drives it to exactly one terminal result:
 *
 *  - provider failure -> clear the matching pending transaction, publish issue;
 *  - success          -> exchange once, commit, clear pending, publish snapshot;
 *  - malformed/expired -> no exchange, clear the matching/expired transaction,
 *                         publish issue;
 *  - state mismatch   -> no exchange, DO NOT destroy a different valid pending.
 *
 * An exchange failure is TERMINAL for that callback: the pending transaction is
 * cleared and the user must start a new login (no retry marker restore). A
 * duplicate delivery (React StrictMode, rerender, reload/back, or a repeated OS
 * event) either joins the in-flight promise for the same callback or observes
 * the persisted already-consumed marker, and never exchanges or commits twice.
 *
 * This is not a queue, durable replay, or retry system: the single-flight map
 * is bounded to callbacks currently being processed and is cleared as each
 * settles.
 */
const inFlightCallbacks = new Map<string, Promise<boolean>>();

export async function handleDesktopCallbackUrl(
  url: string,
  deps: AuthOrchestrationDeps,
): Promise<boolean> {
  // Legacy product-navigation branch (deleted in a later slice); auth callbacks
  // never match a navigation target, so this returns false for them.
  if (handleDesktopNavigationUrl(url, deps)) {
    return true;
  }

  if (isDevAuthBypassed()) {
    return false;
  }

  const callback = parseDesktopAuthCallback(url);
  if (!callback) {
    return false;
  }

  // Single-flight: a concurrent duplicate delivery of the same callback joins
  // the in-flight promise instead of starting a second transaction.
  const existing = inFlightCallbacks.get(callback.url);
  if (existing) {
    return existing;
  }
  const run = processCallback(callback, deps).finally(() => {
    inFlightCallbacks.delete(callback.url);
  });
  inFlightCallbacks.set(callback.url, run);
  return run;
}

async function processCallback(
  callback: DesktopAuthCallback,
  deps: AuthOrchestrationDeps,
): Promise<boolean> {
  const pending = await getStoredPendingAuthSession();
  if (!pending) {
    return false;
  }

  if (isPendingDesktopAuthExpired(pending)) {
    // Terminal: clear only the expired transaction, no exchange.
    const message = "Authentication expired. Start again from Proliferate.";
    await clearPendingGitHubAuth(pending.state, new Error(message));
    publishCallbackIssue({ kind: "callback_failed", reason: "expired" }, message, deps);
    return false;
  }

  if (pending.state !== callback.state) {
    // Do NOT destroy a different valid pending transaction; publish the issue
    // and leave the pending record intact so its own callback can still land.
    publishCallbackIssue(
      { kind: "callback_failed", reason: "state_mismatch" },
      "Proliferate ignored a stale browser callback because it did not match the active auth flow.",
      deps,
    );
    return false;
  }

  // Persisted already-consumed marker: a duplicate delivery (reload/back, a
  // repeated OS event) observes the prior terminal result without exchanging or
  // committing again, and without republishing over it.
  if (pending.last_handled_callback_url === callback.url) {
    return true;
  }

  await markPendingCallbackUrl(pending, callback.url);

  if (callback.error) {
    // Provider failure: clear the matching pending transaction, no exchange.
    const message = `Authentication failed: ${callback.error}`;
    await clearPendingGitHubAuth(pending.state, new Error(message));
    publishCallbackIssue(
      {
        kind: "callback_failed",
        reason: "provider_error",
        providerCode: callback.error,
      },
      message,
      deps,
    );
    return true;
  }

  if (!callback.code) {
    // Malformed/missing code: clear the matching pending transaction, no
    // exchange. This is terminal — a fresh login is required.
    const message = "Authentication failed: missing authorization code.";
    await clearPendingGitHubAuth(pending.state, new Error(message));
    publishCallbackIssue(
      { kind: "callback_failed", reason: "malformed_callback" },
      message,
      deps,
    );
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
      // A newer login replaced ours mid-exchange; this callback is terminal but
      // we must not clobber the newer valid transaction.
      return true;
    }

    // Exchange failure is TERMINAL: clear the pending transaction (no marker
    // restore, no retry) so the user must start a new login. Cleanup happens
    // before any reporting, so it holds even if reporting throws.
    await clearStoredPendingAuthSession();

    const message = error instanceof Error ? error.message : "Authentication failed";
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
    }

    publishCallbackIssue(
      { kind: "callback_failed", reason: "exchange_failed" },
      message,
      deps,
    );
    return false;
  }
}
