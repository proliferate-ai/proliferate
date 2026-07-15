// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  goalResultDismissKey,
  useGoalBarStore,
} from "@/stores/activity/goal-bar-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionGoalBarModel } from "./use-session-goal";

vi.mock("@/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => "test-session-id",
}));

function seedSessionDirectory(activeGoal: any) {
  useSessionDirectoryStore.setState({
    entriesById: {
      "test-session-id": {
        activeGoal,
        actionCapabilities: { supportsGoals: true, supportsLoops: true, loopsNative: true },
        agentKind: "claude",
      } as any,
    },
  });
}

function seedGoalBarStore(
  composing: boolean,
  dismissedResultKey: string | null,
  pendingGoal: { objective: string; submittedAtMs: number } | null = null,
) {
  useGoalBarStore.setState({
    composingBySessionId: composing ? { "test-session-id": true } : {},
    dismissedResultKeyBySessionId: dismissedResultKey
      ? { "test-session-id": dismissedResultKey }
      : {},
    pendingGoalBySessionId: pendingGoal
      ? { "test-session-id": pendingGoal }
      : {},
    beginComposing: vi.fn(),
    endComposing: vi.fn(),
    dismissResult: vi.fn(),
    setPendingGoal: vi.fn(),
    clearPendingGoal: vi.fn(),
  });
}

