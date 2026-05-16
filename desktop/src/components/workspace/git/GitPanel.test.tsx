import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "./GitPanel";

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
}));

vi.mock("@/hooks/workspaces/files/use-workspace-file-actions", () => ({
  useWorkspaceFileActions: () => ({
    openFile: vi.fn(),
    openFileDiff: vi.fn(),
    openViewerTarget: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/files/derived/use-workspace-file-context", () => ({
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
    expect(html).toContain("Working tree");
    expect(html).toContain("Git review options");
    expect(html).toContain("Show files");
    expect(html).toContain("data-diff-surface=\"sidebar\"");
    expect(html).toContain("px-2 pb-2");
    expect(html).toContain("pt-2");
    expect(html).not.toContain("px-2 py-2");
    expect(html).not.toContain("No diff available");
    expect(html).toContain("GitPanel.tsx");
  });

  it("keeps the Changes header options before the file sidebar toggle", () => {
    const html = renderToStaticMarkup(createElement(GitPanel));
    const layoutIndex = html.indexOf("Use split diff");
    const optionsIndex = html.indexOf("Git review options");
    const sidebarIndex = html.indexOf("Show files");

    expect(layoutIndex).toBeGreaterThanOrEqual(0);
    expect(optionsIndex).toBeGreaterThanOrEqual(0);
    expect(sidebarIndex).toBeGreaterThanOrEqual(0);
    expect(layoutIndex).toBeLessThan(optionsIndex);
    expect(optionsIndex).toBeLessThan(sidebarIndex);
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
    expect(html).toContain('text-right">+</span><span class="text-right">1');
    expect(html).not.toContain("Stage README.md");
  });

  it("keeps zero-stat rows expanded so empty status entries can resolve", () => {
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
    expect(html.match(/new line/g)).toHaveLength(4);
  });

  it("skips loaded changed-file rows that have no renderable diff", () => {
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
    expect(html).not.toContain("data-diff-surface=\"sidebar\"");
    expect(html).not.toContain("GitPanel.tsx");
  });

  it("renders diff load errors explicitly", () => {
    gitDiffQuery.state = {
      data: null,
      error: new Error("pathspec did not match any files"),
      isError: true,
      isLoading: false,
    };

    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("Diff unavailable: pathspec did not match any files");
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

  it("limits initial expanded diff fetches", () => {
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
      .toEqual([true, true, false, false]);
  });
});
