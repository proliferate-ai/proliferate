// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { CurrentPullRequestResponse, GitChangedFile } from "@anyharness/sdk";
import type { PublishIntent } from "@/lib/domain/workspaces/creation/publish-workflow-model";
import { PublishDialog } from "./PublishDialog";

const mocks = vi.hoisted(() => ({
  workflow: null as ReturnType<typeof buildWorkflow> | null,
  useWorkflow: vi.fn(),
}));

vi.mock("@/hooks/workspaces/workflows/use-workspace-publish-workflow", () => ({
  useWorkspacePublishWorkflow: (options: unknown) => {
    mocks.useWorkflow(options);
    return mocks.workflow!;
  },
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  mocks.workflow = buildWorkflow();
  mocks.useWorkflow.mockClear();
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
        onIntentChange={vi.fn()}
        onViewPr={vi.fn()}
      />,
    );

    expect(screen.queryByText("Review diffs")).toBeNull();
  });

  it("keeps dirty pull request creation compact and surfaces validation", () => {
    const workflow = buildWorkflow();
    mocks.workflow = {
      ...workflow,
      viewState: {
        ...workflow.viewState,
        fileGroups: {
          staged: [],
          partial: [],
          unstaged: [changedFile("src/app.ts")],
        },
        hasUnstagedChanges: true,
        disabledReason: "Stage changes or include unstaged changes before committing.",
        primaryLabel: "Commit, publish, create PR",
      },
    };

    render(
      <PublishDialog
        open
        workspaceId="workspace-1"
        initialIntent="pull_request"
        runtimeBlockedReason={null}
        repoDefaultBranch="main"
        onClose={vi.fn()}
        onIntentChange={vi.fn()}
        onViewPr={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Create pull request" })).toBeTruthy();
    expect(screen.getByText("1 change · 1 unstaged")).toBeTruthy();
    expect(screen.queryByText("src/app.ts")).toBeNull();
    expect(screen.getByText("Stage changes or include unstaged changes before committing."))
      .toBeTruthy();
    expect((screen.getByRole("button", {
      name: "Commit, publish, create PR",
    }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps an existing pull request viewable when Git updates are blocked", () => {
    const workflow = buildWorkflow();
    mocks.workflow = {
      ...workflow,
      viewState: {
        ...workflow.viewState,
        existingPr: existingPullRequest(),
        disabledReason: "Sync this branch before publishing.",
        primaryLabel: "View pull request",
        workflowSteps: [],
      },
    };

    render(
      <PublishDialog
        open
        workspaceId="workspace-1"
        initialIntent="pull_request"
        runtimeBlockedReason={null}
        repoDefaultBranch="main"
        onClose={vi.fn()}
        onIntentChange={vi.fn()}
        onViewPr={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Pull request" })).toBeTruthy();
    expect((screen.getByRole("button", {
      name: "View pull request",
    }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Sync this branch before publishing.")).toBeNull();
  });

  it("does not turn a blocked commit into an existing pull request action", () => {
    const workflow = buildWorkflow();
    mocks.workflow = {
      ...workflow,
      viewState: {
        ...workflow.viewState,
        existingPr: existingPullRequest(),
        disabledReason: "There are no changes to commit.",
        primaryLabel: "Commit",
        workflowSteps: [],
      },
    };

    render(
      <PublishDialog
        open
        workspaceId="workspace-1"
        initialIntent="commit"
        runtimeBlockedReason={null}
        repoDefaultBranch="main"
        onClose={vi.fn()}
        onIntentChange={vi.fn()}
        onViewPr={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Commit" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("switches source control intent without closing the dialog", () => {
    render(<SwitchingDialogHarness />);

    expect(screen.getByRole("dialog", { name: "Commit changes" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Commit" }).getAttribute("aria-checked"))
      .toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Publish" }));
    expect(screen.getByRole("dialog", { name: "Publish branch" })).toBeTruthy();
    expect(mocks.workflow?.clearError).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
    expect(screen.getByRole("dialog", { name: "Create pull request" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Pull request title")).toBeTruthy();
    expect(mocks.workflow?.clearError).toHaveBeenCalledTimes(2);
    expect(mocks.useWorkflow).toHaveBeenLastCalledWith(expect.objectContaining({
      initialIntent: "pull_request",
    }));
  });

  it("clears drafts when the modal closes", () => {
    const onClose = vi.fn();
    render(
      <PublishDialog
        open
        workspaceId="workspace-1"
        initialIntent="commit"
        runtimeBlockedReason={null}
        repoDefaultBranch="main"
        onClose={onClose}
        onIntentChange={vi.fn()}
        onViewPr={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.workflow?.resetDrafts).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks intent switching while a workflow is running", () => {
    mocks.workflow = {
      ...buildWorkflow(),
      isSubmitting: true,
    };
    render(
      <PublishDialog
        open
        workspaceId="workspace-1"
        initialIntent="publish"
        runtimeBlockedReason={null}
        repoDefaultBranch="main"
        onClose={vi.fn()}
        onIntentChange={vi.fn()}
        onViewPr={vi.fn()}
      />,
    );

    for (const option of screen.getAllByRole("radio")) {
      expect((option as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

function SwitchingDialogHarness() {
  const [intent, setIntent] = useState<PublishIntent>("commit");
  return (
    <PublishDialog
      open
      workspaceId="workspace-1"
      initialIntent={intent}
      runtimeBlockedReason={null}
      repoDefaultBranch="main"
      onClose={vi.fn()}
      onIntentChange={setIntent}
      onViewPr={vi.fn()}
    />
  );
}

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
      existingPr: null as NonNullable<CurrentPullRequestResponse["pullRequest"]> | null,
      fileGroups: {
        staged: [] as GitChangedFile[],
        partial: [] as GitChangedFile[],
        unstaged: [] as GitChangedFile[],
      },
      hasPartialFiles: false,
      hasStagedChanges: false,
      hasUnstagedChanges: false,
      partialWarning: null,
      publishStatus: "Publish this branch and set its upstream.",
      summary: "Publish this branch and set its upstream.",
      primaryLabel: "Publish branch",
      disabledReason: null as string | null,
      workflowSteps: [{ kind: "push" }],
    },
    error: null,
    submit: vi.fn(async () => true),
    clearError: vi.fn(),
    resetDrafts: vi.fn(),
    isLoading: false,
    isSubmitting: false,
  };
}

function changedFile(path: string): GitChangedFile {
  return {
    path,
    oldPath: undefined,
    status: "modified",
    additions: 4,
    deletions: 2,
    binary: false,
    includedState: "excluded",
  };
}

function existingPullRequest(): NonNullable<CurrentPullRequestResponse["pullRequest"]> {
  return {
    title: "Existing PR",
    url: "https://github.test/pr/42",
    state: "open",
    number: 42,
    headBranch: "feature/demo",
    baseBranch: "main",
    draft: false,
  };
}

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
