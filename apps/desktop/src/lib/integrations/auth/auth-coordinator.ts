import {
  anonymousAuthority,
  isSameAuthority,
  userAuthority,
  type AuthAuthority,
} from "@/lib/domain/auth/auth-authority";
import {
  anonymousAuthState,
  authenticatedAuthState,
  unreachableAuthState,
  type AuthClientState,
  type AuthClientStatePatch,
} from "@/lib/domain/auth/auth-state-mapping";
import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";

// The ONE host-owned auth coordinator (web-desktop-client-unification.md
// §4.2). Every credential-changing operation — bootstrap resolution, sign-in
// transaction commit, refresh replacement, 401 invalidation, sign-out — is
// serialized through a single FIFO queue and compare-and-swapped against the
// authority generation, credential revision, or sign-in transaction it
// belongs to. It is the only path to stored-credential writes/clears; raw
// Cloud middleware and stream code never mutate storage behind the auth
// store. A stale completion (old generation, old revision, superseded
// transaction) is discarded without any storage or state mutation.

export interface AuthCoordinatorDeps {
  getAuthState(): AuthClientState;
  setAuthState(patch: AuthClientStatePatch): void;
  getStoredCredentials(): Promise<StoredAuthSession | null>;
  setStoredCredentials(session: StoredAuthSession): Promise<void>;
  clearStoredCredentials(): Promise<void>;
  refreshSession(refreshToken: string): Promise<StoredAuthSession>;
  isSessionExpiring(session: StoredAuthSession): boolean;
  isDefinitiveRejection(error: unknown): boolean;
}

// Stamp of the credentials a request actually used; a late 401 carries it
// back so an old revision/generation can never invalidate newer credentials.
export interface AuthorityStamp {
  authGeneration: number;
  credentialRevision: number;
}

export interface AuthCredentialSnapshot extends AuthorityStamp {
  session: StoredAuthSession;
}

export type AuthRejectionOutcome =
  // The failed request used the current credentials; a fresh token replaced
  // them (revision advanced) — retry once with the new session.
  | { kind: "refreshed"; session: StoredAuthSession }
  // The failed request used an already-replaced token; newer credentials
  // exist and were not touched — retry once with them.
  | { kind: "superseded"; session: StoredAuthSession }
  // Definitive server rejection of the current credentials: storage cleared,
  // generation advanced, anonymous published.
  | { kind: "invalidated" }
  // The request belonged to an older authority generation; nothing changed
  // and it must not retry with the newer authority's credentials.
  | { kind: "stale-authority" }
  // Transient refresh failure: authority retained, status unreachable.
  | { kind: "unavailable" };

export interface AuthCoordinator {
  getAuthorityStamp(): AuthorityStamp;
  // Pre-render/bootstrap authority resolution from the stored session; no-op
  // once any authority is resolved.
  resolveProvisionalAuthority(stored: StoredAuthSession | null): Promise<void>;
  // Bootstrap concluded with no stored session: publish anonymous. CAS on the
  // generation observed when bootstrap started.
  publishBootstrapAnonymous(input: { expectedGeneration: number }): Promise<boolean>;
  // Bootstrap/recovery validated (or optimistically restored) a session for
  // the provisional authority. Same-authority commits do not advance the
  // generation; a different principal replaces the authority and advances it.
  commitBootstrapSession(input: {
    expectedGeneration: number;
    session: StoredAuthSession;
    user?: AuthUser;
    persist: boolean;
    reachable: boolean;
  }): Promise<boolean>;
  // Volatile authority replacement without persistence (dev bypass only).
  commitVolatileSession(session: StoredAuthSession): Promise<boolean>;
  beginSignInTransaction(transactionId: string): void;
  cancelSignInTransaction(transactionId?: string): void;
  isSignInTransactionCurrent(transactionId: string): boolean;
  // Sign-in/callback credential commit: succeeds only while the transaction
  // is current; always replaces the session authority (a replacement login by
  // the same principal still advances the generation).
  commitSignInSession(input: {
    transactionId: string;
    session: StoredAuthSession;
    user?: AuthUser;
  }): Promise<boolean>;
  // Explicit sign-out. CAS: a late generation-N clear cannot erase N+1.
  signOut(input: { expectedGeneration: number }): Promise<boolean>;
  // Definitive refresh rejection/revocation. CAS on generation and, when the
  // failure came from a request, the credential revision that request used.
  invalidateAuthority(input: {
    expectedGeneration: number;
    credentialRevision?: number;
  }): Promise<boolean>;
  // Transient outage: keep principal + generation, flip status only.
  markUnreachable(input: { expectedGeneration: number }): Promise<boolean>;
  // Deployment answered again: recover authenticated presentation for the
  // retained authority. Status-only; never touches generation or revision.
  markReachable(): Promise<boolean>;
  // One atomic fresh session + revision/generation snapshot, refreshing an
  // expiring token via a single-flight refresh commit.
  getFreshCredentialSnapshot(): Promise<AuthCredentialSnapshot | null>;
  // Serialized 401 handling carrying the failed request's stamp.
  handleCloudAuthRejection(stamp: AuthorityStamp): Promise<AuthRejectionOutcome>;
}

