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

vi.mock("@/hooks/workspaces/files/use-workspace-file-actions", () => ({
  useWorkspaceFileActions: () => ({
    openFile: vi.fn(),
    openFileDiff: vi.fn(),
    openViewerTarget: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/use-git-panel-state", () => ({
  useGitPanelState: () => ({
    activeWorkspaceId: "workspace-1",
    baseRef: "main",
    sections: [{
      scope: "unstaged",
      label: "Unstaged",
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
  it("renders changed files as clickable right-sidebar rows", () => {
    const html = renderToStaticMarkup(createElement(GitPanel));

    expect(html).toContain("1 unstaged file");
    expect(html).toContain("hover:bg-sidebar-accent");
    expect(html).toContain("Open GitPanel.tsx diff");
    expect(html).toContain("Open GitPanel.tsx file");
    expect(html).toContain("GitPanel.tsx");
  });
});
