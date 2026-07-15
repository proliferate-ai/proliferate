import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup as renderReactToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { GitPanel } from "./GitPanel";
import { GitPanelHeader } from "./GitPanelHeader";
import { GitReviewTargetSelector } from "./GitReviewTargetSelector";

const webTestHost = { desktop: null } as ProductHost;

// Expanded review rows render the full diff body (wrap context menu included),
// which requires a ProductHost above it.
function renderToStaticMarkup(ui: ReactElement) {
  return renderReactToStaticMarkup(
    createElement(ProductHostProvider, { host: webTestHost, children: ui }),
  );
}

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
  useStagePatchMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUnstagePatchMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useReadWorkspaceFileMutation: () => ({
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

  it("renders changed files as one flat review document, expanded by default", () => {
    const html = renderToStaticMarkup(createElement(GitPanel));

    // Single target dropdown (working tree default) instead of filter tabs.
    expect(html).toContain("Working tree");
    expect(html).toContain(">1<");
    expect(html).not.toContain("Show files");
    expect(html).toContain("Git review options");
    // Flat document sections replace the card grid; no section headers.
    expect(html).toContain("data-review-file-section");
    expect(html).not.toContain("codex-review-diff-card");
    expect(html).toContain("data-review-path=\"apps/desktop/src/components/workspace/git/GitPanel.tsx\"");
    expect(html).toContain("data-git-review-document=\"\"");
    expect(html).toContain("id=\"review-diffs-collapsed\"");
    expect(html).toContain("data-app-action-review-scroll=\"\"");
    expect(html).toContain("data-thread-find-target=\"review\"");
    expect(html).toContain("data-app-action-review-metrics-probe=\"\"");
    expect(html).toContain("[container-name:review-header]");
    expect(html).not.toContain("No diff available");
    expect(html).toContain("GitPanel.tsx");
    // Expanded by default: the diff body renders and the fetch is enabled.
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("new line");
    expect(gitDiffQuery.calls[0]).toMatchObject({
      path: "apps/desktop/src/components/workspace/git/GitPanel.tsx",
      enabled: true,
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
      currentBranch: null,
      layout: "unified" as const,
      wrapLongLines: true,
      allFilesCollapsed: false,
      reviewEntries: [],
      onFilterChange: vi.fn(),
      onBaseRefChange: vi.fn(),
      onToggleLayout: vi.fn(),
      onToggleWrap: vi.fn(),
      onToggleAllFiles: vi.fn(),
      onFocusFile: vi.fn(),
      onRefresh: vi.fn(),
      onOpenPublish: null,
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
    expect(branchHtml).toContain("origin/main");
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
        currentBranch: null,
        layout: "unified",
        wrapLongLines: false,
        allFilesCollapsed: false,
        reviewEntries: [],
        changesFilter: "unstaged",
        onFilterChange: vi.fn(),
        onBaseRefChange: vi.fn(),
        onToggleLayout: vi.fn(),
        onToggleWrap: vi.fn(),
        onToggleAllFiles: vi.fn(),
        onFocusFile: vi.fn(),
        onRefresh: vi.fn(),
        onOpenPublish: null,
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

  it("exposes collapse-all, jump-to-file, and options controls without the tree overlay", () => {
    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("Collapse all diffs");
    expect(html).toContain("Jump to file");
    expect(html).toContain("Git review options");
    expect(html).not.toContain("Show files");
  });

  it("renders a compact empty state when there are no changes", () => {
    mockGitPanelState.mockReturnValue(createGitPanelState({
      sections: [],
      totalChangedCount: 0,
      visibleChangedCount: 0,
    }));

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("Working tree clean");
    expect(html).toContain("No unstaged or staged changes in this workspace.");
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

    expect(html).toContain("Working tree clean");
    expect(html).toContain("No unstaged or staged changes in this workspace.");
    expect(html).not.toContain("data-review-file-section");
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

  it("fetches expanded diffs up to the concurrency cap and defers the rest", () => {
    const files = Array.from({ length: 7 }, (_, index) => {
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

    // Rows are expanded by default; the first batch fetches immediately and
    // the tail waits for capacity (GIT_DIFF_FETCH_CONCURRENCY_LIMIT = 5).
    expect(gitDiffQuery.calls.map((call) => (call as { enabled?: boolean }).enabled))
      .toEqual([true, true, true, true, true, false, false]);
  });

  it("shows real counts on headers while a row's diff is still unfetched", () => {
    gitDiffQuery.state = {
      data: null,
      error: null,
      isError: false,
      isLoading: true,
    };

    const html = renderToStaticMarkup(createElement(GitPanel));

    // Status-list counts render even before the diff body arrives.
    expect(html).toContain(">+3</span>");
    expect(html).toContain(">-1</span>");
    expect(html).toContain("Loading diff");
  });

  it("renders diff load errors inline on expanded rows", () => {
    gitDiffQuery.state = {
      data: null,
      error: new Error("pathspec did not match any files"),
      isError: true,
      isLoading: false,
    };

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("Diff unavailable");
    expect(html).toContain("pathspec did not match any files");
    expect(html).toContain("aria-expanded=\"true\"");
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

});