export function createAuthCoordinator(deps: AuthCoordinatorDeps): AuthCoordinator {
  let queue: Promise<unknown> = Promise.resolve();
  let currentSignInTransaction: string | null = null;
  let lastCommittedSignInTransaction: string | null = null;
  let refreshInFlight: {
    refreshToken: string;
    promise: Promise<StoredAuthSession>;
  } | null = null;

  function enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = queue.then(operation, operation);
    queue = next.catch(() => {});
    return next;
  }

  function state(): AuthClientState {
    return deps.getAuthState();
  }

  // Reuse the existing authority object when unchanged so store selectors and
  // provider memoization stay referentially stable across confirmations.
  function nextAuthority(target: AuthAuthority): AuthAuthority {
    const current = state().authority;
    return current !== null && isSameAuthority(current, target) ? current : target;
  }

  function sessionAuthority(session: StoredAuthSession): AuthAuthority {
    return userAuthority(session.user_id);
  }

  function publishAuthorityReplacement(
    authority: AuthAuthority,
    presentation: ReturnType<typeof anonymousAuthState>,
  ): void {
    const current = state();
    deps.setAuthState({
      ...presentation,
      authority: nextAuthority(authority),
      authGeneration: current.authGeneration + 1,
      credentialRevision: current.credentialRevision + 1,
    });
  }

  async function refreshSessionShared(
    session: StoredAuthSession,
  ): Promise<StoredAuthSession> {
    if (refreshInFlight?.refreshToken === session.refresh_token) {
      return refreshInFlight.promise;
    }
    const promise = deps.refreshSession(session.refresh_token);
    refreshInFlight = { refreshToken: session.refresh_token, promise };
    try {
      return await promise;
    } finally {
      if (refreshInFlight?.promise === promise) {
        refreshInFlight = null;
      }
    }
  }

  // Commit a refreshed session for the same authority: advances only the
  // credential revision, persists, and recovers an unreachable status. CAS on
  // generation + the refresh-token lineage the refresh consumed.
  function commitRefreshLocked(input: {
    expectedGeneration: number;
    consumedRefreshToken: string;
    refreshed: StoredAuthSession;
  }): Promise<boolean> {
    return enqueue(async () => {
      const current = state();
      if (current.authGeneration !== input.expectedGeneration) {
        return false;
      }
      if (!isSameAuthority(current.authority, sessionAuthority(input.refreshed))) {
        return false;
      }
      if (
        current.session !== null
        && current.session.refresh_token !== input.consumedRefreshToken
      ) {
        // A different credential set was committed meanwhile; discard.
        return false;
      }
      await deps.setStoredCredentials(input.refreshed);
      deps.setAuthState({
        session: input.refreshed,
        // Ordinary refresh continues the same session authority: the
        // generation must not advance (§4.2).
        credentialRevision: current.credentialRevision + 1,
        ...(current.status === "unreachable" ? { status: "authenticated" as const } : {}),
      });
      return true;
    });
  }

  async function refreshAndCommit(
    candidate: StoredAuthSession,
    expectedGeneration: number,
  ): Promise<StoredAuthSession | null> {
    const refreshed = await refreshSessionShared(candidate);
    const committed = await commitRefreshLocked({
      expectedGeneration,
      consumedRefreshToken: candidate.refresh_token,
      refreshed,
    });
    if (committed) {
      return refreshed;
    }
    // Superseded while refreshing: adopt whatever is current instead.
    const current = state();
    return current.authGeneration === expectedGeneration ? current.session : null;
  }

  function invalidateAuthority(input: {
    expectedGeneration: number;
    credentialRevision?: number;
  }): Promise<boolean> {
    return enqueue(async () => {
      const current = state();
      if (current.authGeneration !== input.expectedGeneration) {
        return false;
      }
      if (
        input.credentialRevision !== undefined
        && input.credentialRevision !== current.credentialRevision
      ) {
        // The rejected request used an already-replaced token; the newer
        // credentials stand.
        return false;
      }
      await deps.clearStoredCredentials();
      publishAuthorityReplacement(anonymousAuthority(), anonymousAuthState());
      return true;
    });
  }

  function markUnreachable(input: { expectedGeneration: number }): Promise<boolean> {
    return enqueue(() => {
      const current = state();
      if (
        current.authGeneration !== input.expectedGeneration
        || current.status !== "authenticated"
      ) {
        return false;
      }
      deps.setAuthState({ status: "unreachable" });
      return true;
    });
  }

  return {
    getAuthorityStamp() {
      const current = state();
      return {
        authGeneration: current.authGeneration,
        credentialRevision: current.credentialRevision,
      };
    },

    resolveProvisionalAuthority(stored) {
      return enqueue(() => {
        const current = state();
        if (current.authority !== null) {
          return;
        }
        deps.setAuthState({
          authority: stored ? sessionAuthority(stored) : anonymousAuthority(),
          authGeneration: current.authGeneration + 1,
        });
      });
    },

    publishBootstrapAnonymous({ expectedGeneration }) {
      return enqueue(() => {
        const current = state();
        if (current.authGeneration !== expectedGeneration) {
          return false;
        }
        if (current.authority !== null && current.authority.kind === "anonymous") {
          // Confirming the provisional anonymous authority: same authority
          // continuing, no epoch advance.
          deps.setAuthState(anonymousAuthState());
          return true;
        }
        publishAuthorityReplacement(anonymousAuthority(), anonymousAuthState());
        return true;
      });
    },

    commitBootstrapSession({ expectedGeneration, session, user, persist, reachable }) {
      return enqueue(async () => {
        const current = state();
        if (current.authGeneration !== expectedGeneration) {
          return false;
        }
        const authority = sessionAuthority(session);
        const presentation = reachable
          ? authenticatedAuthState(session, user)
          : unreachableAuthState(session, user);
        if (persist) {
          await deps.setStoredCredentials(session);
        }
        if (current.authority !== null && isSameAuthority(current.authority, authority)) {
          // Same session authority continuing (validation/recovery): the
          // epoch stays; advance the revision only if the token changed.
          const tokenReplaced =
            current.session !== null
            && current.session.access_token !== session.access_token;
          deps.setAuthState({
            ...presentation,
            authority: current.authority,
            ...(tokenReplaced
              ? { credentialRevision: current.credentialRevision + 1 }
              : {}),
          });
          return true;
        }
        publishAuthorityReplacement(authority, presentation);
        return true;
      });
    },

    commitVolatileSession(session) {
      return enqueue(() => {
        publishAuthorityReplacement(
          sessionAuthority(session),
          authenticatedAuthState(session),
        );
        return true;
      });
    },

    beginSignInTransaction(transactionId) {
      // Latest sign-in intent wins; a commit from a superseded transaction
      // fails its CAS below.
      currentSignInTransaction = transactionId;
    },

    cancelSignInTransaction(transactionId) {
      if (transactionId === undefined || currentSignInTransaction === transactionId) {
        currentSignInTransaction = null;
      }
    },

    isSignInTransactionCurrent(transactionId) {
      return currentSignInTransaction === transactionId;
    },

    commitSignInSession({ transactionId, session, user }) {
      return enqueue(async () => {
        if (currentSignInTransaction !== transactionId) {
          // The callback handler and the interactive flow can both commit the
          // same transaction; the second arrival is an idempotent duplicate,
          // not a superseded transaction.
          return lastCommittedSignInTransaction === transactionId;
        }
        currentSignInTransaction = null;
        lastCommittedSignInTransaction = transactionId;
        await deps.setStoredCredentials(session);
        // A committed sign-in replaces the session authority even for the
        // same principal: two logins are two authorities (§5.1).
        publishAuthorityReplacement(
          sessionAuthority(session),
          authenticatedAuthState(session, user),
        );
        return true;
      });
    },

    signOut({ expectedGeneration }) {
      return enqueue(async () => {
        const current = state();
        if (current.authGeneration !== expectedGeneration) {
          return false;
        }
        await deps.clearStoredCredentials();
        publishAuthorityReplacement(anonymousAuthority(), anonymousAuthState());
        return true;
      });
    },

    invalidateAuthority,

    markUnreachable,

    markReachable() {
      if (state().status !== "unreachable") {
        return Promise.resolve(false);
      }
      return enqueue(() => {
        const current = state();
        if (current.status !== "unreachable" || current.session === null) {
          return false;
        }
        deps.setAuthState({ status: "authenticated" });
        return true;
      });
    },

    async getFreshCredentialSnapshot() {
      const observed = state();
      const candidate = observed.session ?? (await deps.getStoredCredentials());
      if (!candidate) {
        return null;
      }
      if (!deps.isSessionExpiring(candidate)) {
        const current = state();
        return {
          session: current.session ?? candidate,
          authGeneration: current.authGeneration,
          credentialRevision: current.credentialRevision,
        };
      }
      let session: StoredAuthSession | null;
      try {
        session = await refreshAndCommit(candidate, observed.authGeneration);
      } catch (error) {
        // Only a definitive server rejection invalidates the stored session;
        // a network blip during refresh keeps the authority and goes
        // unreachable instead of signing the user out.
        if (deps.isDefinitiveRejection(error)) {
          await invalidateAuthority({
            expectedGeneration: observed.authGeneration,
            credentialRevision: observed.credentialRevision,
          });
        } else {
          await markUnreachable({ expectedGeneration: observed.authGeneration });
        }
        return null;
      }
      if (!session) {
        return null;
      }
      const current = state();
      return {
        session,
        authGeneration: current.authGeneration,
        credentialRevision: current.credentialRevision,
      };
    },

    async handleCloudAuthRejection(stamp) {
      const triage = await enqueue<
        | { kind: "stale-authority" }
        | { kind: "superseded"; session: StoredAuthSession }
        | { kind: "current"; session: StoredAuthSession | null }
      >(() => {
        const current = state();
        if (stamp.authGeneration !== current.authGeneration) {
          return { kind: "stale-authority" as const };
        }
        if (stamp.credentialRevision !== current.credentialRevision) {
          // A newer token already committed within this authority: the late
          // 401 from the old token is a no-op invalidation.
          return current.session !== null
            ? { kind: "superseded" as const, session: current.session }
            : { kind: "stale-authority" as const };
        }
        return { kind: "current" as const, session: current.session };
      });
      if (triage.kind !== "current") {
        return triage;
      }

      const candidate = triage.session ?? (await deps.getStoredCredentials());
      if (!candidate) {
        const invalidated = await invalidateAuthority({
          expectedGeneration: stamp.authGeneration,
          credentialRevision: stamp.credentialRevision,
        });
        return invalidated ? { kind: "invalidated" } : { kind: "stale-authority" };
      }

      try {
        const refreshed = await refreshSessionShared(candidate);
        const committed = await commitRefreshLocked({
          expectedGeneration: stamp.authGeneration,
          consumedRefreshToken: candidate.refresh_token,
          refreshed,
        });
        if (committed) {
          return { kind: "refreshed", session: refreshed };
        }
        const current = state();
        return current.authGeneration === stamp.authGeneration
          && current.session !== null
          ? { kind: "superseded", session: current.session }
          : { kind: "stale-authority" };
      } catch (error) {
        if (deps.isDefinitiveRejection(error)) {
          const invalidated = await invalidateAuthority({
            expectedGeneration: stamp.authGeneration,
            credentialRevision: stamp.credentialRevision,
          });
          return invalidated ? { kind: "invalidated" } : { kind: "stale-authority" };
        }
        await markUnreachable({ expectedGeneration: stamp.authGeneration });
        return { kind: "unavailable" };
      }
    },
  };
}