describe("useSessionGoalBarModel", () => {
  beforeEach(() => {
    // Reset stores between tests
    useSessionDirectoryStore.setState({ entriesById: {} });
    useGoalBarStore.setState({
      composingBySessionId: {},
      dismissedResultKeyBySessionId: {},
      pendingGoalBySessionId: {},
      beginComposing: vi.fn(),
      endComposing: vi.fn(),
      dismissResult: vi.fn(),
      setPendingGoal: vi.fn(),
      clearPendingGoal: vi.fn(),
    });
  });

  it("returns null when session has no goal and not composing", () => {
    seedSessionDirectory(null);
    seedGoalBarStore(false, null);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).toBeNull();
  });

  it("returns model when composing with no existing goal", () => {
    seedSessionDirectory(null);
    seedGoalBarStore(true, null);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.composing).toBe(true);
    expect(result.current?.goal).toBeNull();
    expect(result.current?.provisional).toBe(false);
  });

  it("returns model for live goal", () => {
    const liveGoal = {
      objective: "Test objective",
      status: "active",
      updatedAt: new Date(1000).toISOString(),
    };
    seedSessionDirectory(liveGoal);
    seedGoalBarStore(false, null);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.goal?.status).toBe("active");
    expect(result.current?.composing).toBe(false);
    expect(result.current?.provisional).toBe(false);
  });

  it("returns model for terminal goal result when not dismissed", () => {
    const failedGoal = {
      objective: "Failed objective",
      status: "failed",
      updatedAt: new Date(2000).toISOString(),
      reason: "Task failed",
    };
    seedSessionDirectory(failedGoal);
    seedGoalBarStore(false, null);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.goal?.status).toBe("failed");
  });

  it("returns null for dismissed terminal goal result when not composing", () => {
    const failedGoal = {
      objective: "Failed objective",
      status: "failed",
      updatedAt: new Date(2000).toISOString(),
      reason: "Task failed",
    };
    const dismissKey = goalResultDismissKey("failed", 2000);
    seedSessionDirectory(failedGoal);
    seedGoalBarStore(false, dismissKey);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).toBeNull();
  });

  it("returns model for dismissed terminal goal when composing (FIX FOR BUG)", () => {
    // This is the key test case for the bug fix: a claude session with a
    // dismissed terminal goal should still show the blank editor when the
    // user clicks "Set goal" (which sets composing=true).
    const failedGoal = {
      objective: "Previous failed objective",
      status: "failed",
      updatedAt: new Date(3000).toISOString(),
      reason: "Task failed",
    };
    const dismissKey = goalResultDismissKey("failed", 3000);
    seedSessionDirectory(failedGoal);
    seedGoalBarStore(true, dismissKey);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.composing).toBe(true);
    expect(result.current?.goal?.status).toBe("failed");
  });

  it("returns model for dismissed met goal when composing", () => {
    const metGoal = {
      objective: "Previous met objective",
      status: "met",
      updatedAt: new Date(4000).toISOString(),
      reason: "Goal achieved",
    };
    const dismissKey = goalResultDismissKey("met", 4000);
    seedSessionDirectory(metGoal);
    seedGoalBarStore(true, dismissKey);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.composing).toBe(true);
  });

  it("returns model for dismissed blocked goal when composing", () => {
    const blockedGoal = {
      objective: "Previous blocked objective",
      status: "blocked",
      updatedAt: new Date(5000).toISOString(),
      reason: "Cannot proceed",
    };
    const dismissKey = goalResultDismissKey("blocked", 5000);
    seedSessionDirectory(blockedGoal);
    seedGoalBarStore(true, dismissKey);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.composing).toBe(true);
  });

  it("returns null when different result was dismissed (updatedAt changed)", () => {
    const newGoal = {
      objective: "New goal after retry",
      status: "failed",
      updatedAt: new Date(7000).toISOString(),
      reason: "Failed again",
    };
    const oldDismissKey = goalResultDismissKey("failed", 6000);
    seedSessionDirectory(newGoal);
    seedGoalBarStore(false, oldDismissKey);

    const { result } = renderHook(() => useSessionGoalBarModel());
    // The dismissed key doesn't match the current goal, so result should show
    expect(result.current).not.toBeNull();
    expect(result.current?.goal?.status).toBe("failed");
  });

  it("allows composing even when live goal exists (though UI wouldn't offer this)", () => {
    // Edge case: the UI doesn't show "Set goal" button when a goal is live,
    // but the model should handle it gracefully if it happens.
    const liveGoal = {
      objective: "Active objective",
      status: "active",
      updatedAt: new Date(8000).toISOString(),
    };
    seedSessionDirectory(liveGoal);
    seedGoalBarStore(true, null);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.composing).toBe(true);
    expect(result.current?.goal?.status).toBe("active");
    expect(result.current?.provisional).toBe(false);
  });

  it("returns provisional live model when pending goal exists and mirror is empty", () => {
    seedSessionDirectory(null);
    seedGoalBarStore(false, null, { objective: "Build the feature", submittedAtMs: 9000 });

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.provisional).toBe(true);
    expect(result.current?.goal?.objective).toBe("Build the feature");
    expect(result.current?.goal?.status).toBe("active");
    expect(result.current?.goal?.nativeStatus).toBe("pending_injection");
    expect(result.current?.composing).toBe(false);
  });

  it("mirror live goal supersedes pending entry (lazy-ignore)", () => {
    const liveGoal = {
      objective: "Build the feature",
      status: "active",
      updatedAt: new Date(10000).toISOString(),
    };
    seedSessionDirectory(liveGoal);
    // Pending entry still present from a previous submit — should be ignored.
    seedGoalBarStore(false, null, { objective: "Build the feature", submittedAtMs: 9000 });

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.provisional).toBe(false);
    expect(result.current?.goal?.status).toBe("active");
  });

  it("pending goal shows provisional model even with dismissed result in mirror", () => {
    const failedGoal = {
      objective: "Old failed goal",
      status: "failed",
      updatedAt: new Date(11000).toISOString(),
      reason: "Gave up",
    };
    const dismissKey = goalResultDismissKey("failed", 11000);
    seedSessionDirectory(failedGoal);
    seedGoalBarStore(false, dismissKey, { objective: "New attempt", submittedAtMs: 12000 });

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).not.toBeNull();
    expect(result.current?.provisional).toBe(true);
    expect(result.current?.goal?.objective).toBe("New attempt");
  });

  it("no pending entry and no live goal returns null (cancel-compose scenario)", () => {
    seedSessionDirectory(null);
    seedGoalBarStore(false, null, null);

    const { result } = renderHook(() => useSessionGoalBarModel());
    expect(result.current).toBeNull();
  });
});
