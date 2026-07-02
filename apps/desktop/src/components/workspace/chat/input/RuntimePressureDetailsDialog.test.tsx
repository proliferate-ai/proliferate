// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RuntimePressureTargetState,
  useRuntimePressureControlState,
} from "@/hooks/workspaces/facade/use-runtime-pressure-control-state";
import { RuntimePressureDetailsDialog } from "./RuntimePressureDetailsDialog";

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
    expect(screen.getAllByText("Local runtime · proliferate — 5 of 20 worktrees").length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("Cloud sandbox — CPU 42% · RAM 31%").length).toBeGreaterThan(0);
  });

  it("keeps the tilde on the footer storage totals only", () => {
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

    expect(screen.getByText("~33 MB checkout + ~653 KB logs")).not.toBeNull();
    expect(screen.getByText("33 MB")).not.toBeNull();
    expect(screen.queryByText("~33 MB")).toBeNull();
  });
});
