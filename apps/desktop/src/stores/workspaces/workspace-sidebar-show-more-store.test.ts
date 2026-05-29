import { beforeEach, describe, expect, it } from "vitest";
import {
  WORKSPACE_SIDEBAR_SHOW_MORE_DEFAULTS,
  useWorkspaceSidebarShowMoreStore,
} from "./workspace-sidebar-show-more-store";

describe("workspace sidebar show-more store", () => {
  beforeEach(() => {
    useWorkspaceSidebarShowMoreStore.setState({
      ...WORKSPACE_SIDEBAR_SHOW_MORE_DEFAULTS,
    });
  });

  it("toggles repo group show-more keys immutably", () => {
    const store = useWorkspaceSidebarShowMoreStore.getState();
    const initialKeys = store.repoGroupsShownMore;

    store.toggleRepoGroupShowMore("/tmp/repo-a");

    const expandedKeys = useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore;
    expect(expandedKeys).toEqual(["/tmp/repo-a"]);
    expect(expandedKeys).not.toBe(initialKeys);

    useWorkspaceSidebarShowMoreStore.getState().toggleRepoGroupShowMore("/tmp/repo-a");

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([]);
  });

  it("ensures repo group show-more keys idempotently", () => {
    const store = useWorkspaceSidebarShowMoreStore.getState();

    store.ensureRepoGroupShowMore("/tmp/repo-a");
    const expandedKeys = useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore;

    useWorkspaceSidebarShowMoreStore.getState().ensureRepoGroupShowMore("/tmp/repo-a");

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toBe(expandedKeys);
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual(["/tmp/repo-a"]);
  });

  it("records auto show-more selection atomically", () => {
    const store = useWorkspaceSidebarShowMoreStore.getState();

    store.recordAutoRepoGroupShowMore({
      logicalWorkspaceId: "logical-a",
      selectedWorkspaceId: "workspace-a",
      repoKey: "/tmp/repo-a",
      workspaceSelectionNonce: 7,
    });

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual(["/tmp/repo-a"]);
    expect(useWorkspaceSidebarShowMoreStore.getState().lastAutoShownMoreSelection).toEqual({
      logicalWorkspaceId: "logical-a",
      selectedWorkspaceId: "workspace-a",
      repoKey: "/tmp/repo-a",
      workspaceSelectionNonce: 7,
    });
  });

  it("clears single and multiple repo group show-more keys", () => {
    useWorkspaceSidebarShowMoreStore.setState({
      repoGroupsShownMore: ["/tmp/repo-a", "/tmp/repo-b", "/tmp/repo-c"],
      repoGroupsShowMoreClearedByCollapse: ["/tmp/repo-b"],
    });

    useWorkspaceSidebarShowMoreStore.getState().clearRepoGroupShowMore("/tmp/repo-b");
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual([
      "/tmp/repo-a",
      "/tmp/repo-c",
    ]);
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShowMoreClearedByCollapse)
      .toEqual([]);

    useWorkspaceSidebarShowMoreStore.getState().clearRepoGroupsShowMore([
      "/tmp/repo-a",
      "/tmp/repo-missing",
    ]);

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual(["/tmp/repo-c"]);
  });

  it("tracks show-more keys cleared by repo collapse", () => {
    useWorkspaceSidebarShowMoreStore.setState({
      repoGroupsShownMore: ["/tmp/repo-a", "/tmp/repo-b"],
    });

    useWorkspaceSidebarShowMoreStore.getState()
      .clearRepoGroupShowMoreAfterCollapse("/tmp/repo-a");

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore)
      .toEqual(["/tmp/repo-b"]);
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShowMoreClearedByCollapse)
      .toEqual(["/tmp/repo-a"]);

    useWorkspaceSidebarShowMoreStore.getState().recordAutoRepoGroupShowMore({
      logicalWorkspaceId: "logical-a",
      selectedWorkspaceId: "workspace-a",
      repoKey: "/tmp/repo-a",
      workspaceSelectionNonce: 7,
    });

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore)
      .toEqual(["/tmp/repo-b", "/tmp/repo-a"]);
    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShowMoreClearedByCollapse)
      .toEqual([]);
  });

  it("clears the auto show-more record independently from shown-more keys", () => {
    useWorkspaceSidebarShowMoreStore.setState({
      repoGroupsShownMore: ["/tmp/repo-a"],
      lastAutoShownMoreSelection: {
        logicalWorkspaceId: "logical-a",
        selectedWorkspaceId: "workspace-a",
        repoKey: "/tmp/repo-a",
        workspaceSelectionNonce: 7,
      },
    });

    useWorkspaceSidebarShowMoreStore.getState().clearAutoShownMoreSelection();

    expect(useWorkspaceSidebarShowMoreStore.getState().repoGroupsShownMore).toEqual(["/tmp/repo-a"]);
    expect(useWorkspaceSidebarShowMoreStore.getState().lastAutoShownMoreSelection).toBeNull();
  });
});
