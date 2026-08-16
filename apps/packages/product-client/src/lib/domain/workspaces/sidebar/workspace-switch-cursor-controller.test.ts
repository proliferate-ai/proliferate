import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceSwitchCursorController,
  WORKSPACE_CURSOR_COMMIT_FALLBACK_MS,
  WORKSPACE_CURSOR_SETTLE_MS,
  WORKSPACE_CURSOR_STEP_MIN_MS,
  type WorkspaceSwitchCursorDeps,
} from "#product/lib/domain/workspaces/sidebar/workspace-switch-cursor-controller";

/**
 * Deterministic fake clock: `now` only moves when the test advances it, and
 * timers fire in fireAt order when their deadline is reached. Injected in place
 * of performance.now / setTimeout so throttle, settle, and fallback edges are
 * exercised without wall-clock flake.
 */
function makeClock() {
  let now = 0;
  let seq = 1;
  const timers = new Map<number, { fireAt: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = seq++;
      timers.set(id, { fireAt: now + ms, fn });
      return id;
    },
    clearTimer: (id: number) => {
      timers.delete(id);
    },
    advance: (ms: number) => {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.fireAt <= now)
        .sort((a, b) => a[1].fireAt - b[1].fireAt);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.fn();
      }
    },
    pending: () => timers.size,
  };
}

interface Harness {
  controller: ReturnType<typeof createWorkspaceSwitchCursorController>;
  clock: ReturnType<typeof makeClock>;
  commits: string[];
  getCursor: () => string | null;
  setCommitted: (id: string | null) => void;
  setTargets: (ids: string[]) => void;
}

function makeHarness(options?: {
  targets?: string[];
  committed?: string | null;
  overrides?: Partial<WorkspaceSwitchCursorDeps>;
}): Harness {
  const clock = makeClock();
  let cursorId: string | null = null;
  let committedId: string | null = options?.committed ?? null;
  let targetIds: string[] = options?.targets ?? ["a", "b", "c", "d"];
  const commits: string[] = [];

  const deps: WorkspaceSwitchCursorDeps = {
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getTargetIds: () => targetIds,
    getCommittedId: () => committedId,
    getCursorId: () => cursorId,
    setCursorId: (next) => {
      cursorId = next;
    },
    commitSelection: (workspaceId) => {
      commits.push(workspaceId);
    },
    ...options?.overrides,
  };

  return {
    controller: createWorkspaceSwitchCursorController(deps),
    clock,
    commits,
    getCursor: () => cursorId,
    setCommitted: (id) => {
      committedId = id;
    },
    setTargets: (ids) => {
      targetIds = ids;
    },
  };
}

