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
import { storedSessionWithValidatedUser } from "@/lib/domain/auth/session-mapping";
import { desktopAuthCoordinator } from "./auth-coordinator-instance";
import { handleDesktopCallbackUrl } from "./orchestration-callback";
import {
  applyDevBypassState,
  applySignedOutState,
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
    await applyDevBypassState();
    logStartupDebug("auth.bootstrap.dev_bypass", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  const storedSession = await getStoredAuthSession();
  // Normally a no-op: the host resolves the provisional authority before the
  // first render (main.tsx) so remote providers never mount unresolved.
  await desktopAuthCoordinator.resolveProvisionalAuthority(storedSession);
  const { authGeneration } = desktopAuthCoordinator.getAuthorityStamp();

  const controlPlaneReachable = await checkControlPlaneReachable();
  if (!controlPlaneReachable) {
    await clearStoredPendingAuthSession();
    deps.clearSessionRuntimeState();

    if (storedSession) {
      // Transient authenticated outage: retain the resolved principal and
      // generation underneath the normalized "unreachable" status.
      await desktopAuthCoordinator.commitBootstrapSession({
        expectedGeneration: authGeneration,
        session: storedSession,
        persist: false,
        reachable: false,
      });
      logStartupDebug("auth.bootstrap.control_plane_unreachable.cached_session", {
        elapsedMs: elapsedStartupMs(startedAt),
      });
      return;
    }

    await desktopAuthCoordinator.publishBootstrapAnonymous({
      expectedGeneration: authGeneration,
    });
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
    await desktopAuthCoordinator.publishBootstrapAnonymous({
      expectedGeneration: authGeneration,
    });
    logStartupDebug("auth.bootstrap.no_stored_session", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
    return;
  }

  try {
    logStartupDebug("auth.bootstrap.validate_stored_session.start");
    const { session, user } = await validateSession(storedSession);
    const persistedSession = storedSessionWithValidatedUser(session, user);
    await desktopAuthCoordinator.commitBootstrapSession({
      expectedGeneration: authGeneration,
      session: persistedSession,
      user,
      persist: true,
      reachable: true,
    });
    logStartupDebug("auth.bootstrap.validate_stored_session.completed", {
      elapsedMs: elapsedStartupMs(startedAt),
    });
  } catch (error) {
    if (isTransientBootstrapError(error)) {
      await desktopAuthCoordinator.commitBootstrapSession({
        expectedGeneration: authGeneration,
        session: storedSession,
        persist: false,
        reachable: false,
      });
      logStartupDebug("auth.bootstrap.transient_failure_background_recovery", {
        elapsedMs: elapsedStartupMs(startedAt),
        ...summarizeStartupError(error),
      });
      void recoverValidatedSessionAfterTransientFailure(storedSession, deps);
      return;
    }

    await applySignedOutState(deps, {
      expectedGeneration: authGeneration,
      viaInvalidation: true,
    });
    logStartupDebug("auth.bootstrap.failed_anonymous", {
      elapsedMs: elapsedStartupMs(startedAt),
      ...summarizeStartupError(error),
    });
    throw toError(error, "Auth bootstrap failed");
  }
}
