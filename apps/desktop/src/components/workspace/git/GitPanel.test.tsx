import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "./GitPanel";
import { GitPanelHeader } from "./GitPanelHeader";
import { GitReviewTargetSelector } from "./GitReviewTargetSelector";

const mockGitPanelState = vi.hoisted(() => vi.fn());
const gitDiffQuery = vi.hoisted(() => ({
  calls: [] as unknown[],
  state: {
    data: null as unknown,
    error: null as unknown,
    isError: false,
    isLoading: false,
  },
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessRuntimeContext: () => ({
    runtimeUrl: null,
  }),
  useGitDiffQuery: (options: unknown) => {
    gitDiffQuery.calls.push(options);
    return gitDiffQuery.state;
  },
  useStageGitPathsMutation: () => ({
    mutateAsync: vi.fn(),
  }),
  useUnstageGitPathsMutation: () => ({
    mutateAsync: vi.fn(),
  }),
  useRevertGitPatchesMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/hooks/workspaces/facade/files/use-workspace-file-actions", () => ({
  useWorkspaceFileActions: () => ({
    openFile: vi.fn(),
    openFileDiff: vi.fn(),
    openViewerTarget: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/derived/files/use-workspace-file-context", () => ({
  useWorkspaceFileContext: () => ({
    workspaceUiKey: "workspace-1",
    materializedWorkspaceId: "workspace-1",
    treeStateKey: "workspace-1",
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-git-panel-state", () => ({
  useGitPanelState: () => mockGitPanelState(),
}));

function createGitPanelState(overrides = {}) {
  const currentDiff = {
    key: ":apps/desktop/src/components/workspace/git/GitPanel.tsx:modified",
    path: "apps/desktop/src/components/workspace/git/GitPanel.tsx",
    oldPath: null,
    displayPath: "apps/desktop/src/components/workspace/git/GitPanel.tsx",
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
    gitDiffQuery.calls = [];
    gitDiffQuery.state = {
      data: {
        patch: [
          "@@ -1,2 +1,2 @@",
          "-old line",
          "+new line",
        ].join("\n"),
        additions: 1,
        deletions: 1,
        binary: false,
        truncated: false,
      },
      error: null,
      isError: false,
      isLoading: false,
    };
  });

  it("renders changed files as right-sidebar diff review cards", () => {
    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("Unstaged");
    expect(html).toContain(">1<");
    expect(html).not.toContain("Working tree");
    expect(html).toContain("Git review options");
    expect(html).toContain("Show files");
    expect(html).toContain("data-diff-surface=\"sidebar\"");
    expect(html).toContain("codex-review-diff-card");
    expect(html).toContain("data-review-path=\"apps/desktop/src/components/workspace/git/GitPanel.tsx\"");
    expect(html).toContain("id=\"review-diffs-collapsed\"");
    expect(html).toContain("data-app-action-review-scroll=\"\"");
    expect(html).toContain("data-thread-find-target=\"review\"");
    expect(html).toContain("data-app-action-review-metrics-probe=\"\"");
    expect(html).toContain("[container-name:review-header]");
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("min-h-10");
    expect(html).toContain("px-2 pb-3");
    expect(html).toContain("pt-2");
    expect(html).not.toContain("No diff available");
    expect(html).toContain("GitPanel.tsx");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("new line");
    expect(gitDiffQuery.calls[0]).toMatchObject({
      path: "apps/desktop/src/components/workspace/git/GitPanel.tsx",
      enabled: false,
    });
  });

  it("shows the branch target selector only in branch review mode", () => {
    const baseProps = {
      visibleChangedCount: 1,
      additions: 1,
      deletions: 1,
      isRuntimeReady: true,
      branchRefs: [{ name: "origin/main", isDefault: true, isHead: false, isRemote: true, upstream: null }],
      baseRef: "origin/main",
      layout: "unified" as const,
      wrapLongLines: true,
      fileTreeOpen: false,
      allFilesCollapsed: false,
      reviewEntries: [],
      onFilterChange: vi.fn(),
      onBaseRefChange: vi.fn(),
      onToggleLayout: vi.fn(),
      onToggleWrap: vi.fn(),
      onToggleFileTree: vi.fn(),
      onToggleAllFiles: vi.fn(),
      onFocusFile: vi.fn(),
      onRefresh: vi.fn(),
    };

    const unstagedHtml = renderToStaticMarkup(
      createElement(GitPanelHeader, {
        ...baseProps,
        changesFilter: "unstaged",
      }),
    );
    const branchHtml = renderToStaticMarkup(
      createElement(GitPanelHeader, {
        ...baseProps,
        changesFilter: "branch",
      }),
    );

    expect(unstagedHtml).not.toContain("origin/main");
    expect(unstagedHtml).toContain("min-h-10");
    expect(branchHtml).toContain("origin/main");
    expect(branchHtml).toContain("min-h-10");
    expect(branchHtml).not.toContain("min-h-[68px]");
    expect(branchHtml).not.toContain("col-span-2");
  });

  it("renders the active changes filter as plain text until hover or open", () => {
    const html = renderToStaticMarkup(
      createElement(GitPanelHeader, {
        visibleChangedCount: 1,
        additions: 1,
        deletions: 0,
        isRuntimeReady: true,
        branchRefs: [],
        baseRef: null,
        layout: "unified",
        wrapLongLines: false,
        fileTreeOpen: false,
        allFilesCollapsed: false,
        reviewEntries: [],
        changesFilter: "unstaged",
        onFilterChange: vi.fn(),
        onBaseRefChange: vi.fn(),
        onToggleLayout: vi.fn(),
        onToggleWrap: vi.fn(),
        onToggleFileTree: vi.fn(),
        onToggleAllFiles: vi.fn(),
        onFocusFile: vi.fn(),
        onRefresh: vi.fn(),
      }),
    );

    expect(html).toContain("border-transparent bg-transparent");
    expect(html).toContain("hover:bg-surface-elevated-secondary");
    expect(html).toContain("data-[state=open]:bg-surface-elevated-secondary");
    expect(html).not.toContain("hover:border-sidebar-border");
    expect(html).not.toContain("data-[state=open]:border-sidebar-border");
  });

  it("renders the branch target selector as plain text until hover or open", () => {
    const html = renderToStaticMarkup(
      createElement(GitReviewTargetSelector, {
        mode: "branch",
        baseRef: "origin/main",
        branchRefs: [{ name: "origin/main", isDefault: true, isHead: false, isRemote: true, upstream: null }],
        isRuntimeReady: true,
        onSelect: vi.fn(),
      }),
    );

    expect(html).toContain("origin/main");
    expect(html).toContain("border-transparent bg-transparent");
    expect(html).toContain("hover:bg-surface-elevated-secondary");
    expect(html).toContain("data-[state=open]:bg-surface-elevated-secondary");
    expect(html).not.toContain("border-sidebar-border bg-surface-elevated-secondary");
    expect(html).not.toContain("hover:bg-sidebar-accent");
    expect(html).not.toContain("data-[state=open]:bg-sidebar-accent");
  });

  it("keeps the Changes header options before the sidebar controls", () => {
    const html = renderToStaticMarkup(createElement(GitPanel));
    const layoutIndex = html.indexOf("Use split diff");
    const optionsIndex = html.indexOf("Git review options");
    const sidebarIndex = html.indexOf("Show files");

    expect(layoutIndex).toBeGreaterThanOrEqual(0);
    expect(optionsIndex).toBeGreaterThanOrEqual(0);
    expect(sidebarIndex).toBeGreaterThanOrEqual(0);
    expect(optionsIndex).toBeLessThan(layoutIndex);
    expect(layoutIndex).toBeLessThan(sidebarIndex);
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

  it("renders the empty state when the active section has no files", () => {
    mockGitPanelState.mockReturnValue(createGitPanelState({
      sections: [{
        scope: "unstaged",
        label: "Unstaged",
        files: [],
      }],
      totalChangedCount: 0,
      visibleChangedCount: 0,
    }));

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("No unstaged changes");
    expect(html).toContain("Edit files in the workspace and they will appear here.");
    expect(html).not.toContain("data-diff-surface=\"sidebar\"");
  });

  it("renders last-turn current diffs without stage actions", () => {
    const currentDiff = {
      key: ":README.md:modified",
      path: "README.md",
      oldPath: null,
      displayPath: "README.md",
      status: "modified",
      includedState: null,
      additions: 1,
      deletions: 0,
      binary: false,
    };
    mockGitPanelState.mockReturnValue(createGitPanelState({
      sections: [{
        scope: "last_turn",
        label: "Last turn",
        files: [{
          ...currentDiff,
          currentDiff,
        }],
      }],
      visibleChangedCount: 1,
      activeFilterLabel: "Last turn",
    }));

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("README.md");
    expect(html).toContain(">+1</span>");
    expect(html).not.toContain("Stage README.md");
  });

  it("starts zero-stat rows collapsed until the user expands them", () => {
    const files = Array.from({ length: 4 }, (_, index) => {
      const path = index === 3 ? "src/unknown-stat.ts" : `src/file-${index}.ts`;
      const diff = {
        key: `:${path}:modified`,
        path,
        oldPath: null,
        displayPath: path,
        status: "modified",
        includedState: "excluded",
        additions: index === 3 ? 0 : 1,
        deletions: index === 3 ? 0 : 1,
        binary: false,
      };
      return {
        ...diff,
        currentDiff: diff,
      };
    });
    mockGitPanelState.mockReturnValue(createGitPanelState({
      sections: [{
        scope: "unstaged",
        label: "Unstaged",
        files,
      }],
      visibleChangedCount: files.length,
    }));

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("src/unknown-stat.ts");
    expect(html).not.toContain("new line");
    expect(gitDiffQuery.calls.map((call) => (call as { enabled?: boolean }).enabled))
      .toEqual([false, false, false, false]);
  });

  it("keeps collapsed changed-file rows visible until their diff is expanded", () => {
    gitDiffQuery.state = {
      data: {
        patch: null,
        additions: 0,
        deletions: 0,
        binary: false,
        truncated: false,
      },
      error: null,
      isError: false,
      isLoading: false,
    };

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("Unstaged");
    expect(html).not.toContain("No diff available");
    expect(html).toContain("data-diff-surface=\"sidebar\"");
    expect(html).toContain("GitPanel.tsx");
    expect(html).toContain("aria-label=\"Modified\"");
    expect(gitDiffQuery.calls[0]).toMatchObject({
      path: "apps/desktop/src/components/workspace/git/GitPanel.tsx",
      enabled: false,
    });
  });

  it("does not render diff load errors before collapsed rows are expanded", () => {
    gitDiffQuery.state = {
      data: null,
      error: new Error("pathspec did not match any files"),
      isError: true,
      isLoading: false,
    };

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).not.toContain("Diff unavailable: pathspec did not match any files");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(gitDiffQuery.calls[0]).toMatchObject({
      path: "apps/desktop/src/components/workspace/git/GitPanel.tsx",
      enabled: false,
    });
  });

  it("does not auto-fetch oversized generated diffs on first render", () => {
    const largeDiff = {
      key: ":anyharness/sdk/generated/openapi.json:modified",
      path: "anyharness/sdk/generated/openapi.json",
      oldPath: null,
      displayPath: "anyharness/sdk/generated/openapi.json",
      status: "modified",
      includedState: "excluded",
      additions: 0,
      deletions: 16_393,
      binary: false,
    };
    mockGitPanelState.mockReturnValue(createGitPanelState({
      sections: [{
        scope: "unstaged",
        label: "Unstaged",
        files: [{
          ...largeDiff,
          currentDiff: largeDiff,
        }],
      }],
    }));

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("openapi.json");
    expect(html).toContain("1 large/generated diff collapsed to keep review responsive.");
    expect(html).toContain("1 too large to render inline");
    expect(gitDiffQuery.calls[0]).toMatchObject({
      path: "anyharness/sdk/generated/openapi.json",
      enabled: false,
    });
  });

  it("does not fetch file diffs before the user expands rows", () => {
    const files = Array.from({ length: 4 }, (_, index) => {
      const path = `src/file-${index}.ts`;
      const diff = {
        key: `:${path}:modified`,
        path,
        oldPath: null,
        displayPath: path,
        status: "modified",
        includedState: "excluded",
        additions: 1,
        deletions: 1,
        binary: false,
      };
      return {
        ...diff,
        currentDiff: diff,
      };
    });
    mockGitPanelState.mockReturnValue(createGitPanelState({
      sections: [{
        scope: "unstaged",
        label: "Unstaged",
        files,
      }],
      visibleChangedCount: files.length,
    }));

    renderToStaticMarkup(createElement(GitPanel));

    expect(gitDiffQuery.calls).toHaveLength(4);
    expect(gitDiffQuery.calls.map((call) => (call as { enabled?: boolean }).enabled))
      .toEqual([false, false, false, false]);
  });
});
