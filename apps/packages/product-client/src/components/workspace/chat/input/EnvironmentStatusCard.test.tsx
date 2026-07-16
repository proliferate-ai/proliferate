// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RuntimePressureTargetState,
} from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import {
  WorkspaceStatusComposerControl,
  type WorkspaceStatusModel,
} from "#product/components/workspace/chat/input/workspace-status/WorkspaceStatusComposerControl";

function statusModel(): WorkspaceStatusModel {
  return {
    environment: null,
    subagents: { working: [], done: [] },
    native: [],
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
  fireEvent.click(screen.getByRole("button", { name: "Workspace status" }));
}

describe("WorkspaceStatusComposerControl (resources + advanced)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows advanced controls as sections with codex option labels", () => {
    render(
      <WorkspaceStatusComposerControl
        model={statusModel()}
        environmentState={targetState()}
        onOpenWorktrees={vi.fn()}
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
      <WorkspaceStatusComposerControl
        model={statusModel()}
        advancedControls={[control]}
      />,
    );
    openCard();

    fireEvent.click(screen.getByText("Read Only"));
    expect(control.onSelect).toHaveBeenCalledWith("read-only");
    // Surface stays open — same contract the old overflow menu had.
    expect(screen.getByText("Permissions")).toBeTruthy();
  });

  it("shows the worktrees summary in Resources and opens the modal on click", () => {
    const onOpenWorktrees = vi.fn();
    render(
      <WorkspaceStatusComposerControl
        model={statusModel()}
        environmentState={targetState({
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
          ] as RuntimePressureTargetState["inventory"],
        })}
        onOpenWorktrees={onOpenWorktrees}
      />,
    );
    openCard();

    expect(screen.getByText("Resources")).toBeTruthy();
    expect(screen.getByText("5 of 20")).toBeTruthy();
    expect(screen.getByText("~34 MB")).toBeTruthy();

    fireEvent.click(screen.getByText("1 worktree"));
    expect(onOpenWorktrees).toHaveBeenCalledTimes(1);
  });
});
