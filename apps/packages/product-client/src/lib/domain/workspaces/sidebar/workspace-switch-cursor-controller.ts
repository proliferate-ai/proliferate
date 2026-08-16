import { resolveAdjacentSidebarShortcutTarget } from "#product/lib/domain/workspaces/sidebar/sidebar-shortcut-targets";

/**
 * Minimum spacing between accepted cursor steps. A held arrow fires OS key
 * repeats far faster than a row highlight needs to move; repeats that arrive
 * inside this window are dropped, never queued, so releasing the key never
 * replays a backlog of presses.
 */
export const WORKSPACE_CURSOR_STEP_MIN_MS = 60;

/**
 * Quiet period after the last accepted step before the previewed cursor is
 * committed as the real workspace selection. Re-armed on every step (including
 * dropped repeats) so the single expensive commit only fires once traversal
 * has actually stopped.
 */
export const WORKSPACE_CURSOR_SETTLE_MS = 180;

/**
 * Upper bound on how long the cursor waits for the committed selection to
 * reflect the target before clearing itself anyway. Covers a commit that fails
 * (error toast path) or is superseded so the preview highlight never sticks.
 */
export const WORKSPACE_CURSOR_COMMIT_FALLBACK_MS = 2000;

export interface WorkspaceSwitchCursorDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
  /** Current ordered sidebar traversal target ids, read fresh per step. */
  getTargetIds: () => readonly string[];
  /** Committed selection id (logical preferred), read fresh per step. */
  getCommittedId: () => string | null;
  getCursorId: () => string | null;
  setCursorId: (cursorId: string | null) => void;
  /** Commit the real selection. May resolve the store update asynchronously. */
  commitSelection: (workspaceId: string) => void;
}

export interface WorkspaceSwitchCursorController {
  /** Advance the preview cursor one row in `direction` (throttled). */
  step: (direction: -1 | 1) => void;
  /**
   * React to a committed-selection change. Distinguishes the controller's own
   * pending commit reflecting (clears the cursor) from an external selection
   * such as a mouse click landing mid-preview (cancels the pending commit so
   * the click wins).
   */
  onCommittedChange: (committedId: string | null) => void;
  /** Cancel an uncommitted preview (Escape) and reset throttle state. */
  cancel: () => void;
}

/**
 * Owns the step / settle / coalescing state machine for held-key workspace
 * traversal. Pure of React and of any concrete timer or store so the throttle,
 * settle, and commit-reflection edges can be exercised with fake timers.
 */
export function createWorkspaceSwitchCursorController(
  deps: WorkspaceSwitchCursorDeps,
): WorkspaceSwitchCursorController {
  let lastStepAt = Number.NEGATIVE_INFINITY;
  let settleTimer: number | null = null;
  let fallbackTimer: number | null = null;
  // Set to the id we handed to commitSelection while we wait for the committed
  // store to reflect it; null whenever we are idle or only previewing.
  let pendingCommitId: string | null = null;

  function clearSettleTimer(): void {
    if (settleTimer !== null) {
      deps.clearTimer(settleTimer);
      settleTimer = null;
    }
  }

  function clearFallbackTimer(): void {
    if (fallbackTimer !== null) {
      deps.clearTimer(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function clearCursorIfEquals(cursorId: string): void {
    if (deps.getCursorId() === cursorId) {
      deps.setCursorId(null);
    }
  }

  function armSettle(): void {
    clearSettleTimer();
    settleTimer = deps.setTimer(() => {
      settleTimer = null;
      commit();
    }, WORKSPACE_CURSOR_SETTLE_MS);
  }

  function commit(): void {
    const cursorId = deps.getCursorId();
    if (cursorId === null) {
      return;
    }
    // Edge: the sidebar target list changed mid-traversal and the previewed row
    // is gone. Never commit a stale id; just drop the preview.
    if (!deps.getTargetIds().includes(cursorId)) {
      deps.setCursorId(null);
      return;
    }
    if (cursorId === deps.getCommittedId()) {
      // Cursor walked back to the already-selected row: nothing to commit.
      deps.setCursorId(null);
      return;
    }
    pendingCommitId = cursorId;
    deps.commitSelection(cursorId);
    // commitSelection may update the committed store synchronously (then
    // onCommittedChange already cleared pendingCommitId) or asynchronously; only
    // arm the fallback while we are genuinely still waiting.
    if (pendingCommitId === cursorId) {
      clearFallbackTimer();
      fallbackTimer = deps.setTimer(() => {
        fallbackTimer = null;
        pendingCommitId = null;
        clearCursorIfEquals(cursorId);
      }, WORKSPACE_CURSOR_COMMIT_FALLBACK_MS);
    }
  }

  function step(direction: -1 | 1): void {
    const now = deps.now();
    if (now - lastStepAt < WORKSPACE_CURSOR_STEP_MIN_MS) {
      // Over the throttle: drop this repeat but keep the settle timer pushed out
      // so the commit still waits for true quiet after the held key releases.
      armSettle();
      return;
    }
    lastStepAt = now;
    const fromId = deps.getCursorId() ?? deps.getCommittedId();
    const targetId = resolveAdjacentSidebarShortcutTarget(
      deps.getTargetIds(),
      fromId,
      direction,
    );
    if (targetId === null) {
      return;
    }
    deps.setCursorId(targetId);
    armSettle();
  }

  function onCommittedChange(committedId: string | null): void {
    if (pendingCommitId !== null) {
      if (committedId === pendingCommitId) {
        // Our own commit landed: retire the preview in favor of the real prop.
        clearFallbackTimer();
        const settled = pendingCommitId;
        pendingCommitId = null;
        clearCursorIfEquals(settled);
      } else {
        // Selection moved somewhere else while our commit was in flight: an
        // external actor won, so abandon the preview entirely.
        cancel();
      }
      return;
    }
    if (settleTimer !== null) {
      // A committed selection arrived while we were still previewing (a mouse
      // click on another row): let the click win and drop the pending commit.
      cancel();
    }
  }

  function cancel(): void {
    clearSettleTimer();
    clearFallbackTimer();
    pendingCommitId = null;
    lastStepAt = Number.NEGATIVE_INFINITY;
    if (deps.getCursorId() !== null) {
      deps.setCursorId(null);
    }
  }

  return { step, onCommittedChange, cancel };
}
