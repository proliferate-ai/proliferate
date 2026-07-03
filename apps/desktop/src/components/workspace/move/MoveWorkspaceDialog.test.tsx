// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MoveWorkspaceDialog } from "./MoveWorkspaceDialog";

const mocks = vi.hoisted(() => ({
  workflow: null as ReturnType<typeof buildWorkflow> | null,
  selectWorkspaceFromSurface: vi.fn(),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-move-workflow", () => ({
  useWorkspaceMoveWorkflow: () => mocks.workflow!,
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    selectWorkspaceFromSurface: mocks.selectWorkspaceFromSurface,
  }),
}));

beforeEach(() => {
  mocks.selectWorkspaceFromSurface.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("MoveWorkspaceDialog", () => {
  it("shows the safe-move confirmation and calls startMove", () => {
    mocks.workflow = buildWorkflow({
      stage: {
        kind: "readiness",
        readiness: {
          kind: "safe",
          copy: {
            headline: "Ready to move",
            body: "This workspace is clean and published.",
            primaryActionLabel: "Move to cloud",
          },
        },
      },
    });

    render(<MoveWorkspaceDialog open workspaceId="ws-1" workspaceKind="worktree" repoRoot={null} onClose={vi.fn()} />);

    expect(screen.getByText("Ready to move")).toBeTruthy();
    fireEvent.click(screen.getByText("Move to cloud"));
    expect(mocks.workflow!.startMove).toHaveBeenCalledTimes(1);
  });

  it("shows commit controls and disables the primary action until publish is ready", () => {
    mocks.workflow = buildWorkflow({
      stage: {
        kind: "readiness",
        readiness: {
          kind: "prepare_required",
          copy: {
            headline: "Commit and push before moving",
            body: "This workspace has uncommitted changes.",
            primaryActionLabel: "Commit, push, and move",
          },
          includeUnstagedDefault: true,
        },
      },
      publish: buildPublish({ disabledReason: "Enter a commit message." }),
    });

    render(<MoveWorkspaceDialog open workspaceId="ws-1" workspaceKind="worktree" repoRoot={null} onClose={vi.fn()} />);

    expect(screen.getByLabelText("Commit message")).toBeTruthy();
    const button = screen.getByText("Commit, push, and move").closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("offers resume/abandon when a pre-cutover move is already in progress", () => {
    mocks.workflow = buildWorkflow({
      stage: {
        kind: "resume",
        move: { id: "move-1", phase: "destination_ready" } as never,
        postCutover: false,
      },
    });

    render(<MoveWorkspaceDialog open workspaceId="ws-1" workspaceKind="worktree" repoRoot={null} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Resume move"));
    expect(mocks.workflow!.resumeMove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Abandon move"));
    expect(mocks.workflow!.abandonMove).toHaveBeenCalledTimes(1);
  });

  it("offers open-vs-replace on a cloud_workspace_exists collision", () => {
    mocks.workflow = buildWorkflow({
      stage: {
        kind: "collision",
        gitOwner: "acme",
        gitRepoName: "widgets",
        branch: "feature/move",
        collidingWorkspaceId: "cloud-ws-1",
      },
    });

    render(<MoveWorkspaceDialog open workspaceId="ws-1" workspaceKind="worktree" repoRoot={null} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Open the cloud workspace"));
    expect(mocks.selectWorkspaceFromSurface).toHaveBeenCalledWith("cloud:cloud-ws-1", "workspace-move-dialog");

    fireEvent.click(screen.getByText("Replace it with this local copy"));
    expect(mocks.workflow!.replaceCollidingWorkspace).toHaveBeenCalledWith("cloud-ws-1");
  });

  it("renders the four-step progress list while the saga is running", () => {
    mocks.workflow = buildWorkflow({
      stage: { kind: "progress", phase: "destination_ready" },
    });

    render(<MoveWorkspaceDialog open workspaceId="ws-1" workspaceKind="worktree" repoRoot={null} onClose={vi.fn()} />);

    expect(screen.getByText("Prepare")).toBeTruthy();
    expect(screen.getByText("Transfer sessions")).toBeTruthy();
    expect(screen.getByText("Switch over")).toBeTruthy();
    expect(screen.getByText("Clean up")).toBeTruthy();
  });
});

interface PublishViewStateOverrides {
  disabledReason?: string | null;
  hasStagedChanges?: boolean;
  hasUnstagedChanges?: boolean;
}

function buildPublish(overrides: PublishViewStateOverrides = {}) {
  return {
    commitDraft: { summary: "", includeUnstaged: false },
    setCommitDraft: vi.fn(),
    viewState: {
      fileGroups: { staged: [], partial: [], unstaged: [] },
      hasStagedChanges: true,
      hasUnstagedChanges: false,
      disabledReason: null,
      ...overrides,
    },
    error: null,
    submit: vi.fn(async () => true),
    isLoading: false,
    isSubmitting: false,
  };
}

function buildWorkflow(overrides: {
  stage: unknown;
  publish?: ReturnType<typeof buildPublish>;
}) {
  return {
    stage: overrides.stage,
    readiness: (overrides.stage as { readiness?: unknown }).readiness ?? { kind: "blocked", copy: { headline: "", body: "", primaryActionLabel: "" }, blockerCode: "status_loading" },
    publish: overrides.publish ?? buildPublish(),
    error: null,
    isLoading: false,
    isSubmitting: false,
    startMove: vi.fn(),
    resumeMove: vi.fn(),
    abandonMove: vi.fn(),
    replaceCollidingWorkspace: vi.fn(),
    reset: vi.fn(),
  };
}
