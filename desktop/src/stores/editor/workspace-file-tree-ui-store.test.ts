import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceFileTreeUiStore } from "./workspace-file-tree-ui-store";

describe("workspace file tree ui store", () => {
  beforeEach(() => {
    useWorkspaceFileTreeUiStore.setState({ expandedDirectoriesByTreeKey: {} });
  });

  it("tracks expanded directories per tree key", () => {
    const store = useWorkspaceFileTreeUiStore.getState();

    store.expandDirectory("repo-a", "src");
    store.expandDirectory("repo-a", "src/components");
    store.expandDirectory("repo-b", "docs");

    expect(useWorkspaceFileTreeUiStore.getState().expandedDirectoriesByTreeKey).toEqual({
      "repo-a": {
        "src": true,
        "src/components": true,
      },
      "repo-b": {
        "docs": true,
      },
    });
  });

  it("collapses one directory without clearing cached expansion state for other paths", () => {
    const store = useWorkspaceFileTreeUiStore.getState();

    store.expandDirectory("repo-a", "src");
    store.expandDirectory("repo-a", "src/components");
    store.collapseDirectory("repo-a", "src");

    expect(useWorkspaceFileTreeUiStore.getState().expandedDirectoriesByTreeKey).toEqual({
      "repo-a": {
        "src/components": true,
      },
    });
  });

  it("prunes a missing directory and removes empty tree keys", () => {
    const store = useWorkspaceFileTreeUiStore.getState();

    store.expandDirectory("repo-a", "src");
    store.removeExpandedDirectory("repo-a", "src");

    expect(useWorkspaceFileTreeUiStore.getState().expandedDirectoriesByTreeKey).toEqual({});
  });
});
