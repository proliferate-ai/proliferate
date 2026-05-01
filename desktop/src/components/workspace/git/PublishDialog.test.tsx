// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PublishDialog } from "./PublishDialog";

const mocks = vi.hoisted(() => ({
  workflow: null as ReturnType<typeof buildWorkflow> | null,
}));

vi.mock("@/hooks/workspaces/use-workspace-publish-workflow", () => ({
  useWorkspacePublishWorkflow: () => mocks.workflow!,
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  mocks.workflow = buildWorkflow();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PublishDialog", () => {
  it("does not render a right-panel diff review action", () => {
    render(
      <PublishDialog
        open
        workspaceId="workspace-1"
        initialIntent="publish"
        runtimeBlockedReason={null}
        repoDefaultBranch="main"
        onClose={vi.fn()}
        onViewPr={vi.fn()}
      />,
    );

    expect(screen.queryByText("Review diffs")).toBeNull();
  });
});

function buildWorkflow() {
  return {
    commitDraft: {
      summary: "",
      includeUnstaged: false,
    },
    setCommitDraft: vi.fn(),
    pullRequestDraft: {
      title: "",
      body: "",
      baseBranch: "main",
      draft: false,
    },
    setPullRequestDraft: vi.fn(),
    viewState: {
      branchName: "feature/demo",
      defaultBaseBranch: "main",
      existingPr: null,
      fileGroups: {
        staged: [],
        partial: [],
        unstaged: [],
      },
      hasPartialFiles: false,
      hasStagedChanges: false,
      hasUnstagedChanges: false,
      partialWarning: null,
      publishStatus: "Publish this branch and set its upstream.",
      summary: "Publish this branch and set its upstream.",
      primaryLabel: "Publish branch",
      disabledReason: null,
      workflowSteps: [{ kind: "push" }],
    },
    error: null,
    submit: vi.fn(async () => true),
    isLoading: false,
    isSubmitting: false,
  };
}

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
