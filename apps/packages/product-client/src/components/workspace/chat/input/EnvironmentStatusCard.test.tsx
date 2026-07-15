// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RuntimePressureTargetState,
} from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { RuntimeEnvironmentControl } from "#product/components/workspace/chat/input/RuntimePressureIndicator";

function actions() {
  return {
    pruneOrphan: vi.fn(),
    purgeWorkspace: vi.fn(),
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
  } as RuntimePressureTargetState;
}

function accessModeControl(): LiveSessionControlDescriptor {
  return {
    key: "mode",
    label: "Permissions",
    detail: "Auto",
    rawConfigId: "mode",
    settable: true,
    pendingState: null,
    kind: "select",
    options: [
      { value: "read-only", label: "Read Only", selected: false },
      { value: "auto", label: "Auto", selected: true },
      { value: "full-access", label: "Full Access", selected: false },
    ],
    onSelect: vi.fn(),
  };
}

function openCard() {
  fireEvent.click(screen.getByRole("button", { name: "Open environment details" }));
}

describe("RuntimeEnvironmentControl", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows advanced controls as sections with codex option labels", () => {
    render(
      <RuntimeEnvironmentControl
        targetState={targetState()}
        actions={actions()}
        advancedControls={[accessModeControl()]}
        agentKind="codex"
      />,
    );
    openCard();

    expect(screen.getByText("Permissions")).toBeTruthy();
    expect(screen.getByText("Read Only")).toBeTruthy();
    expect(screen.getByText("Auto")).toBeTruthy();
    expect(screen.getByText("Full Access")).toBeTruthy();
  });

  it("keeps the card open on advanced option select (multi-adjust)", () => {
    const control = accessModeControl();
    render(
      <RuntimeEnvironmentControl
        targetState={targetState()}
        actions={actions()}
        advancedControls={[control]}
        agentKind={null}
      />,
    );
    openCard();

    fireEvent.click(screen.getByText("Read Only"));
    expect(control.onSelect).toHaveBeenCalledWith("read-only");
    // Surface stays open — same contract the old overflow menu had.
    expect(screen.getByText("Permissions")).toBeTruthy();
  });

  it("renders the trigger for advanced config even with no runtime target", () => {
    render(
      <RuntimeEnvironmentControl
        targetState={null}
        actions={actions()}
        advancedControls={[accessModeControl()]}
        agentKind={null}
      />,
    );
    openCard();
    expect(screen.getByText("Permissions")).toBeTruthy();
    expect(screen.queryByText("Worktrees")).toBeNull();
  });

  it("routes a worktree delete through the confirm dialog to purgeWorkspace", () => {
    const acts = actions();
    render(
      <RuntimeEnvironmentControl
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
              availableActions: ["delete_workspace_history"],
              blockers: [],
              associatedWorkspaces: [
                {
                  id: "ws-1",
                  displayName: "Thread One",
                  branch: "thread/abc",
                  kind: "worktree",
                  lifecycleState: "active",
                  cleanupState: "none",
                  sessionCount: 2,
                },
              ],
              totalSessionCount: 2,
              gitStatus: null,
              storage: {
                worktreeBytes: 33 * 1024 * 1024,
                sqliteBytes: 653 * 1024,
                totalBytes: null,
              },
            },
          ] as RuntimePressureTargetState["inventory"],
        })}
        actions={acts}
        advancedControls={[]}
        agentKind={null}
      />,
    );
    openCard();

    // Card shows the compact summary row; the detail lives in the modal.
    fireEvent.click(screen.getByText("1 worktree"));
    expect(screen.getByText("Thread One")).toBeTruthy();
    expect(screen.getByText("~34 MB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Thread One" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(acts.purgeWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Local runtime" }),
      "ws-1",
    );
  });
});
