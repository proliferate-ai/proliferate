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
    const { container } = render(
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
    expect(container.querySelector("[data-workspace-status-trigger]")).toBeTruthy();
    expect(document.querySelector('[data-session-advanced-option="mode:read-only"]'))
      .toBeTruthy();
    expect(document.querySelector('[data-session-advanced-selected="auto"]'))
      .toBeTruthy();
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

  it("shows CPU, Memory, and Disk rows for a cloud runtime with disk telemetry", () => {
    render(
      <WorkspaceStatusComposerControl
        model={statusModel()}
        environmentState={targetState({
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
            pressurePercent: 63,
            cpu: {
              normalizedPercent: 24,
              loadAverage1m: 0.96,
              logicalCoreCount: 4,
              idealMaxPercent: 80,
            },
            memory: {
              percent: 42,
              availableBytes: 9 * 1024 ** 3,
              totalBytes: 16 * 1024 ** 3,
              usedBytes: 7 * 1024 ** 3,
              idealMaxPercent: 80,
            },
            disk: {
              percent: 63,
              availableBytes: 37 * 1024 ** 3,
              totalBytes: 100 * 1024 ** 3,
              usedBytes: 63 * 1024 ** 3,
              idealMaxPercent: 80,
            },
          },
        })}
        onOpenWorktrees={vi.fn()}
      />,
    );
    openCard();

    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByText("24%")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("Disk")).toBeTruthy();
    expect(screen.getByText("63%")).toBeTruthy();
  });
});
