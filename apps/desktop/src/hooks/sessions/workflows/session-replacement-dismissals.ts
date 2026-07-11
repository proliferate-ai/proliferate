interface TrackedReplacementDismissalInput {
  workspaceId: string;
  runtimeSessionId: string;
  run: () => void | Promise<void>;
}

interface QueuedReplacementDismissal {
  promise: Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
  run: () => void | Promise<void>;
}

// Renderer-scoped workflow coordination; no remote data is cached here.
const inFlightDismissalsByWorkspace = new Map<
  string,
  Map<string, Promise<void>>
>();
const queuedDismissalsByWorkspace = new Map<
  string,
  Map<string, QueuedReplacementDismissal>
>();
const activeRestoreFenceCountByWorkspace = new Map<string, number>();
const restoreQueueTailByWorkspace = new Map<string, Promise<void>>();

function hasActiveRestoreFence(workspaceId: string): boolean {
  return (activeRestoreFenceCountByWorkspace.get(workspaceId) ?? 0) > 0;
}

function activateRestoreFence(workspaceId: string): void {
  activeRestoreFenceCountByWorkspace.set(
    workspaceId,
    (activeRestoreFenceCountByWorkspace.get(workspaceId) ?? 0) + 1,
  );
}

function deactivateRestoreFence(workspaceId: string): void {
  const remaining = (
    activeRestoreFenceCountByWorkspace.get(workspaceId) ?? 1
  ) - 1;
  if (remaining > 0) {
    activeRestoreFenceCountByWorkspace.set(workspaceId, remaining);
    return;
  }
  activeRestoreFenceCountByWorkspace.delete(workspaceId);
  drainQueuedDismissals(workspaceId);
}

async function waitForTrackedDismissals(workspaceId: string): Promise<void> {
  const dismissals = [
    ...(inFlightDismissalsByWorkspace.get(workspaceId)?.values() ?? []),
  ];
  if (dismissals.length > 0) {
    await Promise.allSettled(dismissals);
  }
}

function createQueuedDismissal(
  run: () => void | Promise<void>,
): QueuedReplacementDismissal {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve, run };
}

function startTrackedDismissal(
  workspaceId: string,
  runtimeSessionId: string,
  dismissal: QueuedReplacementDismissal,
): Promise<void> {
  let workspaceDismissals = inFlightDismissalsByWorkspace.get(workspaceId);
  const existing = workspaceDismissals?.get(runtimeSessionId);
  if (existing) {
    void existing.then(dismissal.resolve, dismissal.reject);
    return existing;
  }

  if (!workspaceDismissals) {
    workspaceDismissals = new Map();
    inFlightDismissalsByWorkspace.set(workspaceId, workspaceDismissals);
  }

  const tracked = dismissal.promise;
  // Publish the promise before invoking `run`. Besides closing synchronous
  // re-entry races, the microtask boundary lets a restore fence observe and
  // await this cleanup even when it is requested in the same call stack.
  workspaceDismissals.set(runtimeSessionId, tracked);
  void Promise.resolve()
    .then(dismissal.run)
    .then(dismissal.resolve, dismissal.reject);

  const removeTrackedDismissal = () => {
    const currentWorkspaceDismissals = inFlightDismissalsByWorkspace.get(workspaceId);
    if (currentWorkspaceDismissals?.get(runtimeSessionId) !== tracked) {
      return;
    }
    currentWorkspaceDismissals.delete(runtimeSessionId);
    if (currentWorkspaceDismissals.size === 0) {
      inFlightDismissalsByWorkspace.delete(workspaceId);
    }
  };
  void tracked.then(removeTrackedDismissal, removeTrackedDismissal);

  return tracked;
}

