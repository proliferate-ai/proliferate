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
  reportBackgroundAuthError,
  restorePendingCallbackMarker,
  toError,
  type AuthOrchestrationDeps,
} from "./orchestration-effects";

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
