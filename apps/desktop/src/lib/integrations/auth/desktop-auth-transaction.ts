/**
 * Process-local ownership for the one Desktop authentication attempt that may
 * still mutate auth state. This is deliberately not callback history or a
 * replay queue: replacing an attempt only advances a generation and forgets
 * the prior pending-state owner.
 */
export interface DesktopAuthTransaction {
  readonly generation: number;
}

export interface DesktopAuthSessionAuthority {
  readonly transaction: DesktopAuthTransaction;
  readonly revision: number;
}

let currentGeneration = 0;
let currentPendingState: string | null = null;
let currentSessionAuthorityRevision = 0;
// A freshly loaded process may adopt the one pending transaction restored
// from host storage. Once a ProductHost operation replaces that generation,
// only the new operation may explicitly register its state; an old callback
// cannot claim the replacement during its cancellation window.
let canAdoptPersistedPendingState = true;
let pendingMutationTail: Promise<void> = Promise.resolve();
let sessionMutationTail: Promise<void> = Promise.resolve();

export function replaceDesktopAuthTransaction(): DesktopAuthTransaction {
  currentGeneration += 1;
  currentSessionAuthorityRevision += 1;
  currentPendingState = null;
  canAdoptPersistedPendingState = false;
  return { generation: currentGeneration };
}

/** Reset module state to the one cold-start generation used by focused tests. */
export function resetDesktopAuthTransactionForRestore(): DesktopAuthTransaction {
  currentGeneration += 1;
  currentSessionAuthorityRevision += 1;
  currentPendingState = null;
  canAdoptPersistedPendingState = true;
  return { generation: currentGeneration };
}

export function currentDesktopAuthTransaction(): DesktopAuthTransaction {
  return { generation: currentGeneration };
}

export function isCurrentDesktopAuthTransaction(
  transaction: DesktopAuthTransaction,
): boolean {
  return transaction.generation === currentGeneration;
}

/** Capture the authority that may still publish or persist auth-session state. */
export function currentDesktopAuthSessionAuthority(): DesktopAuthSessionAuthority {
  return {
    transaction: currentDesktopAuthTransaction(),
    revision: currentSessionAuthorityRevision,
  };
}

/**
 * Invalidate older asynchronous session work before the replacement performs
 * its first await. A stale transaction cannot invalidate the current owner.
 */
export function replaceDesktopAuthSessionAuthority(
  transaction: DesktopAuthTransaction = currentDesktopAuthTransaction(),
): DesktopAuthSessionAuthority | null {
  if (!isCurrentDesktopAuthTransaction(transaction)) {
    return null;
  }
  currentSessionAuthorityRevision += 1;
  return {
    transaction,
    revision: currentSessionAuthorityRevision,
  };
}

export function isCurrentDesktopAuthSessionAuthority(
  authority: DesktopAuthSessionAuthority,
): boolean {
  return isCurrentDesktopAuthTransaction(authority.transaction)
    && authority.revision === currentSessionAuthorityRevision;
}

export function desktopAuthTransactionIsPendingRegistrationGap(
  transaction: DesktopAuthTransaction,
): boolean {
  return isCurrentDesktopAuthTransaction(transaction)
    && currentPendingState === null
    && !canAdoptPersistedPendingState;
}

export function claimDesktopAuthPendingState(
  transaction: DesktopAuthTransaction,
  state: string,
): boolean {
  if (!isCurrentDesktopAuthTransaction(transaction)) {
    return false;
  }
  if (currentPendingState === state) {
    return true;
  }
  if (currentPendingState !== null || !canAdoptPersistedPendingState) {
    return false;
  }
  currentPendingState = state;
  canAdoptPersistedPendingState = false;
  return true;
}

/** Register the state created by the current accepted provider operation. */
export function registerDesktopAuthPendingState(
  transaction: DesktopAuthTransaction,
  state: string,
): boolean {
  if (!isCurrentDesktopAuthTransaction(transaction)) {
    return false;
  }
  if (currentPendingState !== null && currentPendingState !== state) {
    return false;
  }
  currentPendingState = state;
  canAdoptPersistedPendingState = false;
  return true;
}

export function desktopAuthTransactionOwnsState(
  transaction: DesktopAuthTransaction,
  state: string,
): boolean {
  return isCurrentDesktopAuthTransaction(transaction)
    && currentPendingState === state;
}

export function releaseDesktopAuthPendingState(
  transaction: DesktopAuthTransaction,
  state: string,
): void {
  if (desktopAuthTransactionOwnsState(transaction, state)) {
    currentPendingState = null;
  }
}

export function staleDesktopAuthTransactionError(): Error {
  const error = new Error("Authentication attempt was replaced.");
  error.name = "AbortError";
  return error;
}

/**
 * Serializes only the short read/compare/write section for pending-auth
 * persistence. Callers still re-check generation ownership after acquiring
 * the lock, so an invalidated attempt never mutates the replacement record.
 */
export async function withDesktopAuthPendingMutation<T>(
  transaction: DesktopAuthTransaction,
  mutation: () => Promise<T>,
): Promise<T | undefined> {
  let release!: () => void;
  const predecessor = pendingMutationTail;
  pendingMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await predecessor;
  try {
    if (!isCurrentDesktopAuthTransaction(transaction)) {
      return undefined;
    }
    return await mutation();
  } finally {
    release();
  }
}

/**
 * Serialize credential commits so a replaced operation can restore the
 * pre-write session before the replacement writes its own credentials.
 */
export async function withDesktopAuthSessionMutation<T>(
  transaction: DesktopAuthTransaction,
  mutation: () => Promise<T>,
): Promise<T | undefined> {
  let release!: () => void;
  const predecessor = sessionMutationTail;
  sessionMutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await predecessor;
  try {
    if (!isCurrentDesktopAuthTransaction(transaction)) {
      return undefined;
    }
    return await mutation();
  } finally {
    release();
  }
}
