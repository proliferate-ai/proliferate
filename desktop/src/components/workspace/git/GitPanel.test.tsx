import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GitPanel } from "./GitPanel";

vi.mock("@anyharness/sdk-react", () => ({
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

vi.mock("@/hooks/editor/use-workspace-file-actions", () => ({
  useWorkspaceFileActions: () => ({
    openFile: vi.fn(),
    openFileDiff: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/use-git-panel-state", () => ({
  useGitPanelState: () => ({
    activeWorkspaceId: "workspace-1",
    baseRef: "main",
    files: [{
      key: ":desktop/src/components/workspace/git/GitPanel.tsx:modified",
      path: "desktop/src/components/workspace/git/GitPanel.tsx",
      oldPath: null,
      displayPath: "desktop/src/components/workspace/git/GitPanel.tsx",
      status: "modified",
      includedState: "excluded",
      additions: 3,
      deletions: 1,
      binary: false,
    }],
    totalChangedCount: 1,
    visibleChangedCount: 1,
    activeFilterLabel: "Unstaged",
    isRuntimeReady: true,
    runtimeBlockedReason: null,
    isLoading: false,
    errorMessage: null,
    refetch: vi.fn(),
  }),
}));

describe("GitPanel", () => {
  it("routes right-sidebar files through the shared sidebar FileDiffCard", () => {
    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("1 unstaged file");
    expect(html).toContain("data-diff-surface=\"sidebar\"");
    expect(html).toContain("hover:bg-sidebar-accent");
    expect(html).toContain("GitPanel.tsx");
  });
});
