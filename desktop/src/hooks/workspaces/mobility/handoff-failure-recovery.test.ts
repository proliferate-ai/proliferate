import { describe, expect, it } from "vitest";
import { deriveHandoffFailureRecovery } from "./handoff-failure-recovery";

describe("deriveHandoffFailureRecovery", () => {
  it("does nothing when a handoff never started", () => {
    expect(deriveHandoffFailureRecovery({
      handoffStarted: false,
      finalized: false,
      cleanupCompleted: false,
    })).toEqual({
      shouldMarkHandoffFailed: false,
      shouldRestoreSourceRuntimeState: false,
      shouldRefreshWorkspaceSelection: false,
    });
  });

  it("marks the handoff failed, restores the source, and refreshes selection before finalize", () => {
    expect(deriveHandoffFailureRecovery({
      handoffStarted: true,
      finalized: false,
      cleanupCompleted: false,
    })).toEqual({
      shouldMarkHandoffFailed: true,
      shouldRestoreSourceRuntimeState: true,
      shouldRefreshWorkspaceSelection: true,
    });
  });

  it("keeps the source remote-owned and refreshes selection after finalize when cleanup did not complete", () => {
    expect(deriveHandoffFailureRecovery({
      handoffStarted: true,
      finalized: true,
      cleanupCompleted: false,
    })).toEqual({
      shouldMarkHandoffFailed: false,
      shouldRestoreSourceRuntimeState: false,
      shouldRefreshWorkspaceSelection: true,
    });
  });

  it("leaves the source alone after cleanup completed", () => {
    expect(deriveHandoffFailureRecovery({
      handoffStarted: true,
      finalized: true,
      cleanupCompleted: true,
    })).toEqual({
      shouldMarkHandoffFailed: false,
      shouldRestoreSourceRuntimeState: false,
      shouldRefreshWorkspaceSelection: false,
    });
  });
});
