import {
  ensureDeepLinkBridge,
} from "@/lib/access/tauri/deep-link";
import {
  clearStoredPendingAuthSession,
  getStoredAuthSession,
  getStoredPendingAuthSession,
  setStoredAuthSession,
} from "@/lib/access/tauri/auth";
import {
  anonymousAuthState,
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
  applyPersistedAuthenticatedAuthState,
  applyVolatileAuthenticatedAuthState,
} from "@/lib/workflows/auth/apply-auth-state";
import { storedSessionWithValidatedUser } from "@/lib/domain/auth/session-mapping";
import { handleDesktopCallbackUrl } from "./orchestration-callback";
import {
  applyAnonymousState,
  applyDevBypassState,
  clearPendingGitHubAuth,
  isTransientBootstrapError,
  recoverValidatedSessionAfterTransientFailure,
  toError,
  validateSession,
  type AuthOrchestrationDeps,
} from "./orchestration-effects";

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