function drainQueuedDismissals(workspaceId: string): void {
  if (hasActiveRestoreFence(workspaceId)) {
    return;
  }
  const queuedDismissals = queuedDismissalsByWorkspace.get(workspaceId);
  if (!queuedDismissals) {
    return;
  }

  // Remove the queue before scheduling work. A dismissal's async body can
  // synchronously re-enter the coordinator and should see its tracked entry,
  // not the stale queued copy.
  queuedDismissalsByWorkspace.delete(workspaceId);
  for (const [runtimeSessionId, dismissal] of queuedDismissals) {
    startTrackedDismissal(workspaceId, runtimeSessionId, dismissal);
  }
}

/**
 * Runs one best-effort replacement dismissal per workspace/runtime pair.
 * Restore fences defer new cleanup starts so an already-restored session
 * cannot be dismissed by reconciliation that races with the restore. Deferred
 * cleanup drains after the final same-workspace restore fence closes unless an
 * explicit successful restore cancels that runtime's queued request.
 */
export function runTrackedReplacementDismissal({
  workspaceId,
  runtimeSessionId,
  run,
}: TrackedReplacementDismissalInput): Promise<void> {
  const inFlight = inFlightDismissalsByWorkspace
    .get(workspaceId)
    ?.get(runtimeSessionId);
  if (inFlight) {
    return inFlight;
  }

  if (hasActiveRestoreFence(workspaceId)) {
    let queuedDismissals = queuedDismissalsByWorkspace.get(workspaceId);
    const queued = queuedDismissals?.get(runtimeSessionId);
    if (queued) {
      return queued.promise;
    }
    if (!queuedDismissals) {
      queuedDismissals = new Map();
      queuedDismissalsByWorkspace.set(workspaceId, queuedDismissals);
    }
    const dismissal = createQueuedDismissal(run);
    queuedDismissals.set(runtimeSessionId, dismissal);
    return dismissal.promise;
  }

  return startTrackedDismissal(
    workspaceId,
    runtimeSessionId,
    createQueuedDismissal(run),
  );
}

/**
 * Cancels cleanup that was deferred while an explicit restore was active.
 * This is intentionally exact-runtime only; unrelated queued cleanup still
 * drains when the final restore fence closes.
 */
export function cancelQueuedReplacementDismissal(
  workspaceId: string,
  runtimeSessionId: string,
): boolean {
  const queuedDismissals = queuedDismissalsByWorkspace.get(workspaceId);
  const queued = queuedDismissals?.get(runtimeSessionId);
  if (!queued || !queuedDismissals) {
    return false;
  }

  queuedDismissals.delete(runtimeSessionId);
  if (queuedDismissals.size === 0) {
    queuedDismissalsByWorkspace.delete(workspaceId);
  }
  queued.resolve();
  return true;
}

/**
 * Serializes explicit restores for a workspace and fences them against tracked
 * replacement dismissal. The fence is active synchronously, before waiting on
 * cleanup that was already in flight.
 */
export function withWorkspaceReplacementRestoreFence<T>(
  workspaceId: string,
  restoreFn: () => T | Promise<T>,
): Promise<T> {
  activateRestoreFence(workspaceId);

  const previousRestore = restoreQueueTailByWorkspace.get(workspaceId)
    ?? Promise.resolve();
  const restore = previousRestore.then(async () => {
    await waitForTrackedDismissals(workspaceId);
    return await restoreFn();
  });
  const queueTail = restore.then(
    () => undefined,
    () => undefined,
  );
  restoreQueueTailByWorkspace.set(workspaceId, queueTail);
  void queueTail.then(() => {
    if (restoreQueueTailByWorkspace.get(workspaceId) === queueTail) {
      restoreQueueTailByWorkspace.delete(workspaceId);
    }
  });

  return restore.finally(() => {
    deactivateRestoreFence(workspaceId);
  });
}

export function resetSessionReplacementDismissalsForTests(): void {
  for (const queuedDismissals of queuedDismissalsByWorkspace.values()) {
    for (const queued of queuedDismissals.values()) {
      queued.resolve();
    }
  }
  inFlightDismissalsByWorkspace.clear();
  queuedDismissalsByWorkspace.clear();
  activeRestoreFenceCountByWorkspace.clear();
  restoreQueueTailByWorkspace.clear();
}
