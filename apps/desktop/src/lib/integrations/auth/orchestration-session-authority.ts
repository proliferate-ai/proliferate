import {
  clearStoredAuthSession,
  clearStoredPendingAuthSession,
  getStoredAuthSession,
  setStoredAuthSession,
} from "@/lib/access/tauri/auth";
import { anonymousAuthState } from "@/lib/domain/auth/auth-state-mapping";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";
import { applyVolatileAuthenticatedAuthState } from "@/lib/workflows/auth/apply-auth-state";
import type { AuthOrchestrationDeps } from "./orchestration-effects";
import {
  currentDesktopAuthSessionAuthority,
  isCurrentDesktopAuthSessionAuthority,
  withDesktopAuthSessionMutation,
  type DesktopAuthSessionAuthority,
} from "./desktop-auth-transaction";

export function captureDesktopAuthSessionAuthority(): DesktopAuthSessionAuthority {
  return currentDesktopAuthSessionAuthority();
}

export async function applyVolatileAuthenticatedStateForAuthority(
  deps: AuthOrchestrationDeps,
  session: StoredAuthSession,
  authority: DesktopAuthSessionAuthority,
  options?: {
    user?: AuthUser;
    expectedStoredSession?: StoredAuthSession | null;
    clearSessionRuntimeState?: boolean;
  },
): Promise<boolean> {
  const committed = await withDesktopAuthSessionMutation(
    authority.transaction,
    async () => {
      if (!isCurrentDesktopAuthSessionAuthority(authority)) {
        return false;
      }
      const storedSession = await getStoredAuthSession();
      if (
        !isCurrentDesktopAuthSessionAuthority(authority)
        || !matchesExpectedStoredSession(
          storedSession,
          options?.expectedStoredSession,
        )
      ) {
        return false;
      }
      if (options?.clearSessionRuntimeState) {
        deps.clearSessionRuntimeState();
      }
      applyVolatileAuthenticatedAuthState(
        { session, user: options?.user },
        deps,
      );
      return true;
    },
  );
  return committed === true;
}

export async function applyAuthenticatedStateForAuthority(
  deps: AuthOrchestrationDeps,
  session: StoredAuthSession,
  authority: DesktopAuthSessionAuthority,
  options?: {
    user?: AuthUser;
    expectedStoredSession?: StoredAuthSession | null;
  },
): Promise<boolean> {
  const committed = await withDesktopAuthSessionMutation(
    authority.transaction,
    async () => {
      const previousSession = await getStoredAuthSession();
      if (
        !isCurrentDesktopAuthSessionAuthority(authority)
        || !matchesExpectedStoredSession(
          previousSession,
          options?.expectedStoredSession,
        )
      ) {
        return false;
      }

      await setStoredAuthSession(session);
      if (!isCurrentDesktopAuthSessionAuthority(authority)) {
        // The native write cannot be cancelled once started. Restore exactly
        // what preceded it while replacement commits wait on this same lock.
        await restoreStoredAuthSession(previousSession);
        return false;
      }

      applyVolatileAuthenticatedAuthState(
        { session, user: options?.user },
        deps,
      );
      return true;
    },
  );
  return committed === true;
}

export async function applyAnonymousStateForAuthority(
  deps: AuthOrchestrationDeps,
  authority: DesktopAuthSessionAuthority,
  options?: {
    clearPendingAuth?: boolean;
    expectedStoredSession?: StoredAuthSession | null;
    preserveCurrentIssue?: boolean;
  },
): Promise<boolean> {
  const committed = await withDesktopAuthSessionMutation(
    authority.transaction,
    async () => {
      const previousSession = await getStoredAuthSession();
      if (
        !isCurrentDesktopAuthSessionAuthority(authority)
        || !matchesExpectedStoredSession(
          previousSession,
          options?.expectedStoredSession,
        )
      ) {
        return false;
      }

      await clearStoredAuthSession();
      if (!isCurrentDesktopAuthSessionAuthority(authority)) {
        await restoreStoredAuthSession(previousSession);
        return false;
      }
      if (options?.clearPendingAuth) {
        await clearStoredPendingAuthSession();
        if (!isCurrentDesktopAuthSessionAuthority(authority)) {
          await restoreStoredAuthSession(previousSession);
          return false;
        }
      }

      deps.clearSessionRuntimeState();
      deps.closeRepoSetupModal();
      const issue = options?.preserveCurrentIssue
        ? deps.getAuthState().issue
        : null;
      deps.setAuthState({
        ...anonymousAuthState(),
        issue,
      });
      return true;
    },
  );
  return committed === true;
}

async function restoreStoredAuthSession(
  session: StoredAuthSession | null,
): Promise<void> {
  if (session) {
    await setStoredAuthSession(session);
    return;
  }
  await clearStoredAuthSession();
}

function matchesExpectedStoredSession(
  actual: StoredAuthSession | null,
  expected: StoredAuthSession | null | undefined,
): boolean {
  if (expected === undefined) {
    return true;
  }
  if (!actual || !expected) {
    return actual === expected;
  }
  return actual.access_token === expected.access_token
    && actual.refresh_token === expected.refresh_token
    && actual.expires_at === expected.expires_at
    && actual.user_id === expected.user_id
    && actual.email === expected.email
    && actual.display_name === expected.display_name
    && actual.github_login === expected.github_login
    && actual.avatar_url === expected.avatar_url;
}
