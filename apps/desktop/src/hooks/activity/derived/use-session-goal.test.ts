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

function seedGoalBarStore(composing: boolean, dismissedResultKey: string | null) {
  useGoalBarStore.setState({
    composingBySessionId: composing ? { "test-session-id": true } : {},
    dismissedResultKeyBySessionId: dismissedResultKey
      ? { "test-session-id": dismissedResultKey }
      : {},
    beginComposing: vi.fn(),
    endComposing: vi.fn(),
    dismissResult: vi.fn(),
  });
}

describe("useSessionGoalBarModel", () => {
  beforeEach(() => {
    // Reset stores between tests
    useSessionDirectoryStore.setState({ entriesById: {} });
    useGoalBarStore.setState({
      composingBySessionId: {},
      dismissedResultKeyBySessionId: {},
      beginComposing: vi.fn(),
      endComposing: vi.fn(),
      dismissResult: vi.fn(),
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
  });
});
