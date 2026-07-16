// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RuntimePressureTargetState,
  useRuntimePressureControlState,
} from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import { RuntimePressureDetailsDialog } from "#product/components/workspace/chat/input/RuntimePressureDetailsDialog";

type Actions = ReturnType<typeof useRuntimePressureControlState>["actions"];

function actions(): Actions {
  return {
    runCleanup: vi.fn(),
    pruneOrphan: vi.fn(),
    pruneWorkspace: vi.fn(),
    purgeWorkspace: vi.fn(),
    retryPurge: vi.fn(),
  };
}

function targetState(
  overrides: Partial<RuntimePressureTargetState> = {},
): RuntimePressureTargetState {
  return {
    target: {
      key: "local:http://127.0.0.1:8457",
      label: "Local runtime",
      location: "local",
      runtimeUrl: "http://127.0.0.1:8457",
      runtimeGeneration: 0,
      environmentId: null,
    },
    inventory: [],
    isLoading: false,
    error: null,
    inventoryLoading: false,
    inventoryError: null,
    healthLoading: false,
    healthError: null,
    worktreeCount: 5,
    totalWorktreeCount: 5,
    pressureRepoLabel: "proliferate",
    idealWorktreeCount: 20,
    pressurePercent: 25,
    pressureLimitPercent: 100,
    ringProgressPercent: 25,
    pressureLabel: "5 of 20",
    detailLines: [],
    tone: "success",
    resourcePressure: null,
    ...overrides,
  };
}

describe("RuntimePressureDetailsDialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("titles itself Worktrees for the local entry point", () => {
    render(
      <RuntimePressureDetailsDialog
        open
        targetState={targetState()}
        actions={actions()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("heading", { name: "Worktrees" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Pruning" })).toBeNull();
    // Card-anatomy body: the Worktrees section carries the "N of M" detail.
    expect(screen.getAllByText("5 of 20").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Local runtime").length).toBeGreaterThan(0);
  });

  it("titles itself Worktrees and keeps cloud phrasing in the summary", () => {
    render(
      <RuntimePressureDetailsDialog
        open
        targetState={targetState({
          target: {
            key: "cloud:env-1",
            label: "Cloud sandbox",
            location: "cloud",
            runtimeUrl: "https://cloud.example",
            runtimeGeneration: null,
            environmentId: "env-1",
          },
          resourcePressure: {
            collectedAt: "2026-07-01T00:00:00Z",
            level: "nominal",
            pressurePercent: 42,
            cpu: {
              normalizedPercent: 42,
              loadAverage1m: 3.4,
              logicalCoreCount: 8,
              idealMaxPercent: 80,
            },
            memory: {
              percent: 31,
              availableBytes: 8 * 1024 ** 3,
              totalBytes: 16 * 1024 ** 3,
              usedBytes: 8 * 1024 ** 3,
              idealMaxPercent: 80,
            },
          },
        })}
        actions={actions()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("heading", { name: "Worktrees" }).length).toBeGreaterThan(0);
    // Cloud pressure renders as CPU / Memory rows in the runtime section.
    expect(screen.getAllByText("Cloud sandbox").length).toBeGreaterThan(0);
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getByText("31%")).toBeTruthy();
  });

  it("renders one card row per checkout with a compact estimated size", () => {
    render(
      <RuntimePressureDetailsDialog
        open
        targetState={targetState({
          inventory: [
            {
              id: "wt-1",
              path: "/Users/dev/.proliferate/worktrees/proliferate/thread-1",
              branch: "thread/abc",
              repoRootId: "repo-root",
              repoRootName: "proliferate",
              state: "associated",
              managed: true,
              materialized: true,
              availableActions: [],
              blockers: [],
              associatedWorkspaces: [],
              totalSessionCount: 0,
              gitStatus: null,
              storage: {
                worktreeBytes: 33 * 1024 * 1024,
                sqliteBytes: 653 * 1024,
                totalBytes: null,
              },
            },
          ],
        })}
        actions={actions()}
        onClose={vi.fn()}
      />,
    );

    // One row per checkout: name + compact ~total (checkout + logs summed).
    expect(screen.getByText("thread/abc")).not.toBeNull();
    expect(screen.getByText("~34 MB")).not.toBeNull();
  });
});
