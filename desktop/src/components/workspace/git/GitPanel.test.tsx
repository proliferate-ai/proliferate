import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "./GitPanel";

const mockGitPanelState = vi.hoisted(() => vi.fn());

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessRuntimeContext: () => ({
    runtimeUrl: null,
  }),
  useGitDiffQuery: () => ({
    data: null,
    isLoading: false,
  }),
  useStageGitPathsMutation: () => ({
    mutateAsync: vi.fn(),
  }),
  useUnstageGitPathsMutation: () => ({
    mutateAsync: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/files/use-workspace-file-actions", () => ({
  useWorkspaceFileActions: () => ({
    openFile: vi.fn(),
    openFileDiff: vi.fn(),
    openViewerTarget: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-git-panel-state", () => ({
  useGitPanelState: () => mockGitPanelState(),
}));

function createGitPanelState(overrides = {}) {
  const currentDiff = {
    key: ":desktop/src/components/workspace/git/GitPanel.tsx:modified",
    path: "desktop/src/components/workspace/git/GitPanel.tsx",
    oldPath: null,
    displayPath: "desktop/src/components/workspace/git/GitPanel.tsx",
    status: "modified",
    includedState: "excluded",
    additions: 3,
    deletions: 1,
    binary: false,
  };
  return {
    activeWorkspaceId: "workspace-1",
    baseRef: "main",
    branchRefs: [],
    sections: [{
      scope: "unstaged",
      label: "Unstaged",
      files: [{
        ...currentDiff,
        currentDiff,
      }],
    }],
    totalChangedCount: 1,
    visibleChangedCount: 1,
    activeFilterLabel: "Unstaged",
    isRuntimeReady: true,
    runtimeBlockedReason: null,
    isLoading: false,
    errorMessage: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe("GitPanel", () => {
  beforeEach(() => {
    mockGitPanelState.mockReturnValue(createGitPanelState());
  });

  it("renders changed files as right-sidebar diff review cards", () => {
    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("Unstaged");
    expect(html).toContain(">1<");
    expect(html).toContain("Working tree");
    expect(html).toContain("Git review options");
    expect(html).toContain("Show files");
    expect(html).toContain("data-diff-surface=\"sidebar\"");
    expect(html).toContain("No diff available");
    expect(html).toContain("GitPanel.tsx");
  });

  it("renders a compact empty state when there are no changes", () => {
    mockGitPanelState.mockReturnValue(createGitPanelState({
      sections: [],
      totalChangedCount: 0,
      visibleChangedCount: 0,
    }));

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("No unstaged changes");
    expect(html).toContain("Edit files in the workspace and they will appear here.");
    expect(html).toContain("Refresh");
  });

  it("renders last-turn touched files without stage actions when current diff is clean", () => {
    mockGitPanelState.mockReturnValue(createGitPanelState({
      sections: [{
        scope: "last_turn",
        label: "Last turn",
        files: [{
          key: "last-turn:README.md:edit",
          path: "README.md",
          oldPath: null,
          displayPath: "README.md",
          currentDiff: null,
        }],
      }],
      visibleChangedCount: 1,
      activeFilterLabel: "Last turn",
    }));

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("README.md");
    expect(html).toContain("No current diff against base");
    expect(html).not.toContain("Stage README.md");
  });
});