describe("workspace-switch-cursor-controller", () => {
  it("previews a step immediately and commits once after the settle quiet", () => {
    const h = makeHarness({ committed: "a" });

    h.controller.step(1);
    expect(h.getCursor()).toBe("b");
    expect(h.commits).toEqual([]);

    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS);
    expect(h.commits).toEqual(["b"]);
    // Cursor is held until the committed selection reflects the target.
    expect(h.getCursor()).toBe("b");
  });

  it("drops key repeats inside the throttle window instead of queueing them", () => {
    const h = makeHarness({ committed: "a" });

    h.controller.step(1); // accepted at now=0 -> cursor b
    h.clock.advance(WORKSPACE_CURSOR_STEP_MIN_MS - 1); // now=59
    h.controller.step(1); // dropped (within throttle), cursor unchanged
    h.controller.step(1); // dropped again
    expect(h.getCursor()).toBe("b");

    h.clock.advance(2); // now=61, next step now accepted
    h.controller.step(1); // cursor c
    expect(h.getCursor()).toBe("c");

    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS);
    // Exactly one commit for the whole burst, landing on the final cursor.
    expect(h.commits).toEqual(["c"]);
  });

  it("re-arms the settle timer across a held burst so the commit only lands after quiet", () => {
    // Ten distinct rows so the walked cursor never wraps back onto the
    // committed row within this burst.
    const h = makeHarness({
      committed: "a",
      targets: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    });

    h.controller.step(1); // accepted, settle armed
    // A held key keeps firing repeats every 30ms; the gap is always shorter than
    // the settle window, so each step (accepted or dropped) pushes the settle
    // out and nothing commits while the key is still held.
    for (let i = 0; i < 8; i += 1) {
      h.clock.advance(30);
      h.controller.step(1);
    }
    expect(h.commits).toEqual([]);

    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS);
    // Exactly one commit for the whole held burst, once movement went quiet.
    expect(h.commits).toHaveLength(1);
  });

  it("clears the cursor when the committed selection reflects the commit", () => {
    const h = makeHarness({ committed: "a" });

    h.controller.step(1);
    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS);
    expect(h.getCursor()).toBe("b");

    h.setCommitted("b");
    h.controller.onCommittedChange("b");
    expect(h.getCursor()).toBeNull();
    // No dangling fallback timer once the commit has reflected.
    expect(h.clock.pending()).toBe(0);
  });

  it("clears the cursor via the fallback timeout when the commit never reflects", () => {
    const h = makeHarness({ committed: "a" });

    h.controller.step(1);
    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS);
    expect(h.getCursor()).toBe("b");

    h.clock.advance(WORKSPACE_CURSOR_COMMIT_FALLBACK_MS);
    expect(h.getCursor()).toBeNull();
  });

  it("lets a mouse click during the pre-settle window win over the pending commit", () => {
    const h = makeHarness({ committed: "a" });

    h.controller.step(1); // cursor b, settle pending
    expect(h.getCursor()).toBe("b");

    // User clicks row d before the settle fires: an external committed change.
    h.setCommitted("d");
    h.controller.onCommittedChange("d");

    expect(h.getCursor()).toBeNull();
    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS + WORKSPACE_CURSOR_COMMIT_FALLBACK_MS);
    // The stale keyboard commit never fires; the click stands.
    expect(h.commits).toEqual([]);
  });

  it("abandons the preview when the selection is overridden after the commit fires", () => {
    const h = makeHarness({ committed: "a" });

    h.controller.step(1);
    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS);
    expect(h.commits).toEqual(["b"]);

    // Selection lands somewhere other than our target while the commit is in
    // flight (a competing click): drop the preview entirely.
    h.controller.onCommittedChange("d");
    expect(h.getCursor()).toBeNull();
    h.clock.advance(WORKSPACE_CURSOR_COMMIT_FALLBACK_MS);
    expect(h.getCursor()).toBeNull();
  });

  it("does not commit a cursor that left the target list mid-traversal", () => {
    const h = makeHarness({ committed: "a" });

    h.controller.step(1); // cursor b
    h.setTargets(["a", "c", "d"]); // b removed while traversing
    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS);

    expect(h.commits).toEqual([]);
    expect(h.getCursor()).toBeNull();
  });

  it("does not re-commit when the cursor settles back on the committed row", () => {
    const h = makeHarness({ committed: "a" });

    h.controller.step(1); // cursor b
    h.controller.step(-1); // dropped (throttle) — cursor still b
    h.clock.advance(WORKSPACE_CURSOR_STEP_MIN_MS + 1);
    h.controller.step(-1); // back to a (the committed row)
    expect(h.getCursor()).toBe("a");

    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS);
    expect(h.commits).toEqual([]);
    expect(h.getCursor()).toBeNull();
  });

  it("cancels an uncommitted preview on Escape", () => {
    const h = makeHarness({ committed: "a" });

    h.controller.step(1);
    expect(h.getCursor()).toBe("b");

    h.controller.cancel();
    expect(h.getCursor()).toBeNull();

    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS + WORKSPACE_CURSOR_COMMIT_FALLBACK_MS);
    expect(h.commits).toEqual([]);
  });

  it("wraps from the first row to the last when stepping backward with no cursor", () => {
    const h = makeHarness({ committed: "a", targets: ["a", "b", "c"] });

    h.controller.step(-1);
    expect(h.getCursor()).toBe("c");
  });

  // NEGATIVE CONTROL: the coalescing (throttle + deferred single commit) is what
  // keeps a held-key burst to one selection commit. A naive commit-per-step
  // stepper with the coalescing removed commits once per keydown, which is the
  // exact 150-250ms-per-key stall this rung exists to eliminate.
  it("negative control: commit-per-step without coalescing commits on every repeat", () => {
    const targets = ["a", "b", "c", "d"];
    const commits: string[] = [];
    let committed = "a";
    const naiveStep = (direction: -1 | 1) => {
      const from = committed;
      const index = targets.indexOf(from);
      const next = targets[(index + direction + targets.length) % targets.length];
      committed = next;
      commits.push(next);
    };

    naiveStep(1);
    naiveStep(1);
    naiveStep(1);

    expect(commits).toEqual(["b", "c", "d"]);
    expect(commits.length).toBeGreaterThan(1);

    // The coalescing controller, given the identical rapid burst, commits once.
    const h = makeHarness({ committed: "a", targets });
    h.controller.step(1);
    h.controller.step(1);
    h.controller.step(1);
    h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS);
    expect(h.commits).toHaveLength(1);
  });

  it("keeps the settle callback from throwing when the cursor was already cleared", () => {
    const h = makeHarness({ committed: "a" });
    const spy = vi.fn();
    h.controller.step(1);
    h.controller.cancel(); // clears cursor and settle timer
    expect(() => h.clock.advance(WORKSPACE_CURSOR_SETTLE_MS)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    expect(h.commits).toEqual([]);
  });
});
