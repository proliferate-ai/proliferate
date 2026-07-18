import { describe, expect, it, vi } from "vitest";
import type { Goal } from "@anyharness/sdk";
import { DEFAULT_NEW_SESSION_GOAL_TOKEN_BUDGET } from "#product/config/goals";
import {
  buildGoalObjectiveRequest,
  buildQueuedGoalObjectiveRequest,
  enqueueSessionGoalLifecycleMutation,
  forgetSessionGoalIntent,
  recordSessionGoalCleared,
  recordSessionGoalMutation,
  requireGoalArmState,
  requireSafeGoalClear,
  sessionCancelGoalFence,
  stopGoalThenCancelCurrentWork,
} from "#product/hooks/sessions/workflows/session-goal-lifecycle";

describe("session goal lifecycle", () => {
  it("gives every fresh product-created goal a finite requested token budget", () => {
    expect(DEFAULT_NEW_SESSION_GOAL_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(buildGoalObjectiveRequest("Finish the task", null)).toEqual({
      objective: "Finish the task",
      tokenBudget: DEFAULT_NEW_SESSION_GOAL_TOKEN_BUDGET,
    });
    expect(buildGoalObjectiveRequest("Try again", "failed")).toEqual({
      objective: "Try again",
      tokenBudget: DEFAULT_NEW_SESSION_GOAL_TOKEN_BUDGET,
    });
  });

  it("does not replace native accounting when editing an active or paused goal", () => {
    expect(buildGoalObjectiveRequest("Narrow the task", "active"))
      .toEqual({ objective: "Narrow the task" });
    expect(buildGoalObjectiveRequest("Revise while paused", "paused"))
      .toEqual({ objective: "Revise while paused" });
  });

  it("keeps a later cancel behind an already-started goal write", async () => {
    const calls: string[] = [];
    let releaseGoalWrite: (() => void) | undefined;
    const goalWrite = enqueueSessionGoalLifecycleMutation("session-ordered", async () => {
      calls.push("goal-write");
      await new Promise<void>((resolve) => {
        releaseGoalWrite = resolve;
      });
    });
    const cancel = enqueueSessionGoalLifecycleMutation("session-ordered", async () => {
      calls.push("cancel");
    });

    await vi.waitFor(() => expect(calls).toEqual(["goal-write"]));
    releaseGoalWrite?.();
    await Promise.all([goalWrite, cancel]);

    expect(calls).toEqual(["goal-write", "cancel"]);
  });

  it("continues the session queue after a failed write so retry can run", async () => {
    const calls: string[] = [];
    const failed = enqueueSessionGoalLifecycleMutation("session-retry", async () => {
      calls.push("failed-write");
      throw new Error("native write failed");
    });
    const retry = enqueueSessionGoalLifecycleMutation("session-retry", async () => {
      calls.push("retry");
    });

    await expect(failed).rejects.toThrow("native write failed");
    await expect(retry).resolves.toBeUndefined();
    expect(calls).toEqual(["failed-write", "retry"]);
  });

  it("lets a confirmed resume outrank a stale paused mirror", () => {
    recordSessionGoalMutation(
      "session-resume-lag",
      snapshot("active", "2026-07-17T12:00:01Z", 2),
    );

    expect(sessionCancelGoalFence({
      materializedSessionId: "session-resume-lag",
      mirrorGoal: snapshot("paused", "2026-07-17T12:00:00Z", 1),
      pauseSupported: true,
    })).toEqual({ action: "pause", requirePresentGoalForClear: false });

    forgetSessionGoalIntent("session-resume-lag");
  });

  it("retires active intent when the streamed mirror exactly catches up", () => {
    const confirmed = snapshot("active", "2026-07-17T12:00:01Z", 2);
    recordSessionGoalMutation("session-active-caught-up", confirmed);

    expect(sessionCancelGoalFence({
      materializedSessionId: "session-active-caught-up",
      mirrorGoal: confirmed,
      pauseSupported: false,
    })).toEqual({ action: "clear", requirePresentGoalForClear: false });
  });

  it("uses revision when intent and mirror timestamps share one millisecond", () => {
    recordSessionGoalMutation(
      "session-same-ms-resume",
      snapshot("active", "2026-07-17T12:00:01.000900Z", 2),
    );

    expect(sessionCancelGoalFence({
      materializedSessionId: "session-same-ms-resume",
      mirrorGoal: snapshot("paused", "2026-07-17T12:00:01.000100Z", 1),
      pauseSupported: true,
    })).toEqual({ action: "pause", requirePresentGoalForClear: false });

    forgetSessionGoalIntent("session-same-ms-resume");
  });

  it("fences an active provisional intent over a same-ms paused mirror", () => {
    recordSessionGoalMutation(
      "session-same-ms-provisional",
      snapshot("active", "2026-07-17T12:00:01.000900Z", 0),
    );

    expect(sessionCancelGoalFence({
      materializedSessionId: "session-same-ms-provisional",
      mirrorGoal: snapshot("paused", "2026-07-17T12:00:01.000100Z", 1),
      pauseSupported: true,
    })).toEqual({ action: "pause", requirePresentGoalForClear: false });

    forgetSessionGoalIntent("session-same-ms-provisional");
  });

  it("fences a same-millisecond active replacement whose revision reset", () => {
    recordSessionGoalMutation(
      "session-same-ms-replacement",
      snapshot("paused", "2026-07-17T12:00:01.000100Z", 2, "Old goal"),
    );

    expect(sessionCancelGoalFence({
      materializedSessionId: "session-same-ms-replacement",
      mirrorGoal: snapshot(
        "active",
        "2026-07-17T12:00:01.000900Z",
        1,
        "Remote replacement",
      ),
      pauseSupported: true,
    })).toEqual({ action: "pause", requirePresentGoalForClear: false });

    forgetSessionGoalIntent("session-same-ms-replacement");
  });

  it("lets a demonstrably newer terminal mirror retire an active intent", () => {
    recordSessionGoalMutation(
      "session-terminal",
      snapshot("active", "2026-07-17T12:00:01Z", 2),
    );

    expect(sessionCancelGoalFence({
      materializedSessionId: "session-terminal",
      mirrorGoal: snapshot("met", "2026-07-17T12:00:02Z", 3),
      pauseSupported: true,
    })).toEqual({ action: "none", requirePresentGoalForClear: false });
  });

  it("lets a newer different-objective mirror supersede local stopped intent", () => {
    recordSessionGoalMutation(
      "session-other-renderer",
      snapshot("paused", "2026-07-17T12:00:01Z", 2, "Local goal"),
    );

    expect(sessionCancelGoalFence({
      materializedSessionId: "session-other-renderer",
      mirrorGoal: snapshot("active", "2026-07-17T12:00:02Z", 1, "Remote replacement"),
      pauseSupported: true,
    })).toEqual({ action: "pause", requirePresentGoalForClear: false });
  });

  it("lets a new active mirror supersede a confirmed clear of its predecessor", () => {
    const oldGoal = snapshot("active", "2026-07-17T12:00:01Z", 2, "Old goal");
    recordSessionGoalCleared("session-clear-then-remote", oldGoal);

    expect(sessionCancelGoalFence({
      materializedSessionId: "session-clear-then-remote",
      mirrorGoal: snapshot(
        "active",
        "2026-07-17T12:00:02Z",
        1,
        "New remote goal",
        "2026-07-17T11:30:00Z",
      ),
      pauseSupported: true,
    })).toEqual({ action: "pause", requirePresentGoalForClear: false });
  });

  it("fences blocked goals through pause or clear according to native capability", () => {
    const blocked = snapshot("blocked", "2026-07-17T12:00:01Z", 2);
    expect(sessionCancelGoalFence({
      materializedSessionId: "session-blocked-pause",
      mirrorGoal: blocked,
      pauseSupported: true,
    })).toEqual({ action: "pause", requirePresentGoalForClear: false });
    expect(sessionCancelGoalFence({
      materializedSessionId: "session-blocked-clear",
      mirrorGoal: blocked,
      pauseSupported: false,
    })).toEqual({ action: "clear", requirePresentGoalForClear: false });
  });

  it("preserves a confirmed pause across cancel retry while the mirror lags", () => {
    recordSessionGoalMutation(
      "session-stopped-retry",
      snapshot("paused", "2026-07-17T12:00:02Z", 2),
    );

    expect(sessionCancelGoalFence({
      materializedSessionId: "session-stopped-retry",
      mirrorGoal: snapshot("active", "2026-07-17T12:00:01Z", 1),
      pauseSupported: true,
    })).toEqual({ action: "none", requirePresentGoalForClear: false });

    forgetSessionGoalIntent("session-stopped-retry");
  });

  it("treats an edit after confirmed clear as a fresh budgeted goal despite mirror lag", () => {
    const staleMirror = snapshot("active", "2026-07-17T12:00:00Z", 4, "Old goal");
    recordSessionGoalCleared("session-clear-create", staleMirror);

    expect(buildQueuedGoalObjectiveRequest(
      "session-clear-create",
      "Start a replacement goal",
      staleMirror,
    )).toEqual({
      objective: "Start a replacement goal",
      tokenBudget: DEFAULT_NEW_SESSION_GOAL_TOKEN_BUDGET,
    });

    forgetSessionGoalIntent("session-clear-create");
  });

  it("keeps clear authoritative over a newer stale update from the same goal lifetime", () => {
    const cleared = snapshot("active", "2026-07-17T12:00:00Z", 4, "Old goal");
    recordSessionGoalCleared("session-clear-stale-update", cleared);

    expect(buildQueuedGoalObjectiveRequest(
      "session-clear-stale-update",
      "Replacement goal",
      snapshot("active", "2026-07-17T12:00:01Z", 5, "Old goal"),
    )).toEqual({
      objective: "Replacement goal",
      tokenBudget: DEFAULT_NEW_SESSION_GOAL_TOKEN_BUDGET,
    });

    forgetSessionGoalIntent("session-clear-stale-update");
  });

  it("defaults a post-clear create across provisional and persisted lifetime identities", () => {
    recordSessionGoalMutation(
      "session-clear-provisional",
      snapshot(
        "active",
        "2026-07-17T12:00:01Z",
        0,
        "Deferred goal",
        "2026-07-17T11:00:01Z",
      ),
    );
    recordSessionGoalCleared(
      "session-clear-provisional",
      snapshot(
        "paused",
        "2026-07-17T12:00:00Z",
        4,
        "Old mirror",
        "2026-07-17T11:00:00Z",
      ),
    );
    const eventualDeferredMirror = snapshot(
      "active",
      "2026-07-17T12:00:02Z",
      1,
      "Deferred goal",
      "2026-07-17T11:00:02Z",
    );

    expect(buildQueuedGoalObjectiveRequest(
      "session-clear-provisional",
      "Replacement goal",
      eventualDeferredMirror,
    )).toEqual({
      objective: "Replacement goal",
      tokenBudget: DEFAULT_NEW_SESSION_GOAL_TOKEN_BUDGET,
    });
    expect(sessionCancelGoalFence({
      materializedSessionId: "session-clear-provisional",
      mirrorGoal: eventualDeferredMirror,
      pauseSupported: false,
    })).toEqual({ action: "clear", requirePresentGoalForClear: false });

    forgetSessionGoalIntent("session-clear-provisional");
  });

  it("requires a present clear result only for a newer active UI intent", () => {
    recordSessionGoalMutation(
      "session-deferred-create",
      snapshot("active", "2026-07-17T12:00:01Z", 0),
    );
    const intentFence = sessionCancelGoalFence({
      materializedSessionId: "session-deferred-create",
      mirrorGoal: null,
      pauseSupported: false,
    });
    expect(intentFence).toEqual({ action: "clear", requirePresentGoalForClear: true });
    expect(() => requireSafeGoalClear({ cleared: false }, intentFence))
      .toThrow("has not observed the newer goal mutation");

    const mirrorFence = sessionCancelGoalFence({
      materializedSessionId: "session-mirror-only",
      mirrorGoal: snapshot("active", "2026-07-17T12:00:00Z", 1),
      pauseSupported: false,
    });
    expect(mirrorFence).toEqual({ action: "clear", requirePresentGoalForClear: false });
    expect(() => requireSafeGoalClear({ cleared: false }, mirrorFence)).not.toThrow();

    forgetSessionGoalIntent("session-deferred-create");
  });

  it("rejects a status-only response that did not confirm the requested arm state", () => {
    expect(() => requireGoalArmState({ status: "paused" }, "paused")).not.toThrow();
    expect(() => requireGoalArmState({ status: "active" }, "paused"))
      .toThrow("confirmed active, not paused");
  });

  it("persists a selected goal stop fence before cancelling current work", async () => {
    const calls: string[] = [];

    await expect(stopGoalThenCancelCurrentWork({
      stopGoal: vi.fn(async () => {
        calls.push("stop-goal");
      }),
      cancelCurrentWork: vi.fn(async () => {
        calls.push("cancel-current-work");
      }),
    })).resolves.toBeUndefined();

    expect(calls).toEqual(["stop-goal", "cancel-current-work"]);
  });

  it("does not cancel when the stop fence fails and retries the full safe order", async () => {
    const calls: string[] = [];
    const stopGoal = vi.fn()
      .mockImplementationOnce(async () => {
        calls.push("stop-goal");
        throw new Error("native pause failed");
      })
      .mockImplementationOnce(async () => {
        calls.push("stop-goal");
      });
    const cancelCurrentWork = vi.fn(async () => {
      calls.push("cancel-current-work");
    });

    await expect(stopGoalThenCancelCurrentWork({ stopGoal, cancelCurrentWork }))
      .rejects.toThrow("goal stop could not be confirmed: native pause failed");
    expect(cancelCurrentWork).not.toHaveBeenCalled();

    await expect(stopGoalThenCancelCurrentWork({ stopGoal, cancelCurrentWork }))
      .resolves.toBeUndefined();
    expect(calls).toEqual(["stop-goal", "stop-goal", "cancel-current-work"]);
  });
});

function snapshot(
  status: Goal["status"],
  updatedAt: string,
  revision: number,
  objective = "Finish the task",
  createdAt = "2026-07-17T11:00:00Z",
) {
  return { createdAt, objective, revision, status, updatedAt };
}
