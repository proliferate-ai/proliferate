// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RunWorktreeRetentionResponse } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreesPane } from "./WorktreesPane";

const worktreeSettingsMocks = vi.hoisted(() => ({
  pruneOrphan: vi.fn(),
  pruneWorkspaceCheckout: vi.fn(),
  purgeWorkspace: vi.fn(),
  retryPurge: vi.fn(),
  runRetention: vi.fn(),
  updatePolicy: vi.fn(),
}));

const toastStoreMocks = vi.hoisted(() => ({
  show: vi.fn(),
}));

vi.mock("@/hooks/workspaces/use-worktree-settings-targets", () => ({
  useWorktreeSettingsTargets: () => ({
    isDiscovering: false,
    targets: [{
      error: null,
      inventory: { rows: [] },
      isLoading: false,
      policy: {
        maxMaterializedWorktreesPerRepo: 20,
        updatedAt: "2026-05-03T00:00:00Z",
      },
      target: {
        key: "local:http://localhost:4444:generation:0",
        label: "Local runtime",
        location: "local",
        runtimeGeneration: 0,
        runtimeUrl: "http://localhost:4444",
      },
    }],
    ...worktreeSettingsMocks,
  }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: typeof toastStoreMocks.show }) => unknown) =>
    selector({ show: toastStoreMocks.show }),
}));

beforeEach(() => {
  worktreeSettingsMocks.runRetention.mockResolvedValue(retentionResponse({
    attemptedCount: 2,
    consideredCount: 2,
    moreEligibleRemaining: true,
    retiredCount: 2,
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorktreesPane cleanup feedback", () => {
  it("uses the retention run result instead of the static success message", async () => {
    render(<WorktreesPane />);

    fireEvent.click(screen.getByRole("button", { name: "Run cleanup" }));

    await waitFor(() => {
      expect(toastStoreMocks.show).toHaveBeenCalledWith(
        "Retired 2 checkouts. Run cleanup again to continue.",
      );
    });
    expect(toastStoreMocks.show).not.toHaveBeenCalledWith("Worktree cleanup finished.");
  });
});

function retentionResponse(
  overrides: Partial<RunWorktreeRetentionResponse>,
): RunWorktreeRetentionResponse {
  return {
    alreadyRunning: false,
    attemptedCount: 0,
    blockedCount: 0,
    consideredCount: 0,
    failedCount: 0,
    moreEligibleRemaining: false,
    policy: {
      maxMaterializedWorktreesPerRepo: 20,
      updatedAt: "2026-05-03T00:00:00Z",
    },
    retiredCount: 0,
    rows: [],
    skippedCount: 0,
    ...overrides,
  };
}
