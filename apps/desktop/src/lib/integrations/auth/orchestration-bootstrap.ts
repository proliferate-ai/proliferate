import {
  ensureDeepLinkBridge,
} from "@/lib/access/tauri/deep-link";
import {
  clearStoredPendingAuthSession,
  getStoredAuthSession,
  getStoredPendingAuthSession,
} from "@/lib/access/tauri/auth";
import {
  bootstrappingAuthStatePatch,
} from "@/lib/domain/auth/auth-state-mapping";
import { isDevAuthBypassed } from "@/lib/domain/auth/auth-mode";
import {
  isPendingDesktopAuthExpired,
} from "@/lib/integrations/auth/proliferate-auth";
import { checkControlPlaneReachable } from "@/lib/access/cloud/health";
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
  summarizeStartupError,
} from "@/lib/infra/measurement/debug-startup";
import {
  storedSessionWithValidatedUser,
} from "@/lib/domain/auth/session-mapping";
import { handleDesktopCallbackUrl } from "./orchestration-callback";
import {
  applyDevBypassState,
  clearPendingGitHubAuth,
  isTransientBootstrapError,
  recoverValidatedSessionAfterTransientFailure,
  toError,
  validateSession,
  type AuthOrchestrationDeps,
} from "./orchestration-effects";
import {
  applyAnonymousStateForAuthority,
  applyAuthenticatedStateForAuthority,
  applyVolatileAuthenticatedStateForAuthority,
  captureDesktopAuthSessionAuthority,
} from "./orchestration-session-authority";
import { isCurrentDesktopAuthSessionAuthority } from "./desktop-auth-transaction";

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

  // Registration is intentionally started before the first bootstrap await.
  // Product-entry routing can subscribe in the same React effect turn, and
  // both consumers must be present before the shared native listener delivers
  // a live auth callback.
  const deepLinkBridge = ensureDeepLinkBridge((url) =>
    handleDesktopCallbackUrl(url, deps));

  // Probe reachability in parallel, but let the initial auth deep-link drain
  // finish before reading authoritative credentials or deciding anonymous
  // state. A cold-start callback may persist a new session or publish a
  // terminal issue while this bridge is draining.
  const controlPlaneReachablePromise = checkControlPlaneReachable();
  await deepLinkBridge;
  const bootstrapAuthority = captureDesktopAuthSessionAuthority();
  const storedSession = await getStoredAuthSession();
  const controlPlaneReachable = await controlPlaneReachablePromise;
  if (!controlPlaneReachable) {
    if (!isCurrentDesktopAuthSessionAuthority(bootstrapAuthority)) {
      return;
    }

    if (storedSession) {
      await applyVolatileAuthenticatedStateForAuthority(
        deps,
        storedSession,
        bootstrapAuthority,
        {
          expectedStoredSession: storedSession,
          clearSessionRuntimeState: true,
        },
      );
      logStartupDebug("auth.bootstrap.control_plane_unreachable.cached_session", {
        elapsedMs: elapsedStartupMs(startedAt),
      });
      return;
    }

    await applyAnonymousStatePreservingCallbackIssue(
      deps,
      bootstrapAuthority,
      null,
    );
    logStartupDebug("auth.bootstrap.control_plane_unreachable.anonymous", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  const pending = await getStoredPendingAuthSession();
  if (pending && isPendingDesktopAuthExpired(pending)) {
    await clearPendingGitHubAuth(
      pending.state,
      new Error("GitHub sign-in expired. Start again from Proliferate."),
      bootstrapAuthority.transaction,
    );
  }

  if (!storedSession) {
    await applyAnonymousStatePreservingCallbackIssue(
      deps,
      bootstrapAuthority,
      null,
    );
    logStartupDebug("auth.bootstrap.no_stored_session", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  try {
    logStartupDebug("auth.bootstrap.validate_stored_session.start");
    const { session, user } = await validateSession(storedSession);
    const persistedSession = storedSessionWithValidatedUser(session, user);
    await applyAuthenticatedStateForAuthority(
      deps,
      persistedSession,
      bootstrapAuthority,
      { user, expectedStoredSession: storedSession },
    );
    logStartupDebug("auth.bootstrap.validate_stored_session.completed", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
  } catch (error) {
    if (isTransientBootstrapError(error)) {
      await applyVolatileAuthenticatedStateForAuthority(
        deps,
        storedSession,
        bootstrapAuthority,
        { expectedStoredSession: storedSession },
      );
      logStartupDebug("auth.bootstrap.transient_failure_background_recovery", {
        elapsedMs: elapsedStartupMs(startedAt),
        ...summarizeStartupError(error),
      });
      void recoverValidatedSessionAfterTransientFailure(
        storedSession,
        deps,
        bootstrapAuthority,
      );
      return;
    }

    await applyAnonymousStateForAuthority(
      deps,
      bootstrapAuthority,
      {
        expectedStoredSession: storedSession,
        preserveCurrentIssue: true,
      },
    );
    logStartupDebug("auth.bootstrap.failed_anonymous", {
      elapsedMs: elapsedStartupMs(startedAt),
      ...summarizeStartupError(error),
    });
    throw toError(error, "Auth bootstrap failed");
  }
}

async function applyAnonymousStatePreservingCallbackIssue(
  deps: AuthOrchestrationDeps,
  authority: ReturnType<typeof captureDesktopAuthSessionAuthority>,
  expectedStoredSession: null,
): Promise<void> {
  await applyAnonymousStateForAuthority(
    deps,
    authority,
    {
      expectedStoredSession,
      preserveCurrentIssue: true,
    },
  );
}
